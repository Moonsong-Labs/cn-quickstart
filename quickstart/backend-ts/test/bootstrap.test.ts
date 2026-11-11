import { afterEach, expect, test } from 'bun:test';
import { execFile } from 'node:child_process';
import { createApplication } from '../src/bootstrap';

const STARTUP_PROCESS_TIMEOUT_MS = 5_000;
const TOKEN = 'startup-test-secret';
const servers: ReturnType<typeof Bun.serve>[] = [];

// The SDK and bootstrap are real; only the participant HTTP endpoint is simulated.
function serve(fetch: (request: Request) => Response | Promise<Response>) {
  // Keep simulated stalled requests open so the backend controls the startup deadline.
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, idleTimeout: 0, fetch });
  servers.push(server);
  return server;
}

function environment(server: ReturnType<typeof Bun.serve>): NodeJS.ProcessEnv {
  return {
    PORT: '8081',
    API_DOCS_ENABLED: 'false',
    AUTH_MODE: 'shared-secret',
    APP_PROVIDER_PARTY: 'provider-party',
    LEDGER_API_URL: server.url.href,
    LEDGER_API_ALLOW_HTTP: 'true',
    LEDGER_API_USER_ID: 'backend-service',
    APP_PROVIDER_BACKEND_USER_TOKEN: TOKEN,
  };
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.stop(true)));
});

test('Waits for the Ledger API before creating the app and exposes its dependencies', async () => {
  const requested = Promise.withResolvers<void>();
  const identity = Promise.withResolvers<void>();
  const requests: { path: string; authorization: string | null }[] = [];
  const server = serve(async (request) => {
    requests.push({
      path: new URL(request.url).pathname,
      authorization: request.headers.get('authorization'),
    });
    if (new URL(request.url).pathname === '/v2/version') return Response.json({ version: '3.5.2' });
    requested.resolve();
    await identity.promise;
    return Response.json({ user: { id: 'backend-service', isDeactivated: false } });
  });
  let initialized = false;
  const startup = createApplication(environment(server)).then((result) => {
    initialized = true;
    return result;
  });

  await requested.promise;
  expect(initialized).toBe(false);
  identity.resolve();
  const { app, config } = await startup;

  expect(requests).toEqual([
    { path: '/v2/version', authorization: `Bearer ${TOKEN}` },
    { path: '/v2/authenticated-user', authorization: `Bearer ${TOKEN}` },
  ]);
  expect(config).toEqual({ port: 8081, apiDocsEnabled: false });
  expect(app.decorator.ledger.ledgerUserId).toBe('backend-service');
  expect(app.decorator.application.appProviderParty).toBe('provider-party');
  expect((await app.decorator.ledger.client.get('/v2/version')).version).toBe('3.5.2');
  expect((await app.handle(new Request('http://localhost/health'))).status).toBe(200);
});

test('Rejects invalid startup settings before contacting the Ledger API', async () => {
  let requests = 0;
  const server = serve(() => {
    requests += 1;
    return Response.json({ version: '3.5.2' });
  });
  for (const [overrides, message] of [
    [{ PORT: '0' }, 'PORT must be an integer'],
    [{ APP_PROVIDER_PARTY: undefined }, 'APP_PROVIDER_PARTY is required'],
    [{ LEDGER_API_URL: undefined }, 'LEDGER_API_URL is required'],
    [{ APP_PROVIDER_BACKEND_USER_TOKEN: undefined }, 'APP_PROVIDER_BACKEND_USER_TOKEN is required'],
  ] as const) {
    await expect(createApplication({ ...environment(server), ...overrides })).rejects.toThrow(
      message,
    );
  }
  expect(requests).toBe(0);
});

test('Rejects startup when the participant rejects authentication', async () => {
  const server = serve((request) =>
    new URL(request.url).pathname === '/v2/version'
      ? Response.json({ version: '3.5.2' })
      : Response.json({ message: 'Unauthorized' }, { status: 401 }),
  );
  await expect(createApplication(environment(server))).rejects.toMatchObject({
    name: 'LedgerApiError',
    message: 'Failed to verify Ledger API identity',
  });
});

test.each([
  [{ id: 'another-user' }, 'Authenticated Ledger API user does not match LEDGER_API_USER_ID'],
  [{ id: 'backend-service', isDeactivated: true }, 'Authenticated Ledger API user is deactivated'],
] as const)('Rejects an invalid service identity: %j', async (user, message) => {
  const server = serve((request) =>
    new URL(request.url).pathname === '/v2/version'
      ? Response.json({ version: '3.5.2' })
      : Response.json({ user }),
  );
  await expect(createApplication(environment(server))).rejects.toThrow(message);
});

test.each([{}, { user: null }])('Rejects a missing authenticated user: %j', async (response) => {
  /** Returns a successful HTTP response without an authenticated user. */
  const server = serve((request) =>
    new URL(request.url).pathname === '/v2/version'
      ? Response.json({ version: '3.5.2' })
      : Response.json(response),
  );
  await expect(createApplication(environment(server))).rejects.toThrow(
    'Ledger API response is missing the authenticated user',
  );
});

test('Rejects startup when the Ledger API is unreachable', async () => {
  const server = serve(() => Response.json({ version: '3.5.2' }));
  const env = environment(server);
  await server.stop(true);
  await expect(createApplication(env)).rejects.toThrow('Failed to initialize Ledger API client');
});

test('The server exits unsuccessfully without logging credentials when startup fails', async () => {
  const server = serve((request) =>
    new URL(request.url).pathname === '/v2/version'
      ? Response.json({ version: '3.5.2' })
      : Response.json({ message: TOKEN }, { status: 401 }),
  );
  const result = await new Promise<{
    code: string | number | null;
    stderr: string;
    stdout: string;
  }>((resolve) => {
    execFile(
      process.execPath,
      ['--no-env-file', new URL('../src/server.ts', import.meta.url).pathname],
      { env: { ...process.env, ...environment(server) }, timeout: STARTUP_PROCESS_TIMEOUT_MS },
      (error, stdout, stderr) => resolve({ code: error?.code ?? 0, stdout, stderr }),
    );
  });

  expect(result.code).toBe(1);
  expect(result.stdout).not.toContain('Backend listening');
  expect(result.stderr).toContain('Failed to verify Ledger API identity');
  expect(result.stdout + result.stderr).not.toContain(TOKEN);
});

/** Exceeds the production startup budget to detect a timer left armed after successful startup. */
const HEALTHY_SERVER_LIFETIME_MS = 31_000;
/** Bounds each subprocess independently if the startup watchdog fails. */
const WATCHDOG_PROCESS_TIMEOUT_MS = 35_000;
/** Gives subprocess cleanup time beyond their individual deadlines. */
const WATCHDOG_TEST_TIMEOUT_MS = 40_000;

test(
  'Bounds stalled startup and clears the watchdog after successful startup',
  async () => {
    await Promise.all(
      ['/v2/version', '/v2/authenticated-user', null].map(async (stalledPath) => {
        /** Releases simulated stalled responses during cleanup. */
        const release = Promise.withResolvers<void>();
        /** Simulates a participant that stalls at the selected startup request. */
        const server = serve(async (request) => {
          if (new URL(request.url).pathname === stalledPath) await release.promise;
          return new URL(request.url).pathname === '/v2/version'
            ? Response.json({ version: '3.5.2' })
            : Response.json({ user: { id: 'backend-service', isDeactivated: false } });
        });
        /** Reserves an available port long enough to discover it for the child listener. */
        const reservation = Bun.serve({
          hostname: '127.0.0.1',
          port: 0,
          fetch: () => new Response(),
        });
        /** Uses a distinct listener port for each concurrently running server. */
        const port = reservation.port;
        await reservation.stop(true);
        /** Runs the actual entry point; successful startup must survive beyond its watchdog deadline. */
        const script = `await import(${JSON.stringify(new URL('../src/server.ts', import.meta.url).href)});
      setTimeout(() => process.kill(process.pid, 'SIGTERM'), ${HEALTHY_SERVER_LIFETIME_MS}).unref();`;
        try {
          /** Captures exit status and output; the process deadline catches leaked pending requests. */
          const result = await new Promise<{
            code: string | number | null;
            stdout: string;
            stderr: string;
          }>((resolve) => {
            execFile(
              process.execPath,
              ['--no-env-file', '-e', script],
              {
                env: { ...process.env, ...environment(server), PORT: String(port) },
                timeout: WATCHDOG_PROCESS_TIMEOUT_MS,
                killSignal: 'SIGKILL',
              },
              (error, stdout, stderr) => resolve({ code: error?.code ?? 0, stdout, stderr }),
            );
          });
          expect(result.code).toBe(stalledPath ? 1 : 0);
          if (stalledPath) {
            expect(result.stderr).toContain('Backend startup timed out');
            expect(result.stdout).not.toContain('Backend listening');
          } else {
            expect(result.stdout).toContain('Backend listening');
            expect(result.stdout).toContain('Received SIGTERM');
            expect(result.stderr).not.toContain('Backend startup timed out');
          }
          expect(result.stdout + result.stderr).not.toContain(TOKEN);
        } finally {
          release.resolve();
        }
      }),
    );
  },
  WATCHDOG_TEST_TIMEOUT_MS,
);

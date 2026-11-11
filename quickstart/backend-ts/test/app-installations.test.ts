import { afterEach, expect, spyOn, test } from 'bun:test';
import { LedgerClient } from '@canton-network/core-ledger-client';
import { LEDGER_REQUEST_TIMEOUT_MS } from '../src/config/ledger';
import { AppInstallRequest } from '../src/daml/licensing';
import { createLedgerClient } from '../src/integrations/ledger/client';
import { createAppInstallRequest } from '../src/modules/app-installations';

// The SDK client and generated bindings are real; the participant HTTP responses are simulated.
/** Servers created by setup, stopped after each test. */
const servers: ReturnType<typeof Bun.serve>[] = [];
/** Confirmation returned by the simulated submit-and-wait endpoint. */
const confirmation = { updateId: 'installation-update', completionOffset: 42 };
/** Valid request used to check command encoding and submitting-party behavior. */
const payload = {
  provider: 'provider::test',
  user: 'user::test',
  meta: { values: { description: 'Installation request' } },
} satisfies AppInstallRequest;

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.stop(true)));
});

/**
 * Serves version discovery, records submit-and-wait requests, and uses an injected response.
 */
async function setup(
  respond: () => Response | Promise<Response> = () => Response.json(confirmation),
) {
  const state = {
    token: 'user-token',
    tokenFailure: undefined as Error | undefined,
    requests: [] as {
      method: string;
      path: string;
      authorization: string | null;
      body: unknown;
    }[],
  };
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      const path = new URL(request.url).pathname;
      if (request.method === 'GET' && path === '/v2/version') {
        return Response.json({ version: '3.5.2' });
      }
      state.requests.push({
        method: request.method,
        path,
        authorization: request.headers.get('authorization'),
        body: await request.json(),
      });
      if (request.method !== 'POST' || path !== '/v2/commands/submit-and-wait') {
        return new Response(null, { status: 404 });
      }
      return respond();
    },
  });
  servers.push(server);
  const client = await createLedgerClient({
    baseUrl: server.url,
    accessTokenProvider: {
      getAccessToken: async () => {
        if (state.tokenFailure) throw state.tokenFailure;
        return state.token;
      },
      getAuthContext: async () => ({ userId: 'app-user-backend', accessToken: state.token }),
    },
  });
  return { connection: { client, ledgerUserId: 'app-user-backend' }, state, server };
}

test('Creates an installation request as its user and returns the ledger confirmation', async () => {
  const { connection, state } = await setup();
  const result = await createAppInstallRequest(connection, payload, 'installation-command-1');

  expect(result).toEqual(confirmation);
  expect(state.requests).toEqual([
    {
      method: 'POST',
      path: '/v2/commands/submit-and-wait',
      authorization: 'Bearer user-token',
      body: {
        userId: 'app-user-backend',
        commandId: 'installation-command-1',
        actAs: ['user::test'],
        commands: [
          {
            CreateCommand: {
              templateId: AppInstallRequest.templateId,
              createArguments: payload,
            },
          },
        ],
      },
    },
  ]);
});

test('Waits for the participant confirmation before resolving', async () => {
  const received = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const { connection, state } = await setup(async () => {
    received.resolve();
    await release.promise;
    return Response.json(confirmation);
  });
  let settled = false;
  const submission = createAppInstallRequest(connection, payload, 'pending-command');
  void submission.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );

  try {
    await received.promise;
    expect(state.requests).toHaveLength(1);
    expect(settled).toBe(false);
    release.resolve();
    expect(await submission).toEqual(confirmation);
  } finally {
    release.resolve();
  }
});

test('Obtains the current token when submitting after client initialization', async () => {
  const { connection, state } = await setup();
  state.token = 'renewed-user-token';

  await createAppInstallRequest(connection, payload, 'renewed-token-command');

  expect(state.requests).toHaveLength(1);
  expect(state.requests[0].authorization).toBe('Bearer renewed-user-token');
});

test.each([400, 401, 403, 409, 503])(
  'Preserves HTTP %i ledger rejection without resubmitting',
  async (status) => {
    const failure = {
      code: 'SIMULATED_LEDGER_REJECTION',
      cause: 'Simulated command rejection',
      correlationId: 'test-correlation',
      context: { commandId: 'rejected-command' },
      errorCategory: 8,
      ...(status === 503 ? { retryInfo: '1s' } : {}),
    };
    const { connection, state } = await setup(() => Response.json(failure, { status }));

    await expect(
      createAppInstallRequest(connection, payload, 'rejected-command'),
    ).rejects.toMatchObject({ cause: failure, commandId: 'rejected-command' });
    expect(state.requests).toHaveLength(1);
  },
);

test('Preserves token acquisition failure without sending a command', async () => {
  const { connection, state } = await setup();
  const failure = new Error('Token provider unavailable');
  state.tokenFailure = failure;

  await expect(
    createAppInstallRequest(connection, payload, 'token-failure-command'),
  ).rejects.toMatchObject({ cause: failure, commandId: 'token-failure-command' });
  expect(state.requests).toHaveLength(0);
});

test('Rejects when the participant becomes unreachable after initialization', async () => {
  const { connection, state, server } = await setup();
  await server.stop(true);

  await expect(
    createAppInstallRequest(connection, payload, 'connection-failure-command'),
  ).rejects.toMatchObject({
    name: 'LedgerApiError',
    commandId: 'connection-failure-command',
    cause: expect.any(Error),
  });
  expect(state.requests).toHaveLength(0);
});

test('Rejects a connection lost after receipt without reporting success or resubmitting', async () => {
  const { connection, state } = await setup(() => Response.error());

  await expect(
    createAppInstallRequest(connection, payload, 'lost-response-command'),
  ).rejects.toMatchObject({
    name: 'LedgerApiError',
    commandId: 'lost-response-command',
    cause: expect.any(Error),
  });
  expect(state.requests).toHaveLength(1);
});

test('Rejects blank identifiers and malformed payloads before invoking the SDK', () => {
  const client = new LedgerClient({
    baseUrl: new URL('http://ledger.invalid'),
    accessTokenProvider: {
      getAccessToken: async () => 'unused-token',
      getAuthContext: async () => ({ userId: 'app-user-backend', accessToken: 'unused-token' }),
    },
  });
  const post = spyOn(client, 'post').mockImplementation(() => {
    throw new Error('Unexpected ledger submission');
  });
  const connection = { client, ledgerUserId: 'app-user-backend' };
  const payload = {
    provider: 'provider::test',
    user: 'user::test',
    meta: { values: {} },
  } satisfies AppInstallRequest;

  try {
    for (const value of ['', '   ']) {
      expect(() => createAppInstallRequest(connection, payload, value)).toThrow(
        'commandId must not be blank',
      );
      expect(() =>
        createAppInstallRequest(connection, { ...payload, provider: value }, 'command-1'),
      ).toThrow('provider must not be blank');
      expect(() =>
        createAppInstallRequest(connection, { ...payload, user: value }, 'command-1'),
      ).toThrow('user must not be blank');
    }

    // Untyped callers can bypass compile-time checks; the generated decoder checks their data.
    for (const invalid of [
      { ...payload, user: undefined },
      { ...payload, provider: 123 },
      { ...payload, meta: undefined },
      { ...payload, meta: { values: { description: 123 } } },
    ]) {
      expect(() =>
        createAppInstallRequest(connection, invalid as unknown as AppInstallRequest, 'command-1'),
      ).toThrow();
    }
    expect(post).not.toHaveBeenCalled();
  } finally {
    post.mockRestore();
  }
});

test('Cancels an installation request on HTTP timeout without resubmitting', async () => {
  /** Bounds the real HTTP request quickly while checking the configured production deadline. */
  const testTimeoutMs = 50;
  /** Releases the simulated response after the timeout assertion, including on test failure. */
  const release = Promise.withResolvers<void>();
  const { connection, state } = await setup(async () => {
    await release.promise;
    return Response.json(confirmation);
  });
  /** Preserves native cancellation while shortening only the timeout created by the command. */
  const nativeTimeout = AbortSignal.timeout.bind(AbortSignal);
  /** Checks the production deadline while substituting a short native timeout for this test. */
  const timeout = spyOn(AbortSignal, 'timeout').mockImplementation(() =>
    nativeTimeout(testTimeoutMs),
  );

  try {
    await expect(
      createAppInstallRequest(connection, payload, 'timeout-command'),
    ).rejects.toMatchObject({
      name: 'LedgerApiError',
      commandId: 'timeout-command',
      updateId: undefined,
      cause: expect.objectContaining({ name: 'TimeoutError' }),
    });
    expect(timeout).toHaveBeenCalledTimes(1);
    expect(timeout).toHaveBeenCalledWith(LEDGER_REQUEST_TIMEOUT_MS);
    expect(state.requests).toHaveLength(1);
  } finally {
    timeout.mockRestore();
    release.resolve();
  }
});

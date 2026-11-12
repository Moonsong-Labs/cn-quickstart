import { afterAll, expect, test } from 'bun:test';
import { execFile, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { promisify } from 'node:util';
import { Pool } from 'pg';
import { createApplication } from '../src/bootstrap';
import { readPostgresConfig } from '../src/config/postgres';

const TIMEOUT_MS = 10_000;
const execute = promisify(execFile);
const ledger = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  fetch(request) {
    return new URL(request.url).pathname === '/v2/version'
      ? Response.json({ version: '3.5.2' })
      : Response.json({ user: { id: 'postgres-test-user', isDeactivated: false } });
  },
});
const env: NodeJS.ProcessEnv = {
  ...process.env,
  LEDGER_API_URL: ledger.url.href,
  LEDGER_API_USER_ID: 'postgres-test-user',
  APP_PROVIDER_BACKEND_USER_TOKEN: 'postgres-test-token',
  APP_PROVIDER_PARTY: 'postgres-test-party',
  AUTH_MODE: 'shared-secret',
  API_DOCS_ENABLED: 'false',
};
const observer = new Pool(readPostgresConfig(env));

afterAll(async () => {
  await observer.end();
  await ledger.stop(true);
});

test('Connects to the configured database, queries through the shared pool, and closes it', async () => {
  const { app, pqs } = await createApplication(env);
  let pid: number;
  try {
    expect(app.decorator.pqs).toBe(pqs);
    const result = await pqs.query('SELECT current_database() AS name, pg_backend_pid() AS pid');
    expect(result.rows[0].name).toBe(env.POSTGRES_DATABASE);
    pid = result.rows[0].pid;
    expect(pqs.idleCount).toBe(1);
  } finally {
    await pqs.end();
  }
  const result = await observer.query('SELECT pid FROM pg_stat_activity WHERE pid = $1', [pid]);
  expect(result.rows).toEqual([]);
});

test('PostgreSQL cancels a slow statement and the pool serves the next query', async () => {
  const pool = new Pool(
    readPostgresConfig({ ...env, POSTGRES_POOL_MAX: '1', POSTGRES_STATEMENT_TIMEOUT_MS: '1000' }),
  );
  try {
    await expect(pool.query('SELECT pg_sleep(5)')).rejects.toMatchObject({ code: '57014' });
    expect((await pool.query('SELECT 1 AS value')).rows).toEqual([{ value: 1 }]);
  } finally {
    await pool.end();
  }
});

test('Rejects a reachable PostgreSQL database without the PQS schema', async () => {
  await expect(createApplication({ ...env, POSTGRES_DATABASE: 'postgres' })).rejects.toMatchObject({
    message: 'Failed to verify PQS database',
    cause: { code: '42883' },
  });
});

test('Exits on database authentication failure without exposing the password', async () => {
  const password = 'invalid-integration-password';
  try {
    await execute(process.execPath, ['--no-env-file', 'src/server.ts'], {
      env: { ...env, POSTGRES_PASSWORD: password },
      timeout: TIMEOUT_MS,
    });
    throw new Error('Expected startup to fail');
  } catch (error) {
    expect(error).toMatchObject({ code: 1 });
    const output = error as { stdout: string; stderr: string };
    expect(output.stdout).not.toContain('Backend listening');
    expect(output.stderr).toContain('Failed to verify PQS database');
    expect(output.stdout + output.stderr).not.toContain(password);
  }
});

test(
  'Closes the pool when the HTTP port is already occupied',
  async () => {
    const occupied = createServer();
    await new Promise<void>((resolve) =>
      occupied.listen({ port: 0, host: '::', ipv6Only: false }, resolve),
    );
    const address = occupied.address();
    if (!address || typeof address === 'string') throw new Error('Missing test server port');
    try {
      await expect(
        execute(process.execPath, ['--no-env-file', 'src/server.ts'], {
          env: { ...env, PORT: String(address.port) },
          timeout: TIMEOUT_MS,
        }),
      ).rejects.toMatchObject({ code: 1 });
    } finally {
      await new Promise<void>((resolve) => occupied.close(() => resolve()));
    }
  },
  TIMEOUT_MS + 1000,
);

test.each(['SIGTERM', 'SIGINT'] as const)(
  'Drains the pool and exits cleanly on %s',
  async (signal) => {
    const reservation = Bun.serve({ hostname: '0.0.0.0', port: 0, fetch: () => new Response() });
    const port = reservation.port;
    await reservation.stop(true);
    // Pause at the readiness message to expose signals sent before handlers are registered.
    const script = `const info = console.info.bind(console);
      console.info = (...args) => {
        info(...args);
        if (String(args[0]).startsWith('Backend listening'))
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
      };
      await import('./src/server.ts');`;
    const child = spawn(process.execPath, ['--no-env-file', '-e', script], {
      env: { ...env, PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let started = false;
    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (resolve, reject) => {
        child.once('error', reject);
        child.once('close', (code, signal) => resolve({ code, signal }));
      },
    );
    const timer = setTimeout(() => child.kill('SIGKILL'), TIMEOUT_MS);
    child.stdout.on('data', (data) => {
      stdout += data.toString();
      if (!started && stdout.includes('Backend listening')) {
        started = true;
        child.kill(signal);
      }
    });
    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    try {
      expect(await exited).toEqual({ code: 0, signal: null });
      expect(started).toBe(true);
      expect(stdout).toContain(`Received ${signal}, shutting down`);
      expect(stderr).toBe('');
    } finally {
      clearTimeout(timer);
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }
  },
  TIMEOUT_MS + 1000,
);

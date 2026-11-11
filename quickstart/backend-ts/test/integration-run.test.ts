import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { CommandError, EXIT_CODE_INTERRUPTED, run } from '../integration/run';

const COMMAND_TIMEOUT_MS = 5_000;
const TREE_TIMEOUT_MS = 3_000;
const TEST_TIMEOUT_MS = 10_000;
const TERMINATION_GRACE_MS = 100;
const READINESS_POLL_MS = 10;
const TREE_DEPTH = 2;
const FAILURE_EXIT_CODE = 7;

const executions: { controller: AbortController; result: Promise<string> }[] = [];
const directories: string[] = [];

/** Starts a cancellable command with the test timeout and tracks it for cleanup. */
function start(command: string[], timeoutMs = COMMAND_TIMEOUT_MS, capture = true) {
  const controller = new AbortController();
  const result = run(command, {
    signal: controller.signal,
    cwd: tmpdir(),
    env: process.env,
    capture,
    timeoutMs,
    graceMs: TERMINATION_GRACE_MS,
  });
  const execution = { controller, result };
  executions.push(execution);
  return execution;
}

afterEach(async () => {
  for (const execution of executions.splice(0)) {
    execution.controller.abort();
    await execution.result.catch(() => {});
  }
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

/** Starts a parent process with descendants and waits until each descendant reports its PID. */
async function tree(
  mode: 'ignore' | 'exit',
  {
    timeoutMs = COMMAND_TIMEOUT_MS,
    viaScript = false,
    capture = true,
  }: { timeoutMs?: number; viaScript?: boolean; capture?: boolean } = {},
) {
  const directory = await mkdtemp(join(tmpdir(), 'qs-command-test-'));
  directories.push(directory);
  const pidsFile = join(directory, 'pids');
  const script = join(directory, 'tree.ts');
  await writeFile(
    script,
    `
    import { spawn } from 'node:child_process';
    import { appendFileSync } from 'node:fs';
    const [file, depth, mode] = process.argv.slice(2);
    process.on('SIGTERM', () => { if (mode === 'exit') process.exit(0); });
    appendFileSync(file, process.pid + '\\n');
    if (Number(depth) > 0) spawn(process.execPath, [import.meta.path, file, String(Number(depth) - 1), 'ignore'], { stdio: 'inherit' });
    setInterval(() => {}, 1000);
  `,
  );
  const command = [process.execPath, script, pidsFile, String(TREE_DEPTH), mode];
  if (viaScript) {
    const quote = (value: string) => `'${value.replaceAll("'", "'\"'\"'")}'`;
    await writeFile(
      join(directory, 'package.json'),
      JSON.stringify({
        scripts: { 'codegen:daml': command.map(quote).join(' ') },
      }),
    );
  }
  const execution = start(
    viaScript ? [process.execPath, 'run', '--cwd', directory, 'codegen:daml'] : command,
    timeoutMs,
    capture,
  );
  // Attach the rejection handler before waiting for the tree to become ready.
  const outcome = execution.result.catch((error: unknown) => error);
  const deadline = Date.now() + COMMAND_TIMEOUT_MS;
  let pids: number[] = [];
  while (Date.now() < deadline) {
    try {
      pids = (await readFile(pidsFile, 'utf8')).trim().split('\n').map(Number);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (pids.length === TREE_DEPTH + 1) return { execution, outcome, pids };
    await delay(READINESS_POLL_MS);
  }
  throw new Error('Process tree did not become ready');
}

/** Asserts that every recorded process has exited and its PID is no longer addressable. */
function expectStopped(pids: number[]) {
  for (const pid of pids) expect(() => process.kill(pid, 0)).toThrow();
}

test('Captures successful output and reports command failures without including output', async () => {
  const success = start([process.execPath, '-e', "console.log('ready')"]);
  expect(await success.result).toBe('ready\n');
  const failure = start([
    process.execPath,
    '-e',
    `console.log('private-output'); console.error('private-error'); process.exit(${FAILURE_EXIT_CODE})`,
  ]);
  await expect(failure.result).rejects.toMatchObject({
    code: FAILURE_EXIT_CODE,
    message: `${process.execPath} failed (exit ${FAILURE_EXIT_CODE})`,
  });
});

test(
  'A timeout kills the entire tree even when every process ignores SIGTERM',
  async () => {
    const { outcome, pids } = await tree('ignore', { timeoutMs: TREE_TIMEOUT_MS });
    expect(await outcome).toMatchObject({ message: `${process.execPath} exceeded its timeout` });
    expectStopped(pids);
  },
  TEST_TIMEOUT_MS,
);

test(
  'Interruption waits for descendants that ignore SIGTERM after their parent exits',
  async () => {
    const { execution, outcome, pids } = await tree('exit', { capture: false });
    execution.controller.abort();
    const error = await outcome;
    expect(error).toBeInstanceOf(CommandError);
    expect(error).toMatchObject({ code: EXIT_CODE_INTERRUPTED });
    expectStopped(pids);
  },
  TEST_TIMEOUT_MS,
);

test('Reports a spawn error without leaving a timeout running', async () => {
  const execution = start(['/nonexistent/quickstart-command']);
  await expect(execution.result).rejects.toMatchObject({ code: 'ENOENT' });
});

test(
  'A timeout also terminates descendants launched through a Bun package script',
  async () => {
    const { outcome, pids } = await tree('ignore', { timeoutMs: TREE_TIMEOUT_MS, viaScript: true });
    expect(await outcome).toMatchObject({ message: `${process.execPath} exceeded its timeout` });
    expectStopped(pids);
  },
  TEST_TIMEOUT_MS,
);

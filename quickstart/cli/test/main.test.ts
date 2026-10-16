// Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: 0BSD

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli } from '../src/main.ts';
import { scriptedIo } from './io.ts';

/** Temp projects created by this file. `afterEach` deletes every entry and clears the list. */
const dirs: string[] = [];

/**
 * Create a throwaway quickstart directory with the two project markers.
 * Used by tests that must prove `.env.local` was or was not written.
 */
async function project(): Promise<string> {
  const dir = join(tmpdir(), `qs-cli-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  await mkdir(join(dir, 'docker', 'modules'), { recursive: true });
  await writeFile(join(dir, '.env'), 'SPLICE_VERSION=0.6.11\n');
  dirs.push(dir);
  return dir;
}

/** Delete every temp project from this file, including ones a failed test left behind. */
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('runCli', () => {
  test('no command prints help and exits 0', async () => {
    const io = scriptedIo([]);
    expect(await runCli([], io.io)).toBe(0);
    expect(io.output()).toContain('setup');
    expect(io.output()).toContain('Configure auth, party hint, and test mode');
  });

  test('--help lists setup', async () => {
    const io = scriptedIo([]);
    expect(await runCli(['--help'], io.io)).toBe(0);
    expect(io.output()).toContain('setup');
    expect(io.output()).toContain('Configure auth, party hint, and test mode');
  });

  test('--version prints the package version', async () => {
    const io = scriptedIo([]);
    expect(await runCli(['--version'], io.io)).toBe(0);
    expect(io.output()).toBe('0.1.0\n');
  });

  test('an unknown command exits 2', async () => {
    const io = scriptedIo([]);
    expect(await runCli(['nope'], io.io)).toBe(2);
    expect(io.output()).toContain('Unknown command: nope');
  });

  test('a setup flag without the setup command exits 2', async () => {
    const io = scriptedIo([]);
    expect(await runCli(['--auth-mode', 'oauth2'], io.io)).toBe(2);
    expect(io.output()).toContain('--auth-mode is only valid with setup.');
  });

  test('an unknown flag exits 2', async () => {
    const io = scriptedIo([]);
    expect(await runCli(['setup', '--nope'], io.io)).toBe(2);
  });

  test('setup --help does not write .env.local', async () => {
    const dir = await project();
    const io = scriptedIo([]);
    expect(await runCli(['setup', '--help', '--project', dir], io.io)).toBe(0);
    expect(io.output()).toContain('--auth-mode');
    await expect(readFile(join(dir, '.env.local'), 'utf8')).rejects.toThrow();
  });

  test('piped answers are all read', async () => {
    const dir = await project();
    const proc = Bun.spawn({
      cmd: [
        'bun',
        '--no-env-file',
        new URL('../src/main.ts', import.meta.url).pathname,
        'setup',
        '--project',
        dir,
      ],
      env: { ...process.env, USER: '', USERNAME: '' },
      stdin: new Blob(['n\nApp-User-1\nn\n']),
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    expect(stderr).toBe('');
    expect(code).toBe(0);
    expect(stdout).toContain('Wrote .env.local');
    expect(await readFile(join(dir, '.env.local'), 'utf8')).toBe(
      'AUTH_MODE=shared-secret\nPARTY_HINT=App-User-1\nTEST_MODE=off',
    );
  });

  test('shared flags before the command name reach setup', async () => {
    const dir = await project();
    const io = scriptedIo([]);
    const code = await runCli(['--project', dir, '--dry-run', 'setup', '--yes'], io.io, {
      cwd: dir,
      env: { USER: 'erin' },
    });
    expect(code).toBe(0);
    expect(io.output()).toContain('AUTH_MODE=oauth2\nPARTY_HINT=quickstart-erin-1\nTEST_MODE=off');
    expect(io.output()).toContain('Dry run. .env.local was not written.');
    await expect(readFile(join(dir, '.env.local'), 'utf8')).rejects.toThrow();
  });

  test('setup --yes writes .env.local from --project', async () => {
    const dir = await project();
    const io = scriptedIo([]);
    const code = await runCli(['setup', '--yes', '--project', dir], io.io, {
      cwd: dir,
      env: { USER: 'dana' },
    });
    expect(code).toBe(0);
    expect(await readFile(join(dir, '.env.local'), 'utf8')).toBe(
      'AUTH_MODE=oauth2\nPARTY_HINT=quickstart-dana-1\nTEST_MODE=off',
    );
  });
});

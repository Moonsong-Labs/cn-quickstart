// Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: 0BSD

import { afterEach, describe, expect, test } from 'bun:test';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runCli } from '../src/main.ts';
import { scriptedIo } from './io.ts';
import { projectCleaner, tempProject } from './project-fixture.ts';
import { fakeRunner } from './runner.ts';

/** Temp checkouts for this file. `afterEach` deletes every entry. */
const cleaner = projectCleaner();

/** Delete every temp checkout from this file, including ones a failed test left behind. */
afterEach(() => cleaner.cleanup());

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
    expect(io.output()).toContain('doctor');
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

  test('clean --help explains each target', async () => {
    const io = scriptedIo([]);
    expect(await runCli(['clean', '--help'], io.io)).toBe(0);
    expect(io.output()).toContain('frontend/dist');
    expect(io.output()).toContain('shell and console');
    expect(io.output()).toContain('project network');
    expect(io.output()).toContain('Asks first unless --yes');
  });

  test('an unknown UI name exits 2', async () => {
    const io = scriptedIo([]);
    expect(await runCli(['open', 'nope'], io.io)).toBe(2);
    expect(io.output()).toContain('Allowed choices');
  });

  test('an unknown flag exits 2', async () => {
    const io = scriptedIo([]);
    expect(await runCli(['setup', '--nope'], io.io)).toBe(2);
  });

  test('setup --help does not write .env.local', async () => {
    const dir = await tempProject(cleaner.dirs);
    const io = scriptedIo([]);
    expect(await runCli(['setup', '--help', '--project', dir], io.io)).toBe(0);
    expect(io.output()).toContain('--auth-mode');
    await expect(readFile(join(dir, '.env.local'), 'utf8')).rejects.toThrow();
  });

  test('piped answers are all read', async () => {
    const dir = await tempProject(cleaner.dirs);
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
    const dir = await tempProject(cleaner.dirs);
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

  test('compose forwards flags such as -f', async () => {
    const dir = await tempProject(cleaner.dirs);
    await writeFile(join(dir, '.env.local'), 'PARTY_HINT=App-User-1\n');
    const io = scriptedIo([]);
    const fake = fakeRunner();
    const code = await runCli(['--dry-run', '--project', dir, 'compose', 'logs', '-f'], io.io, {
      cwd: dir,
      runner: fake.runner,
    });
    expect(code).toBe(0);
    expect(fake.calls.at(-1)?.cmd.slice(-2)).toEqual(['logs', '-f']);
  });

  test('compose config keeps headings off stdout', async () => {
    const dir = await tempProject(cleaner.dirs);
    await writeFile(join(dir, '.env.local'), 'PARTY_HINT=App-User-1\n');
    const io = scriptedIo([]);
    const fake = fakeRunner();
    const code = await runCli(['compose', '--dry-run', '--project', dir, 'config'], io.io, {
      cwd: dir,
      runner: fake.runner,
    });
    expect(code).toBe(0);
    expect(io.output()).toBe('');
    expect(io.noted()).toContain('docker compose');
    expect(io.noted()).toContain('config');
    expect(fake.calls.at(-1)?.cmd.at(-1)).toBe('config');
  });

  test('setup --yes writes .env.local from --project', async () => {
    const dir = await tempProject(cleaner.dirs);
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

// Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: 0BSD

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseLinks, runVendor } from '../src/commands/vendor.ts';
import type { CommandContext } from '../src/lib/context.ts';
import type { Runner } from '../src/lib/exec.ts';
import { scriptedIo } from './io.ts';
import { projectCleaner, tempProject } from './project-fixture.ts';
import { fakeRunner } from './runner.ts';

/** Temp checkouts for this file. */
const cleaner = projectCleaner();

afterEach(() => cleaner.cleanup());

/** Full object id from `links.csv`. A short hash is not a valid fetch target. */
const SHA = 'fa6b029f2563423f3f612302cfdc84986366479d';

/** `links.csv` body with a comment, a blank line, and one localnet row. */
const LINKS = `# vendored checkouts
git@github.com:canton-network/splice.git, ${SHA}, cluster/compose/localnet/, docker/modules/
`;

describe('parseLinks', () => {
  test('trims fields and drops comments, blanks, and trailing slashes', () => {
    expect(parseLinks(LINKS)).toEqual([
      {
        repo: 'git@github.com:canton-network/splice.git',
        sha: SHA,
        source: 'cluster/compose/localnet',
        destDir: 'docker/modules',
        name: 'localnet',
      },
    ]);
  });
});

describe('runVendor', () => {
  test('an unknown name lists the known ones', async () => {
    const dir = await tempProject(cleaner.dirs);
    await writeFile(join(dir, 'links.csv'), LINKS);
    const io = scriptedIo([]);
    /** Context that must not fetch. */
    const context: CommandContext = {
      io: io.io,
      env: {},
      cwd: dir,
      cliDir: dir,
      dryRun: false,
      project: dir,
      runner: fakeRunner().runner,
    };
    await expect(runVendor(context, 'missing')).rejects.toThrow('Known names: localnet');
  });

  test('dry-run prints the row and does not fetch', async () => {
    const dir = await tempProject(cleaner.dirs);
    await writeFile(join(dir, 'links.csv'), LINKS);
    const fake = fakeRunner();
    const io = scriptedIo([]);
    const context: CommandContext = {
      io: io.io,
      env: {},
      cwd: dir,
      cliDir: dir,
      dryRun: true,
      project: dir,
      runner: fake.runner,
    };
    expect(await runVendor(context)).toBe(0);
    expect(fake.calls).toEqual([]);
    expect(io.noted()).toContain('cluster/compose/localnet');
    expect(io.noted()).toContain(SHA);
  });

  test('a failed fetch removes the temporary directory', async () => {
    const dir = await tempProject(cleaner.dirs);
    await writeFile(join(dir, 'links.csv'), LINKS);
    /** Commands issued. `fetch` fails so the checkout is never moved. */
    const calls: string[][] = [];
    /** Runner that fails the fetch and records everything else as success. */
    const runner: Runner = {
      run(cmd) {
        calls.push(cmd);
        return Promise.resolve(cmd.includes('fetch') ? 1 : 0);
      },
      capture() {
        return Promise.resolve({ code: 0, stdout: '', stderr: '' });
      },
      lines() {
        return (async function* empty() {})();
      },
      background() {
        return { stop() {}, exited: Promise.resolve(0) };
      },
    };
    const context: CommandContext = {
      io: scriptedIo([]).io,
      env: {},
      cwd: dir,
      cliDir: dir,
      dryRun: false,
      project: dir,
      runner,
    };
    expect(await runVendor(context, 'localnet')).toBe(1);
    /** Temporary checkouts left beside the destination. A failed fetch must remove its own. */
    const left = (await readdir(join(dir, 'docker', 'modules'))).filter((name) =>
      name.startsWith('.qs-vendor-'),
    );
    expect(left).toEqual([]);
    expect(calls.some((cmd) => cmd.includes('fetch'))).toBe(true);
    expect(calls.some((cmd) => cmd.includes('checkout'))).toBe(false);
  });

  test('replaces the destination from the sparse checkout', async () => {
    const dir = await tempProject(cleaner.dirs);
    await writeFile(join(dir, 'links.csv'), LINKS);
    /** Previous tree. A successful fetch must remove it. */
    const dest = join(dir, 'docker', 'modules', 'localnet');
    await mkdir(dest, { recursive: true });
    await writeFile(join(dest, 'old.txt'), 'old');
    /** Temporary checkout path, taken from `git init` so the test can plant the source there. */
    let tmp = '';
    const calls: string[][] = [];
    /** Runner that succeeds and, on checkout, writes the file the move should land. */
    const runner: Runner = {
      async run(cmd) {
        calls.push(cmd);
        if (cmd[1] === 'init') tmp = cmd.at(-1) ?? '';
        if (cmd.includes('checkout')) {
          const source = join(tmp, 'cluster/compose/localnet');
          await mkdir(source, { recursive: true });
          await writeFile(join(source, 'compose.yaml'), 'services: {}\n');
        }
        return 0;
      },
      capture() {
        return Promise.resolve({ code: 0, stdout: '', stderr: '' });
      },
      lines() {
        return (async function* empty() {})();
      },
      background() {
        return { stop() {}, exited: Promise.resolve(0) };
      },
    };
    const context: CommandContext = {
      io: scriptedIo([]).io,
      env: {},
      cwd: dir,
      cliDir: dir,
      dryRun: false,
      project: dir,
      runner,
    };
    expect(await runVendor(context, 'localnet')).toBe(0);
    expect(await readFile(join(dest, 'compose.yaml'), 'utf8')).toBe('services: {}\n');
    await expect(readFile(join(dest, 'old.txt'), 'utf8')).rejects.toThrow();
    const left = (await readdir(join(dir, 'docker', 'modules'))).filter((name) =>
      name.startsWith('.qs-vendor-'),
    );
    expect(left).toEqual([]);
    expect(calls.some((cmd) => cmd.includes('fetch'))).toBe(true);
  });

  test('leaves the destination when the checkout has no source', async () => {
    const dir = await tempProject(cleaner.dirs);
    await writeFile(join(dir, 'links.csv'), LINKS);
    /** Tree that must survive a checkout that does not contain the source path. */
    const dest = join(dir, 'docker', 'modules', 'localnet');
    await mkdir(dest, { recursive: true });
    await writeFile(join(dest, 'old.txt'), 'old');
    /** Runner whose git commands succeed and create nothing. */
    const runner: Runner = {
      run() {
        return Promise.resolve(0);
      },
      capture() {
        return Promise.resolve({ code: 0, stdout: '', stderr: '' });
      },
      lines() {
        return (async function* empty() {})();
      },
      background() {
        return { stop() {}, exited: Promise.resolve(0) };
      },
    };
    const context: CommandContext = {
      io: scriptedIo([]).io,
      env: {},
      cwd: dir,
      cliDir: dir,
      dryRun: false,
      project: dir,
      runner,
    };
    await expect(runVendor(context, 'localnet')).rejects.toThrow('Left');
    expect(await readFile(join(dest, 'old.txt'), 'utf8')).toBe('old');
  });

  test('rejects a sha that git could read as an option', async () => {
    const dir = await tempProject(cleaner.dirs);
    await writeFile(join(dir, 'links.csv'), LINKS.replace(SHA, '--upload-pack=evil'));
    const fake = fakeRunner();
    const context: CommandContext = {
      io: scriptedIo([]).io,
      env: {},
      cwd: dir,
      cliDir: dir,
      dryRun: false,
      project: dir,
      runner: fake.runner,
    };
    await expect(runVendor(context, 'localnet')).rejects.toThrow('hex sha');
    expect(fake.calls).toEqual([]);
  });

  test('rejects an abbreviated sha before git fetch', async () => {
    const dir = await tempProject(cleaner.dirs);
    await writeFile(join(dir, 'links.csv'), LINKS.replace(SHA, SHA.slice(0, 7)));
    const fake = fakeRunner();
    const context: CommandContext = {
      io: scriptedIo([]).io,
      env: {},
      cwd: dir,
      cliDir: dir,
      dryRun: false,
      project: dir,
      runner: fake.runner,
    };
    await expect(runVendor(context, 'localnet')).rejects.toThrow('full hex sha');
    expect(fake.calls).toEqual([]);
  });

  test('rejects a destination that leaves the checkout', async () => {
    const dir = await tempProject(cleaner.dirs);
    await writeFile(join(dir, 'links.csv'), LINKS.replace('docker/modules/', '../../outside/'));
    const fake = fakeRunner();
    const context: CommandContext = {
      io: scriptedIo([]).io,
      env: {},
      cwd: dir,
      cliDir: dir,
      dryRun: false,
      project: dir,
      runner: fake.runner,
    };
    await expect(runVendor(context, 'localnet')).rejects.toThrow('relative path');
    expect(fake.calls).toEqual([]);
  });
});

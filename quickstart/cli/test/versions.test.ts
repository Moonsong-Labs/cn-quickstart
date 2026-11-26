// Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: 0BSD

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readSdkLine, rewriteSdkVersion, runVersionsSync } from '../src/commands/versions.ts';
import type { CommandContext } from '../src/lib/context.ts';
import { runCli } from '../src/main.ts';
import { scriptedIo } from './io.ts';
import { projectCleaner, tempProject } from './project-fixture.ts';
import { fakeRunner } from './runner.ts';

/** Temp checkouts for this file. */
const cleaner = projectCleaner();

afterEach(() => cleaner.cleanup());

/** Info document for a network whose current synchronizer is `version`. */
function info(version: string): string {
  return JSON.stringify({
    synchronizer: { current: { version } },
    sv: { migration_id: 4 },
  });
}

/**
 * Fetch stub. `yaml` is the release-line manifest. Any other URL fails.
 */
function fetchVersions(version: string, yaml = 'sdk-version: 3.5.2\n') {
  return async (input: string | URL | Request) => {
    /** Requested URL. */
    const url = String(input);
    if (url.endsWith('/info')) {
      return { ok: true, json: async () => JSON.parse(info(version)), text: async () => '' };
    }
    if (url.includes(`release-line-${version}`)) {
      return { ok: true, text: async () => yaml, json: async () => ({}) };
    }
    return { ok: false, text: async () => '', json: async () => ({}) };
  };
}

describe('readSdkLine', () => {
  test('strips a comment and ignores later lines', () => {
    expect(readSdkLine('# sdk-version: 1\nsdk-version: 3.5.2 # pin\n')).toBe('3.5.2');
  });
});

describe('rewriteSdkVersion', () => {
  test('keeps CRLF and other lines', () => {
    expect(rewriteSdkVersion('name: x\r\nsdk-version: 1.0.0\r\n', '3.5.2')).toBe(
      'name: x\r\nsdk-version: 3.5.2\r\n',
    );
  });
});

describe('runVersionsSync', () => {
  test('rewrites manifests when the answer is yes, and leaves the proto pin', async () => {
    const dir = await tempProject(cleaner.dirs);
    await writeFile(
      join(dir, '.env'),
      'SPLICE_VERSION=0.8.4\nDOCKER_NETWORK=quickstart\nDAML_RUNTIME_VERSION=3.5.14\n',
    );
    await mkdir(join(dir, 'daml', 'licensing', '.daml'), { recursive: true });
    await mkdir(join(dir, 'daml', 'other'), { recursive: true });
    await writeFile(join(dir, 'daml', 'licensing', '.daml', 'daml.yaml'), 'sdk-version: 9\n');
    await writeFile(join(dir, 'daml', 'other', 'daml.yaml'), 'sdk-version: 1.0.0\nname: other\n');
    const io = scriptedIo(['y']);
    const fake = fakeRunner();
    /** Context with a stubbed fetch and no git calls expected. */
    const context: CommandContext = {
      io: io.io,
      env: {},
      cwd: dir,
      cliDir: dir,
      dryRun: false,
      project: dir,
      runner: fake.runner,
      fetch: fetchVersions('0.9.3'),
    };
    expect(
      await runVersionsSync(context, { network: 'dev', tag: false, force: false, copy: false }),
    ).toBe(0);
    expect(await readFile(join(dir, 'daml', 'licensing', 'daml.yaml'), 'utf8')).toBe(
      'sdk-version: 3.5.2\n',
    );
    expect(await readFile(join(dir, 'daml', 'other', 'daml.yaml'), 'utf8')).toBe(
      'sdk-version: 3.5.2\nname: other\n',
    );
    expect(await readFile(join(dir, 'daml', 'licensing', '.daml', 'daml.yaml'), 'utf8')).toBe(
      'sdk-version: 9\n',
    );
    expect(await readFile(join(dir, '.env'), 'utf8')).toBe(
      'SPLICE_VERSION=0.9.3\nDOCKER_NETWORK=quickstart\nDAML_RUNTIME_VERSION=3.5.14\n',
    );
    expect(io.output()).toContain('Update sdk-version to 3.5.2 in daml.yaml');
    expect(io.output()).toContain('(y/N)');
    expect(io.noted()).toContain('sdk-version 3.7.1 -> 3.5.2');
    expect(io.noted()).toContain('sdk-version 1.0.0 -> 3.5.2');
    expect(io.noted()).not.toContain('Left sdk-version unchanged');
    expect(io.noted()).toContain('DAML_RUNTIME_VERSION stays 3.5.14');
    expect(io.noted()).toContain('migration 4');
    expect(io.noted()).toContain('Run qs vendor localnet');
    expect(fake.calls).toEqual([]);
  });

  test('a yes updates only manifests whose sdk-version differs', async () => {
    const dir = await tempProject(cleaner.dirs);
    /** Matching pin with a comment. Rewriting this file would drop the comment. */
    const kept = 'sdk-version: 3.5.2 # keep\n';
    await writeFile(join(dir, 'daml', 'licensing', 'daml.yaml'), kept);
    await mkdir(join(dir, 'daml', 'other'), { recursive: true });
    await writeFile(join(dir, 'daml', 'other', 'daml.yaml'), 'sdk-version: 1.0.0\nname: other\n');
    const io = scriptedIo(['y']);
    const context: CommandContext = {
      io: io.io,
      env: {},
      cwd: dir,
      cliDir: dir,
      dryRun: false,
      project: dir,
      runner: fakeRunner().runner,
      fetch: fetchVersions('0.9.3'),
    };
    expect(
      await runVersionsSync(context, { network: 'dev', tag: false, force: false, copy: false }),
    ).toBe(0);
    expect(await readFile(join(dir, 'daml', 'licensing', 'daml.yaml'), 'utf8')).toBe(kept);
    expect(await readFile(join(dir, 'daml', 'other', 'daml.yaml'), 'utf8')).toBe(
      'sdk-version: 3.5.2\nname: other\n',
    );
    expect(io.noted()).toContain('sdk-version 1.0.0 -> 3.5.2');
    expect(io.noted()).not.toContain('sdk-version 3.5.2 ->');
  });

  test('leaves every daml.yaml unchanged when the answer is no', async () => {
    const dir = await tempProject(cleaner.dirs);
    /** Manifest before a declined update. The Splice pin in `.env` still moves. */
    const before = await readFile(join(dir, 'daml', 'licensing', 'daml.yaml'), 'utf8');
    const io = scriptedIo(['n']);
    const context: CommandContext = {
      io: io.io,
      env: {},
      cwd: dir,
      cliDir: dir,
      dryRun: false,
      project: dir,
      runner: fakeRunner().runner,
      fetch: fetchVersions('0.9.3'),
    };
    expect(
      await runVersionsSync(context, { network: 'dev', tag: false, force: false, copy: false }),
    ).toBe(0);
    expect(await readFile(join(dir, 'daml', 'licensing', 'daml.yaml'), 'utf8')).toBe(before);
    expect(await readFile(join(dir, '.env'), 'utf8')).toContain('SPLICE_VERSION=0.9.3\n');
    expect(io.output()).toContain('(y/N)');
    expect(io.noted()).toContain('SDK 3.5.2');
    expect(io.noted()).toContain('Left sdk-version unchanged.');
    expect(io.noted()).not.toContain('sdk-version 3.7.1 ->');
  });

  test('an empty answer keeps the default and leaves daml.yaml unchanged', async () => {
    const dir = await tempProject(cleaner.dirs);
    /** Manifest before the user presses enter. */
    const before = await readFile(join(dir, 'daml', 'licensing', 'daml.yaml'), 'utf8');
    const io = scriptedIo(['']);
    const context: CommandContext = {
      io: io.io,
      env: {},
      cwd: dir,
      cliDir: dir,
      dryRun: false,
      project: dir,
      runner: fakeRunner().runner,
      fetch: fetchVersions('0.9.3'),
    };
    expect(
      await runVersionsSync(context, { network: 'dev', tag: false, force: false, copy: false }),
    ).toBe(0);
    expect(await readFile(join(dir, 'daml', 'licensing', 'daml.yaml'), 'utf8')).toBe(before);
    expect(await readFile(join(dir, '.env'), 'utf8')).toContain('SPLICE_VERSION=0.9.3\n');
    expect(io.output()).toContain('(y/N)');
    expect(io.noted()).toContain('Left sdk-version unchanged.');
    expect(io.noted()).not.toContain('sdk-version 3.7.1 ->');
  });

  test('does not ask or rewrite when every sdk-version already matches', async () => {
    const dir = await tempProject(cleaner.dirs);
    /** Pin that already matches the release, including a comment a rewrite would drop. */
    const pinned = 'sdk-version: 3.5.2 # keep\n';
    await writeFile(join(dir, 'daml', 'licensing', 'daml.yaml'), pinned);
    await mkdir(join(dir, 'daml', 'other'), { recursive: true });
    await writeFile(join(dir, 'daml', 'other', 'daml.yaml'), '  sdk-version:   3.5.2\n');
    await mkdir(join(dir, 'daml', 'licensing', '.daml'), { recursive: true });
    await writeFile(join(dir, 'daml', 'licensing', '.daml', 'daml.yaml'), 'sdk-version: 9\n');
    const io = scriptedIo([]);
    const context: CommandContext = {
      io: io.io,
      env: {},
      cwd: dir,
      cliDir: dir,
      dryRun: false,
      project: dir,
      runner: fakeRunner().runner,
      fetch: fetchVersions('0.9.3'),
    };
    expect(
      await runVersionsSync(context, { network: 'dev', tag: false, force: false, copy: false }),
    ).toBe(0);
    expect(io.output()).toBe('');
    expect(await readFile(join(dir, 'daml', 'licensing', 'daml.yaml'), 'utf8')).toBe(pinned);
    expect(await readFile(join(dir, 'daml', 'other', 'daml.yaml'), 'utf8')).toBe(
      '  sdk-version:   3.5.2\n',
    );
    expect(await readFile(join(dir, '.env'), 'utf8')).toContain('SPLICE_VERSION=0.9.3\n');
    expect(io.noted()).toContain('SDK 3.5.2');
    expect(io.noted()).not.toContain('Left sdk-version unchanged');
    expect(io.noted()).not.toContain('sdk-version 3.5.2 ->');
  });

  test('end of input leaves sdk-version unchanged and exits 0', async () => {
    const dir = await tempProject(cleaner.dirs);
    /** Manifest before a closed stdin. End of input must not become exit 1. */
    const before = await readFile(join(dir, 'daml', 'licensing', 'daml.yaml'), 'utf8');
    const io = scriptedIo([]);
    /** Process status. A closed stdin must stay 0, the same as answering no. */
    const code = await runCli(['versions', 'sync', '--project', dir], io.io, {
      cwd: dir,
      env: {},
      fetch: fetchVersions('0.9.3'),
    });
    expect(code).toBe(0);
    expect(await readFile(join(dir, 'daml', 'licensing', 'daml.yaml'), 'utf8')).toBe(before);
    expect(await readFile(join(dir, '.env'), 'utf8')).toContain('SPLICE_VERSION=0.9.3\n');
    expect(io.output()).toContain('Update sdk-version to 3.5.2 in daml.yaml');
    expect(io.output()).toContain('(y/N)');
    expect(io.noted()).toContain('Left sdk-version unchanged.');
    expect(io.noted()).not.toContain('End of input');
  });

  test('dry-run fetches and writes nothing', async () => {
    const dir = await tempProject(cleaner.dirs);
    /** Manifest before the command. */
    const before = await readFile(join(dir, 'daml', 'licensing', 'daml.yaml'), 'utf8');
    /** Env file before the command. A dry run must not apply the fetched Splice pin either. */
    const envBefore = await readFile(join(dir, '.env'), 'utf8');
    const io = scriptedIo(['y']);
    const context: CommandContext = {
      io: io.io,
      env: {},
      cwd: dir,
      cliDir: dir,
      dryRun: true,
      project: dir,
      runner: fakeRunner().runner,
      fetch: fetchVersions('0.9.3'),
    };
    expect(
      await runVersionsSync(context, { network: 'dev', tag: true, force: false, copy: true }),
    ).toBe(0);
    expect(await readFile(join(dir, 'daml', 'licensing', 'daml.yaml'), 'utf8')).toBe(before);
    expect(await readFile(join(dir, '.env'), 'utf8')).toBe(envBefore);
    expect(io.output()).toContain('Update sdk-version to 3.5.2 in daml.yaml');
    expect(io.output()).toContain('(y/N)');
    expect(io.noted()).toContain('sdk-version 3.7.1 -> 3.5.2');
    expect(io.noted()).toContain('.env: SPLICE_VERSION -> 0.9.3');
    expect(io.noted()).not.toContain('Left sdk-version unchanged');
    expect(io.noted()).toContain('Would tag splice-0.9.3');
    expect(io.noted()).toContain('Would copy DARs');
    expect(io.noted()).not.toContain('No sibling');
  });

  test('refuses an existing tag unless --force', async () => {
    const dir = await tempProject(cleaner.dirs);
    const existing = fakeRunner([{ code: 0 }]);
    const io = scriptedIo([]);
    /** Context whose tag lookup succeeds, so the tag is already there. */
    const context: CommandContext = {
      io: io.io,
      env: {},
      cwd: dir,
      cliDir: dir,
      dryRun: false,
      project: dir,
      runner: existing.runner,
      fetch: fetchVersions('0.8.4'),
    };
    await expect(
      runVersionsSync(context, { network: 'dev', tag: true, force: false, copy: false }),
    ).rejects.toThrow('already exists');
    expect(io.output()).not.toContain('Update sdk-version');
    expect(await readFile(join(dir, '.env'), 'utf8')).toContain('SPLICE_VERSION=0.10.2');
    expect(existing.calls.some((call) => call.cmd[0] === 'git' && call.cmd[1] === 'tag')).toBe(
      false,
    );
  });

  test('--force deletes the tag and creates it again', async () => {
    const dir = await tempProject(cleaner.dirs);
    const fake = fakeRunner([{ code: 0 }]);
    const context: CommandContext = {
      io: scriptedIo([]).io,
      env: {},
      cwd: dir,
      cliDir: dir,
      dryRun: false,
      project: dir,
      runner: fake.runner,
      fetch: fetchVersions('0.8.4'),
    };
    expect(
      await runVersionsSync(context, { network: 'dev', tag: true, force: true, copy: false }),
    ).toBe(0);
    expect(fake.calls.map((call) => call.cmd)).toEqual([
      ['git', 'rev-parse', '--verify', '--quiet', 'refs/tags/splice-0.8.4'],
      ['git', 'status', '--porcelain'],
      ['git', 'tag', '-d', 'splice-0.8.4'],
      ['git', 'tag', 'splice-0.8.4', '-m', 'Works against Canton Network version running 0.8.4'],
    ]);
  });

  test('keeps a trailing CRLF newline in .env', async () => {
    const dir = await tempProject(cleaner.dirs);
    await writeFile(join(dir, '.env'), 'SPLICE_VERSION=0.8.4\r\nDOCKER_NETWORK=quickstart\r\n');
    const context: CommandContext = {
      io: scriptedIo([]).io,
      env: {},
      cwd: dir,
      cliDir: dir,
      dryRun: false,
      project: dir,
      runner: fakeRunner().runner,
      fetch: fetchVersions('0.9.3'),
    };
    expect(
      await runVersionsSync(context, { network: 'dev', tag: false, force: false, copy: false }),
    ).toBe(0);
    expect(await readFile(join(dir, '.env'), 'utf8')).toBe(
      'SPLICE_VERSION=0.9.3\r\nDOCKER_NETWORK=quickstart\r\n',
    );
  });

  test('rejects a version that is not a plain version and writes nothing', async () => {
    const dir = await tempProject(cleaner.dirs);
    /** Env file before a bad payload. It must be unchanged. */
    const before = await readFile(join(dir, '.env'), 'utf8');
    const context: CommandContext = {
      io: scriptedIo([]).io,
      env: {},
      cwd: dir,
      cliDir: dir,
      dryRun: false,
      project: dir,
      runner: fakeRunner().runner,
      fetch: fetchVersions('0.9.3\nEVIL=1'),
    };
    await expect(
      runVersionsSync(context, { network: 'dev', tag: false, force: false, copy: false }),
    ).rejects.toThrow('Refusing Splice version');
    expect(await readFile(join(dir, '.env'), 'utf8')).toBe(before);
  });

  test('rejects an SDK version that is not a plain version and writes nothing', async () => {
    const dir = await tempProject(cleaner.dirs);
    /** Manifest before a bad SDK line. It must be unchanged. */
    const manifest = join(dir, 'daml', 'licensing', 'daml.yaml');
    const before = await readFile(manifest, 'utf8');
    const context: CommandContext = {
      io: scriptedIo([]).io,
      env: {},
      cwd: dir,
      cliDir: dir,
      dryRun: false,
      project: dir,
      runner: fakeRunner().runner,
      fetch: fetchVersions('0.9.3', 'sdk-version: ../not-a-version\n'),
    };
    await expect(
      runVersionsSync(context, { network: 'dev', tag: false, force: false, copy: false }),
    ).rejects.toThrow('Refusing SDK version');
    expect(await readFile(manifest, 'utf8')).toBe(before);
  });

  test('does not write when --copy has no sibling checkout', async () => {
    /** Nested so `../../splice` stays inside this test's temp root. */
    const dir = await tempProject(cleaner.dirs, undefined, true);
    /** Env file before the refused copy. The version fetch must not land. */
    const before = await readFile(join(dir, '.env'), 'utf8');
    /** Captured prompts. A missing sibling must be reported before any question. */
    const io = scriptedIo([]);
    const context: CommandContext = {
      io: io.io,
      env: {},
      cwd: dir,
      cliDir: dir,
      dryRun: false,
      project: dir,
      runner: fakeRunner().runner,
      fetch: fetchVersions('0.9.3'),
    };
    await expect(
      runVersionsSync(context, { network: 'dev', tag: false, force: false, copy: true }),
    ).rejects.toThrow('No sibling Splice checkout');
    expect(io.output()).not.toContain('Update sdk-version');
    expect(await readFile(join(dir, '.env'), 'utf8')).toBe(before);
  });

  test('does not write when the sibling checkout has no daml/dars', async () => {
    /** Nested so `../../splice` stays inside this test's temp root. */
    const dir = await tempProject(cleaner.dirs, undefined, true);
    /** Env file before the refused copy. The version fetch must not land. */
    const before = await readFile(join(dir, '.env'), 'utf8');
    /** Same path `assertSiblingSplice` checks: two directories above `quickstart/`. */
    const sibling = join(dir, '..', '..', 'splice');
    await mkdir(sibling);
    const context: CommandContext = {
      io: scriptedIo([]).io,
      env: {},
      cwd: dir,
      cliDir: dir,
      dryRun: false,
      project: dir,
      runner: fakeRunner().runner,
      fetch: fetchVersions('0.9.3'),
    };
    await expect(
      runVersionsSync(context, { network: 'dev', tag: false, force: false, copy: true }),
    ).rejects.toThrow('daml/dars');
    expect(await readFile(join(dir, '.env'), 'utf8')).toBe(before);
  });

  test('refuses to tag a dirty tree after the rewrite', async () => {
    const dir = await tempProject(cleaner.dirs);
    /** Tag is absent, then the working tree is dirty, so no `git tag` runs. */
    const fake = fakeRunner([{ code: 1 }, { stdout: ' M .env\n' }]);
    const context: CommandContext = {
      io: scriptedIo([]).io,
      env: {},
      cwd: dir,
      cliDir: dir,
      dryRun: false,
      project: dir,
      runner: fake.runner,
      fetch: fetchVersions('0.9.3'),
    };
    await expect(
      runVersionsSync(context, { network: 'dev', tag: true, force: false, copy: false }),
    ).rejects.toThrow('Commit the version update');
    expect(await readFile(join(dir, '.env'), 'utf8')).toContain('SPLICE_VERSION=0.9.3\n');
    expect(fake.calls.some((call) => call.cmd[1] === 'tag')).toBe(false);
  });

  test('rejects the old synchronizer.active shape', async () => {
    const dir = await tempProject(cleaner.dirs);
    const context: CommandContext = {
      io: scriptedIo([]).io,
      env: {},
      cwd: dir,
      cliDir: dir,
      dryRun: false,
      project: dir,
      runner: fakeRunner().runner,
      fetch: async () => ({
        ok: true,
        json: async () => ({ synchronizer: { active: { version: '0.9.3' } } }),
        text: async () => '',
      }),
    };
    await expect(
      runVersionsSync(context, { network: 'dev', tag: false, force: false, copy: false }),
    ).rejects.toThrow('Could not read the Splice version');
  });
});

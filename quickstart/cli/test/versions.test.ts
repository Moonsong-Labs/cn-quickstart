// Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: 0BSD

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readSdkLine, rewriteSdkVersion, runVersionsSync } from '../src/commands/versions.ts';
import type { CommandContext } from '../src/lib/context.ts';
import { scriptedIo } from './io.ts';
import {
  projectCleaner,
  TEST_LOCALNET_REPO,
  TEST_LOCALNET_SHA,
  tempProject,
} from './project-fixture.ts';
import { fakeRunner } from './runner.ts';

/** Temp checkouts for this file. */
const cleaner = projectCleaner();

afterEach(() => cleaner.cleanup());

/** Full commit SHA returned by stubbed `git ls-remote` for a bumped Splice release tag. */
const BUMPED_SHA = 'de3724016885ba7c88cb8bf8b94c47682386b5f5';

/** Annotated tag object SHA used to verify `^{}` dereferencing. */
const TAG_OBJECT_SHA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

/** Scripted `git ls-remote` output for lightweight tag `version`. */
function lsRemoteTag(version: string, sha = BUMPED_SHA): { stdout: string } {
  return { stdout: `${sha}\trefs/tags/${version}\n` };
}

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
  test('rewrites manifests, SPLICE_VERSION, and links.csv and leaves the proto pin', async () => {
    const dir = await tempProject(cleaner.dirs);
    await writeFile(
      join(dir, '.env'),
      'SPLICE_VERSION=0.8.4\nDOCKER_NETWORK=quickstart\nDAML_RUNTIME_VERSION=3.5.14\n',
    );
    await mkdir(join(dir, 'daml', 'licensing', '.daml'), { recursive: true });
    await mkdir(join(dir, 'daml', 'other'), { recursive: true });
    await writeFile(join(dir, 'daml', 'licensing', '.daml', 'daml.yaml'), 'sdk-version: 9\n');
    await writeFile(join(dir, 'daml', 'other', 'daml.yaml'), 'sdk-version: 1.0.0\nname: other\n');
    const io = scriptedIo([]);
    const fake = fakeRunner([lsRemoteTag('0.9.3')]);
    /** Context with a stubbed fetch and scripted tag lookup for the bumped Splice release. */
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
    expect(await readFile(join(dir, 'links.csv'), 'utf8')).toContain(
      `${TEST_LOCALNET_REPO},${BUMPED_SHA},cluster/compose/localnet,.cache`,
    );
    expect(io.noted()).toContain('DAML_RUNTIME_VERSION stays 3.5.14');
    expect(io.noted()).toContain('migration 4');
    expect(io.noted()).toContain(`links.csv: localnet ${TEST_LOCALNET_SHA} -> ${BUMPED_SHA}`);
    expect(io.noted()).not.toContain('Run qs vendor localnet');
    expect(fake.calls.map((call) => call.cmd)).toEqual([
      ['git', 'ls-remote', '--tags', TEST_LOCALNET_REPO, 'refs/tags/0.9.3', 'refs/tags/0.9.3^{}'],
    ]);
  });

  test('prefers the dereferenced commit SHA for an annotated Splice tag', async () => {
    const dir = await tempProject(cleaner.dirs);
    const fake = fakeRunner([
      {
        stdout: `${TAG_OBJECT_SHA}\trefs/tags/0.11.0\n${BUMPED_SHA}\trefs/tags/0.11.0^{}\n`,
      },
    ]);
    const context: CommandContext = {
      io: scriptedIo([]).io,
      env: {},
      cwd: dir,
      cliDir: dir,
      dryRun: false,
      project: dir,
      runner: fake.runner,
      fetch: fetchVersions('0.11.0'),
    };
    expect(
      await runVersionsSync(context, { network: 'dev', tag: false, force: false, copy: false }),
    ).toBe(0);
    expect(await readFile(join(dir, 'links.csv'), 'utf8')).toContain(BUMPED_SHA);
    expect(await readFile(join(dir, 'links.csv'), 'utf8')).not.toContain(TAG_OBJECT_SHA);
  });

  test('fails without writing any files when the bumped Splice tag cannot be resolved', async () => {
    const dir = await tempProject(cleaner.dirs);
    /** Env and links snapshots taken before the failed sync. Both must stay untouched. */
    const envBefore = await readFile(join(dir, '.env'), 'utf8');
    const linksBefore = await readFile(join(dir, 'links.csv'), 'utf8');
    const context: CommandContext = {
      io: scriptedIo([]).io,
      env: {},
      cwd: dir,
      cliDir: dir,
      dryRun: false,
      project: dir,
      runner: fakeRunner([{ stdout: '' }]).runner,
      fetch: fetchVersions('0.11.0'),
    };
    await expect(
      runVersionsSync(context, { network: 'dev', tag: false, force: false, copy: false }),
    ).rejects.toThrow("Could not find Splice tag '0.11.0'");
    expect(await readFile(join(dir, '.env'), 'utf8')).toBe(envBefore);
    expect(await readFile(join(dir, 'links.csv'), 'utf8')).toBe(linksBefore);
  });

  test('dry-run fetches and writes nothing', async () => {
    const dir = await tempProject(cleaner.dirs);
    /** Manifest and links.csv before the command. */
    const before = await readFile(join(dir, 'daml', 'licensing', 'daml.yaml'), 'utf8');
    const linksBefore = await readFile(join(dir, 'links.csv'), 'utf8');
    const io = scriptedIo([]);
    const context: CommandContext = {
      io: io.io,
      env: {},
      cwd: dir,
      cliDir: dir,
      dryRun: true,
      project: dir,
      runner: fakeRunner([lsRemoteTag('0.9.3')]).runner,
      fetch: fetchVersions('0.9.3'),
    };
    expect(
      await runVersionsSync(context, { network: 'dev', tag: true, force: false, copy: true }),
    ).toBe(0);
    expect(await readFile(join(dir, 'daml', 'licensing', 'daml.yaml'), 'utf8')).toBe(before);
    expect(await readFile(join(dir, 'links.csv'), 'utf8')).toBe(linksBefore);
    expect(io.noted()).toContain(`links.csv: localnet ${TEST_LOCALNET_SHA} -> ${BUMPED_SHA}`);
    expect(io.noted()).toContain('Would tag splice-0.9.3');
    expect(io.noted()).toContain('Would copy DARs');
    expect(io.noted()).not.toContain('No sibling');
  });

  test('refuses an existing tag unless --force', async () => {
    const dir = await tempProject(cleaner.dirs);
    const existing = fakeRunner([lsRemoteTag('0.8.4'), { code: 0 }]);
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
    expect(existing.calls.some((call) => call.cmd[0] === 'git' && call.cmd[1] === 'tag')).toBe(
      false,
    );
  });

  test('--force deletes the tag and creates it again', async () => {
    const dir = await tempProject(cleaner.dirs);
    await writeFile(join(dir, '.env'), 'SPLICE_VERSION=0.8.4\nDOCKER_NETWORK=quickstart\n');
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
      runner: fakeRunner([lsRemoteTag('0.9.3')]).runner,
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
    const context: CommandContext = {
      io: scriptedIo([]).io,
      env: {},
      cwd: dir,
      cliDir: dir,
      dryRun: false,
      project: dir,
      runner: fakeRunner([lsRemoteTag('0.9.3')]).runner,
      fetch: fetchVersions('0.9.3'),
    };
    await expect(
      runVersionsSync(context, { network: 'dev', tag: false, force: false, copy: true }),
    ).rejects.toThrow('No sibling Splice checkout');
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
      runner: fakeRunner([lsRemoteTag('0.9.3')]).runner,
      fetch: fetchVersions('0.9.3'),
    };
    await expect(
      runVersionsSync(context, { network: 'dev', tag: false, force: false, copy: true }),
    ).rejects.toThrow('daml/dars');
    expect(await readFile(join(dir, '.env'), 'utf8')).toBe(before);
  });

  test('refuses to tag a dirty tree after the rewrite', async () => {
    const dir = await tempProject(cleaner.dirs);
    /** Tag commit lookup succeeds, tag is absent, then the working tree is dirty, so no `git tag` runs. */
    const fake = fakeRunner([lsRemoteTag('0.9.3'), { code: 1 }, { stdout: ' M .env\n' }]);
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

// Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: 0BSD

import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type ComposeCall, compose, composeArgs, composeEnv } from '../src/lib/compose.ts';
import type { CommandContext } from '../src/lib/context.ts';
import type { Runner } from '../src/lib/exec.ts';
import { type Project, readProject, type Settings } from '../src/lib/project.ts';
import { scriptedIo } from './io.ts';
import { projectCleaner, TEST_LOCALNET_SHA, tempProject } from './project-fixture.ts';
import { fakeRunner } from './runner.ts';

/** Temp checkouts for Compose cache-fetch tests. */
const cleaner = projectCleaner();

afterEach(() => cleaner.cleanup());

/** Captured `make -n compose-config` argument lists, keyed by the five Makefile variables. */
const cases = JSON.parse(
  readFileSync(new URL('./fixtures/make-compose-args.json', import.meta.url), 'utf8'),
) as Record<string, string[]>;

/**
 * Settings for one fixture key. Paths use the `<project>` prefix the fixture was normalised to.
 */
function settingsFor(key: string): Settings {
  /** `name=value` pairs from the fixture key. */
  const parts = Object.fromEntries(key.split(',').map((item) => item.split('=')));
  return {
    authMode: parts.auth === 'oauth2' ? 'oauth2' : 'shared-secret',
    partyHint: undefined,
    testMode: undefined,
    resourceConstraints: parts.constraints === 'true',
    debug: parts.debug === 'true',
    pqsAppUser: parts.pqsUser === 'on',
    pqsSv: parts.pqsSv === 'on',
    splice: '0.8.4',
    dockerNetwork: 'quickstart',
    modulesDir: '<project>/docker/modules',
    localnetDir: '<project>/.cache/localnet/<sha>',
    extraComposeFiles: [],
    extraEnvFiles: [],
  };
}

describe('composeArgs', () => {
  test('matches make -n compose-config for every profile combination', () => {
    for (const [key, expected] of Object.entries(cases)) {
      /** Arguments our builder produces, wrapped the way Make invokes Compose. */
      const actual = ['docker', 'compose', ...composeArgs(settingsFor(key)), 'config'];
      expect(actual, key).toEqual(expected);
    }
  });

  test('appends extra files after the built-in lists', () => {
    /** Base settings with one extra compose file and one extra env file. */
    const settings = settingsFor(
      'auth=shared-secret,constraints=false,debug=false,pqsUser=off,pqsSv=off',
    );
    settings.extraComposeFiles = ['./mine.yaml'];
    settings.extraEnvFiles = ['./mine.env'];
    /** Built argument list. */
    const args = composeArgs(settings);
    expect(args.indexOf('./mine.yaml')).toBeGreaterThan(
      args.indexOf('./docker/backend-service/debug.yaml') === -1
        ? args.indexOf(`${settings.modulesDir}/pqs/compose.yaml`)
        : args.indexOf('./docker/backend-service/debug.yaml'),
    );
    expect(args.indexOf('./mine.yaml')).toBeLessThan(args.indexOf('--env-file'));
    expect(args.indexOf('./mine.env')).toBeGreaterThan(
      args.lastIndexOf(`${settings.modulesDir}/pqs/compose.env`),
    );
    expect(args.indexOf('./mine.env')).toBeLessThan(args.indexOf('--profile'));
  });
});

describe('composeEnv', () => {
  test('keeps a shell override and hides file keys the shell did not set', () => {
    /** Checkout with two file keys, one of which the shell also set. */
    const project = {
      dir: '/work/quickstart',
      fileEnv: new Map([
        ['SPLICE_VERSION', '0.8.4'],
        ['AUTH_MODE', 'oauth2'],
      ]),
      fileKeys: new Set(['SPLICE_VERSION', 'AUTH_MODE']),
      hasEnvLocal: true,
      settings: settingsFor('auth=oauth2,constraints=true,debug=false,pqsUser=off,pqsSv=off'),
    } satisfies Project;
    project.settings.modulesDir = '/work/quickstart/docker/modules';
    project.settings.localnetDir = '/work/quickstart/docker/modules/localnet';
    project.settings.splice = '0.8.4';
    /** Child environment. The AUTH_MODE override stays; SPLICE_VERSION is left to the env file. */
    const env = composeEnv({ PATH: '/usr/bin', AUTH_MODE: 'shared-secret', KEEP: 'yes' }, project);
    expect(env.AUTH_MODE).toBe('shared-secret');
    expect(env.SPLICE_VERSION).toBeUndefined();
    expect(env.KEEP).toBe('yes');
    expect(env.PATH).toBe('/usr/bin');
    expect(env.IMAGE_TAG).toBe('0.8.4');
    expect(env.MODULES_DIR).toBe('/work/quickstart/docker/modules');
    expect(env.LOCALNET_DIR).toBe('/work/quickstart/docker/modules/localnet');
  });

  test('keeps TEST_* identity variables that are not in the env files', () => {
    /** Checkout whose files define TEST_MODE and leave the request tag to the process. */
    const project = {
      dir: '/work/quickstart',
      fileEnv: new Map([['TEST_MODE', 'on']]),
      fileKeys: new Set(['TEST_MODE']),
      hasEnvLocal: true,
      settings: settingsFor('auth=oauth2,constraints=true,debug=false,pqsUser=off,pqsSv=off'),
    } satisfies Project;
    /** Child environment. The non-empty TEST_MODE override stays; the other Playwright keys stay too. */
    const env = composeEnv(
      {
        TEST_MODE: 'off',
        TEST_UNIQUE_REQUEST_TAG: 'tag-1',
        TEST_AUTH_APP_USER_WALLET_ADMIN_USER_NAME: 'alice',
        TEST_AUTH_APP_USER_WALLET_ADMIN_USER_ID: 'id-1',
        TEST_APP_USER_PARTY: 'party-1',
      },
      project,
    );
    expect(env.TEST_MODE).toBe('off');
    expect(env.TEST_UNIQUE_REQUEST_TAG).toBe('tag-1');
    expect(env.TEST_AUTH_APP_USER_WALLET_ADMIN_USER_NAME).toBe('alice');
    expect(env.TEST_AUTH_APP_USER_WALLET_ADMIN_USER_ID).toBe('id-1');
    expect(env.TEST_APP_USER_PARTY).toBe('party-1');
  });

  test('drops an empty shell value so Compose reads the env file', () => {
    /** Checkout whose AUTH_MODE is set in a file and blank in the shell. */
    const project = {
      dir: '/work/quickstart',
      fileEnv: new Map([['AUTH_MODE', 'oauth2']]),
      fileKeys: new Set(['AUTH_MODE']),
      hasEnvLocal: true,
      settings: settingsFor('auth=oauth2,constraints=true,debug=false,pqsUser=off,pqsSv=off'),
    } satisfies Project;
    expect(composeEnv({ AUTH_MODE: '' }, project).AUTH_MODE).toBeUndefined();
  });
});

/** Captured `make -n` argument lists for the console, shell, and install request. */
const oneshot = JSON.parse(
  readFileSync(new URL('./fixtures/make-oneshot-args.json', import.meta.url), 'utf8'),
) as Record<string, string[]>;

/**
 * Settings for one console, shell, or install-request fixture key.
 * Constraints default to on, matching the Makefile.
 */
function oneshotSettings(key: string): Settings {
  /** `name=value` pairs from the fixture key. */
  const parts = Object.fromEntries(key.split(',').map((item) => item.split('=')));
  return {
    authMode: parts.auth === 'oauth2' ? 'oauth2' : 'shared-secret',
    partyHint: undefined,
    testMode: undefined,
    resourceConstraints: parts.constraints !== 'false',
    debug: false,
    pqsAppUser: false,
    pqsSv: false,
    splice: '0.8.4',
    dockerNetwork: 'quickstart',
    modulesDir: '<project>/docker/modules',
    localnetDir: '<project>/.cache/localnet/<sha>',
    extraComposeFiles: [],
    extraEnvFiles: [],
  };
}

/**
 * Stack options for a fixture key.
 * The console uses the app stack. The shell and install request use their own files.
 */
function oneshotCall(key: string): ComposeCall {
  /** Target name from the fixture key. */
  const target = key
    .split(',')
    .find((item) => item.startsWith('target='))
    ?.slice('target='.length);
  if (target === 'shell') return { stack: 'daml-shell', constraints: false };
  if (target === 'install-request') return { stack: 'install-request', constraints: false };
  return {};
}

describe('composeArgs console, shell, and install request', () => {
  test('matches make -n up to the run subcommand', () => {
    for (const [key, expected] of Object.entries(oneshot)) {
      /** Index of `run`. The container name is added by the command, not by composeArgs. */
      const runAt = expected.indexOf('run');
      /** Arguments our builder produces, wrapped the way Make invokes Compose. */
      const actual = ['docker', 'compose', ...composeArgs(oneshotSettings(key), oneshotCall(key))];
      expect(actual, key).toEqual(expected.slice(0, runAt));
    }
  });

  test('appends extra env files after the shell env file', () => {
    /** Shared-secret shell settings plus one user env file. */
    const settings = oneshotSettings('target=shell,auth=shared-secret');
    settings.extraEnvFiles = ['./mine.env'];
    /** Built argument list. */
    const args = composeArgs(settings, { stack: 'daml-shell' });
    expect(args.indexOf('./mine.env')).toBeGreaterThan(
      args.indexOf(`${settings.modulesDir}/daml-shell/compose.env`),
    );
  });
});

describe('compose cache fetch', () => {
  test('fetches LocalNet into the cache before running docker compose when missing', async () => {
    const dir = await tempProject(cleaner.dirs, 'AUTH_MODE=shared-secret\nPARTY_HINT=App-User-1\n');
    /** Expected commit-keyed cache directory, deleted to simulate a cold cache. */
    const cacheDir = join(dir, '.cache', 'localnet', TEST_LOCALNET_SHA);
    await rm(cacheDir, { recursive: true, force: true });
    /** Recorded commands across both git fetch and docker compose. */
    const calls: string[][] = [];
    /** Temporary sparse checkout created by `git init`, populated on `checkout`. */
    let tmp = '';
    /** Runner that populates the sparse checkout on `git checkout` and records every call. */
    const runner: Runner = {
      async run(cmd) {
        calls.push(cmd);
        if (cmd[0] === 'git' && cmd[1] === 'init') tmp = cmd.at(-1) ?? '';
        if (cmd[0] === 'git' && cmd.includes('checkout')) {
          /** Simulated sparse checkout tree. */
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
    const project = readProject(dir, {});
    const context: CommandContext = {
      io: scriptedIo([]).io,
      env: {},
      cwd: dir,
      cliDir: dir,
      dryRun: false,
      project: dir,
      runner,
    };
    expect(await compose(context, project, ['ps'])).toBe(0);
    expect(calls.some((cmd) => cmd[0] === 'git' && cmd.includes('fetch'))).toBe(true);
    expect(calls.at(-1)?.slice(0, 2)).toEqual(['docker', 'compose']);
    expect(calls.at(-1)).toContain(`${cacheDir}/compose.yaml`);
    expect(calls.at(-1)).toContain(`${dir}/docker/modules/localnet-overrides/compose.yaml`);
  });

  test('does not fetch when LOCALNET_DIR is explicitly set', async () => {
    const dir = await tempProject(cleaner.dirs, 'LOCALNET_DIR=/custom/offline/localnet\n');
    const fake = fakeRunner();
    const project = readProject(dir, {});
    const context: CommandContext = {
      io: scriptedIo([]).io,
      env: {},
      cwd: dir,
      cliDir: dir,
      dryRun: false,
      project: dir,
      runner: fake.runner,
    };
    expect(await compose(context, project, ['ps'])).toBe(0);
    expect(fake.calls.map((call) => call.cmd[0])).toEqual(['docker']);
    expect(fake.calls[0]?.cmd).toContain('/custom/offline/localnet/compose.yaml');
  });

  test('stops before docker compose when the LocalNet fetch fails', async () => {
    const dir = await tempProject(cleaner.dirs, 'AUTH_MODE=shared-secret\n');
    await rm(join(dir, '.cache', 'localnet', TEST_LOCALNET_SHA), { recursive: true, force: true });
    /** Recorded commands. Compose must not run after a failed git fetch. */
    const calls: string[][] = [];
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
    const project = readProject(dir, {});
    const context: CommandContext = {
      io: scriptedIo([]).io,
      env: {},
      cwd: dir,
      cliDir: dir,
      dryRun: false,
      project: dir,
      runner,
    };
    expect(await compose(context, project, ['ps'])).toBe(1);
    expect(calls.some((cmd) => cmd[0] === 'docker')).toBe(false);
  });
});

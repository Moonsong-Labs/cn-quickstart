// Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: 0BSD

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { composeArgs, composeEnv } from '../src/lib/compose.ts';
import type { Project, Settings } from '../src/lib/project.ts';

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
    localnetDir: '<project>/docker/modules/localnet',
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

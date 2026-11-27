// Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: 0BSD

import { afterEach, describe, expect, test } from 'bun:test';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { composeArgs } from '../src/lib/compose.ts';
import { loadProject, readProject } from '../src/lib/project.ts';
import { projectCleaner, TEST_LOCALNET_SHA, tempProject } from './project-fixture.ts';

/** Temp checkouts for this file. */
const cleaner = projectCleaner();

/** `$` followed by `{name}`, the brace form Make expands in an included env file. */
function braced(name: string): string {
  return ['$', '{', name, '}'].join('');
}

afterEach(() => cleaner.cleanup());

describe('readProject', () => {
  test('prefers a non-empty shell value, then .env.local, then .env', async () => {
    const dir = await tempProject(cleaner.dirs, 'AUTH_MODE=oauth2\nPARTY_HINT=App-User-1\n');
    await writeFile(
      join(dir, '.env'),
      'SPLICE_VERSION=0.8.4\nAUTH_MODE=shared-secret\nPARTY_HINT=From-Env-1\n',
      'utf8',
    );
    /** Settings. AUTH_MODE comes from the shell. PARTY_HINT is only in the files. */
    const project = readProject(dir, { AUTH_MODE: 'shared-secret' });
    expect(project.settings.authMode).toBe('shared-secret');
    expect(project.settings.partyHint).toBe('App-User-1');
    expect(project.settings.splice).toBe('0.8.4');
    expect(project.settings.resourceConstraints).toBe(true);
  });

  test('uses the integration env for both profile selection and Compose interpolation', async () => {
    /** A developer checkout whose local profile differs from the test network. */
    const dir = await tempProject(cleaner.dirs, 'AUTH_MODE=shared-secret\nDEBUG_ENABLED=true\n');
    /** Explicit fixture passed to Compose in place of the developer configuration. */
    const fixture = join(dir, 'integration.env');
    await writeFile(fixture, 'AUTH_MODE=oauth2\n');
    /** Both CLI settings and Compose must use the same file. */
    const project = readProject(dir, {}, fixture);
    expect(project.settings.debug).toBe(false);
    expect(project.settings.authMode).toBe('oauth2');
    expect(composeArgs(project.settings)).toContain(fixture);
    expect(composeArgs(project.settings)).not.toContain('.env.local');
  });

  test('ignores an empty shell value and uses the file', async () => {
    const dir = await tempProject(cleaner.dirs, 'AUTH_MODE=oauth2\n');
    expect(readProject(dir, { AUTH_MODE: '' }).settings.authMode).toBe('oauth2');
  });

  test('turns resource constraints off only for a value other than true', async () => {
    const dir = await tempProject(cleaner.dirs, 'RESOURCE_CONSTRAINTS_ENABLED=false\n');
    expect(readProject(dir, {}).settings.resourceConstraints).toBe(false);
    /** Shell override. A non-empty environment value turns them back on. */
    expect(
      readProject(dir, { RESOURCE_CONSTRAINTS_ENABLED: 'true' }).settings.resourceConstraints,
    ).toBe(true);
  });

  test('expands a braced MODULES_DIR in LOCALNET_DIR', async () => {
    const dir = await tempProject(cleaner.dirs, `LOCALNET_DIR=${braced('MODULES_DIR')}/localnet\n`);
    /** Settings. MODULES_DIR is unset, so the reference uses the checkout default. */
    const project = readProject(dir, {});
    expect(project.settings.modulesDir).toBe(join(dir, 'docker', 'modules'));
    expect(project.settings.localnetDir).toBe(join(dir, 'docker', 'modules', 'localnet'));
  });

  test('expands $(MODULES_DIR) and a shell override of the referenced name', async () => {
    const dir = await tempProject(cleaner.dirs, 'LOCALNET_DIR=$(MODULES_DIR)/localnet\n');
    /** Settings. The shell value wins over the checkout default inside the reference. */
    const project = readProject(dir, { MODULES_DIR: '/from/shell' });
    expect(project.settings.modulesDir).toBe('/from/shell');
    expect(project.settings.localnetDir).toBe('/from/shell/localnet');
  });

  test('expands a reference through another file value', async () => {
    const dir = await tempProject(
      cleaner.dirs,
      [
        'BASE=/opt',
        `MODULES_DIR=${braced('BASE')}/modules`,
        `LOCALNET_DIR=${braced('MODULES_DIR')}/localnet`,
        `QS_EXTRA_COMPOSE_FILES=${braced('MODULES_DIR')}/mine.yaml`,
        '',
      ].join('\n'),
    );
    /** Settings. Each reference is expanded before the path is resolved. */
    const project = readProject(dir, {});
    expect(project.settings.modulesDir).toBe('/opt/modules');
    expect(project.settings.localnetDir).toBe('/opt/modules/localnet');
    expect(project.settings.extraComposeFiles).toEqual(['/opt/modules/mine.yaml']);
  });

  test('throws when environment references cycle', async () => {
    const dir = await tempProject(
      cleaner.dirs,
      [
        `LOCALNET_DIR=${braced('MODULES_DIR')}/localnet`,
        `MODULES_DIR=${braced('LOCALNET_DIR')}/..`,
        '',
      ].join('\n'),
    );
    expect(() => readProject(dir, {})).toThrow(
      'Cyclic environment reference: MODULES_DIR -> LOCALNET_DIR -> MODULES_DIR',
    );
  });

  test('uses the shell when the files do not mention a key', async () => {
    const dir = await tempProject(cleaner.dirs);
    /** PQS flag from the environment, because neither file sets it. */
    const project = readProject(dir, { PQS_SV_PROFILE: 'on', DEBUG_ENABLED: 'true' });
    expect(project.settings.pqsSv).toBe(true);
    expect(project.settings.debug).toBe(true);
    expect(project.settings.pqsAppUser).toBe(false);
  });

  test('defaults LOCALNET_DIR to the commit-keyed cache directory from links.csv', async () => {
    /** Temporary quickstart checkout with the default `links.csv` and no `.env.local` override. */
    const dir = await tempProject(cleaner.dirs);
    /** Project read without an explicit LOCALNET_DIR override. */
    const project = readProject(dir, {});
    expect(project.settings.localnetDir).toBe(join(dir, '.cache', 'localnet', TEST_LOCALNET_SHA));
    expect(project.settings.localnetDirExplicit).toBe(false);
  });

  test('explicit LOCALNET_DIR overrides the cache default', async () => {
    /** Temporary quickstart checkout tested with an explicit shell `LOCALNET_DIR`. */
    const dir = await tempProject(cleaner.dirs);
    /** Project read with an explicit shell LOCALNET_DIR override. */
    const project = readProject(dir, { LOCALNET_DIR: '/offline/localnet' });
    expect(project.settings.localnetDir).toBe('/offline/localnet');
    expect(project.settings.localnetDirExplicit).toBe(true);
  });

  test('falls back to <modules>/localnet when links.csv is absent', async () => {
    /** Temporary quickstart checkout whose `links.csv` is deleted to test the modules fallback. */
    const dir = await tempProject(cleaner.dirs);
    await rm(join(dir, 'links.csv'));
    /** Project read without links.csv falls back to the modules directory. */
    const project = readProject(dir, {});
    expect(project.settings.localnetDir).toBe(join(dir, 'docker', 'modules', 'localnet'));
    expect(project.settings.localnetDirExplicit).toBe(false);
  });

  test('expands LOCALNET_DIR references using the cache default when unset', async () => {
    /** Temporary quickstart checkout whose `.env.local` references `${LOCALNET_DIR}` without setting it. */
    const dir = await tempProject(
      cleaner.dirs,
      `QS_EXTRA_COMPOSE_FILES=${braced('LOCALNET_DIR')}/extra.yaml\n`,
    );
    /** Project whose extra compose path expands the default cache LOCALNET_DIR. */
    const project = readProject(dir, {});
    expect(project.settings.extraComposeFiles).toEqual([
      join(dir, '.cache', 'localnet', TEST_LOCALNET_SHA, 'extra.yaml'),
    ]);
  });

  test('loadProject throws when SPLICE_VERSION is missing', async () => {
    const dir = await tempProject(cleaner.dirs);
    await writeFile(join(dir, '.env'), 'DOCKER_NETWORK=quickstart\n');
    expect(() => loadProject({ cwd: dir, cliDir: dir, env: {}, project: dir })).toThrow(
      'SPLICE_VERSION is not set',
    );
  });
});

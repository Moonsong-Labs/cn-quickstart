// Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: 0BSD

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSetup } from '../src/commands/setup.ts';
import { EndOfInputError } from '../src/lib/prompts.ts';
import { scriptedIo } from './io.ts';

/** Temp projects created by this file. `afterEach` deletes every entry and clears the list. */
const dirs: string[] = [];

/**
 * Create a throwaway quickstart directory with the two project markers.
 * The `.env` contents are not read by setup; they only satisfy project detection if a test starts using it.
 */
async function project(): Promise<string> {
  const dir = join(tmpdir(), `qs-setup-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  await mkdir(join(dir, 'docker', 'modules'), { recursive: true });
  await writeFile(join(dir, '.env'), 'DAML_RUNTIME_VERSION=3.5.2\n');
  dirs.push(dir);
  return dir;
}

/** Delete every temp project from this file, including ones a failed test left behind. */
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/** Read `.env.local` from a temp project. Rejects when the file was not written. */
async function localFile(dir: string): Promise<string> {
  return readFile(join(dir, '.env.local'), 'utf8');
}

describe('runSetup', () => {
  test('accepts defaults: oauth2, derived party hint, test mode off', async () => {
    const dir = await project();
    const io = scriptedIo(['', '', '']);
    await runSetup({
      projectDir: dir,
      io: io.io,
      env: { USER: 'alice.1' },
      dryRun: false,
      yes: false,
    });
    expect(await localFile(dir)).toBe(
      'AUTH_MODE=oauth2\nPARTY_HINT=quickstart-alice-1\nTEST_MODE=off',
    );
    expect(io.output()).toContain('Enable OAuth2');
    expect(io.output()).toContain('(Y/n)');
    expect(io.output()).toContain('Party hint');
    expect(io.output()).toContain('[quickstart-alice-1]');
    expect(io.output()).toContain('Enable test mode');
    expect(io.output()).toContain('(y/N)');
    expect(io.output()).toContain('Wrote .env.local');
    expect(io.output()).not.toContain('Test mode is not for production');
  });

  test('writes shared-secret, a typed party hint and test mode on', async () => {
    const dir = await project();
    const io = scriptedIo(['n', 'Org-Func-2', 'yes']);
    await runSetup({
      projectDir: dir,
      io: io.io,
      env: { USERNAME: 'bob' },
      dryRun: false,
      yes: false,
    });
    expect(await localFile(dir)).toBe(
      'AUTH_MODE=shared-secret\nPARTY_HINT=Org-Func-2\nTEST_MODE=on',
    );
    expect(io.output()).toContain('Test mode is not for production.');
  });

  test('re-asks after an invalid answer, then keeps unrelated lines', async () => {
    const dir = await project();
    await writeFile(join(dir, '.env.local'), '# comment\nOTHER=1\nAUTH_MODE=shared-secret\n');
    const io = scriptedIo(['maybe', 'y', 'bad', 'App-User-3', '0']);
    await runSetup({
      projectDir: dir,
      io: io.io,
      env: {},
      dryRun: false,
      yes: false,
    });
    expect(io.output()).toContain('Enter yes or no.');
    expect(io.output()).toContain('organisation-function-number');
    expect(await localFile(dir)).toBe(
      '# comment\nOTHER=1\nAUTH_MODE=oauth2\nPARTY_HINT=App-User-3\nTEST_MODE=off',
    );
  });

  test('refuses to invent a party hint when no username is available', async () => {
    const dir = await project();
    const io = scriptedIo(['', '', 'n', '']);
    await expect(
      runSetup({
        projectDir: dir,
        io: io.io,
        env: { USER: '123' },
        dryRun: false,
        yes: false,
      }),
    ).rejects.toBeInstanceOf(EndOfInputError);
    expect(io.output()).toContain('No default is available. You must enter a valid party hint.');
  });

  test('--yes uses defaults and does not read answers', async () => {
    const dir = await project();
    const io = scriptedIo([]);
    await runSetup({
      projectDir: dir,
      io: io.io,
      env: { USER: 'carol' },
      dryRun: false,
      yes: true,
    });
    expect(await localFile(dir)).toBe(
      'AUTH_MODE=oauth2\nPARTY_HINT=quickstart-carol-1\nTEST_MODE=off',
    );
  });

  test('--yes fails when there is no party-hint default', async () => {
    const dir = await project();
    const io = scriptedIo([]);
    await expect(
      runSetup({
        projectDir: dir,
        io: io.io,
        env: {},
        dryRun: false,
        yes: true,
      }),
    ).rejects.toThrow('No default is available');
    await expect(localFile(dir)).rejects.toThrow();
  });

  test('flags skip prompts and --dry-run writes nothing', async () => {
    const dir = await project();
    const io = scriptedIo([]);
    await runSetup({
      projectDir: dir,
      io: io.io,
      env: {},
      dryRun: true,
      yes: false,
      authMode: 'shared-secret',
      partyHint: 'App-Provider-9',
      testMode: 'on',
    });
    expect(io.output()).toContain(
      'AUTH_MODE=shared-secret\nPARTY_HINT=App-Provider-9\nTEST_MODE=on\n',
    );
    expect(io.output()).toContain('Dry run. .env.local was not written.');
    expect(io.output()).toContain('Test mode is not for production.');
    await expect(localFile(dir)).rejects.toThrow();
  });

  test('rejects an invalid flag before asking anything', async () => {
    const dir = await project();
    const io = scriptedIo([]);
    await expect(
      runSetup({
        projectDir: dir,
        io: io.io,
        env: { USER: 'alice' },
        dryRun: false,
        yes: false,
        authMode: 'basic',
      }),
    ).rejects.toThrow('--auth-mode must be oauth2 or shared-secret.');
    expect(io.output()).toBe('');
  });
});

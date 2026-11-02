// Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: 0BSD

import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { runCli } from '../src/main.ts';
import { scriptedIo } from './io.ts';
import { projectCleaner, tempProject } from './project-fixture.ts';
import { fakeRunner } from './runner.ts';

/** Temp checkouts for this file. */
const cleaner = projectCleaner();

afterEach(() => cleaner.cleanup());

/**
 * Argument lists from recipe lines that invoke qs.
 * `$(QS)` is the invocation and `$(SETUP_COMMAND)` expands to `setup`.
 * A Make variable such as `$(SERVICE)` is dropped, because the recipe fills it in when Make runs.
 */
function qsRecipes(makefile: string): string[][] {
  /** One argv per recipe line that launches the CLI. */
  const recipes: string[][] = [];
  for (const raw of makefile.split('\n')) {
    /** Recipe lines are tab-indented. Assignments such as `SETUP_COMMAND :=` are not. */
    if (!raw.startsWith('\t')) continue;
    /** Trimmed recipe. Targets and comments do not contain the qs variable. */
    const line = raw.trim();
    if (!line.includes('$(QS)') && !line.includes('$(SETUP_COMMAND)')) continue;
    /** Arguments after the qs invocation. Make variables are not qs arguments. */
    const args = line
      .replaceAll('$(SETUP_COMMAND)', 'setup')
      .replaceAll('$(QS)', '')
      .trim()
      .split(/\s+/)
      .filter((arg) => arg.length > 0 && !arg.startsWith('$('));
    recipes.push(args);
  }
  return recipes;
}

describe('Makefile qs recipes', () => {
  test('every delegated command is one qs accepts', async () => {
    /** Makefile next to this package. Recipes are read as text, including the CI block. */
    const makefile = readFileSync(new URL('../../Makefile', import.meta.url), 'utf8');
    /** Commands the Makefile asks qs to run. */
    const recipes = qsRecipes(makefile);
    expect(recipes.length).toBeGreaterThan(20);
    /** Checkout the commands can resolve. `--dry-run` and the fake runner keep tools from starting. */
    const dir = await tempProject(cleaner.dirs, 'PARTY_HINT=App-User-1\n');
    for (const args of recipes) {
      /**
       * Leading `--dry-run` is a qs flag, including for `compose`, whose later arguments are passed through.
       * An unknown command or choice still exits 2 before the action.
       */
      const io = scriptedIo([]);
      const code = await runCli(['--dry-run', '--project', dir, ...args], io.io, {
        cwd: dir,
        env: { USER: 'tester' },
        runner: fakeRunner().runner,
      });
      expect(code, args.join(' ')).not.toBe(2);
    }
  });
});

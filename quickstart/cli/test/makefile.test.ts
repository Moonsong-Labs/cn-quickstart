// Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: 0BSD

import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { vendorGitSteps, vendorPatchCmd } from '../src/lib/localnet.ts';
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

/**
 * Tab-indented recipe of one target, in file order, without the leading tabs.
 * The header is an unindented `name:` line. The next unindented line ends the recipe.
 */
function targetRecipe(makefile: string, target: string): string[] {
  /** Lines of the Makefile, so the recipe can be sliced out of the header. */
  const lines = makefile.split('\n');
  /** Index of the target header. A missing target is a broken Makefile, not an empty recipe. */
  const header = lines.findIndex((line) => line.startsWith(`${target}:`));
  if (header < 0) throw new Error(`missing target ${target}`);
  /** Recipe lines collected until the next unindented line. */
  const recipe: string[] = [];
  for (const line of lines.slice(header + 1)) {
    /** An unindented line belongs to the next target, so the recipe stops. */
    if (!line.startsWith('\t')) break;
    recipe.push(line.trim());
  }
  return recipe;
}

describe('Makefile workspace install', () => {
  test('setup and build install the root workspace before qs', () => {
    /** Makefile next to this package. The install is a Make recipe, not a qs command. */
    const makefile = readFileSync(new URL('../../Makefile', import.meta.url), 'utf8');
    /** Assignment of the workspace root. It is derived from this Makefile, not from the shell cwd. */
    const root = /^REPO_ROOT := (.+)$/m.exec(makefile)?.[1];
    expect(root).toBe('$(abspath $(dir $(abspath $(lastword $(MAKEFILE_LIST))))/..)');
    /** Assignment of the install command. It uses the frozen lockfile at that root. */
    const install = /^INSTALL_WORKSPACE := (.+)$/m.exec(makefile)?.[1];
    expect(install).toBe('cd "$(REPO_ROOT)" && bun install --frozen-lockfile');
    /** Targets that start qs, and therefore need the packages on disk first. */
    for (const target of ['setup', 'build'] as const) {
      /** Recipe for this target. The install is the first line, and qs follows it. */
      const recipe = targetRecipe(makefile, target);
      expect(recipe[0], target).toBe('$(INSTALL_WORKSPACE)');
      expect(
        recipe.slice(1).some((line) => line.includes('$(QS)') || line.includes('$(SETUP_COMMAND)')),
        target,
      ).toBe(true);
    }
    /** Setup command source. The install stays in the Makefile, so qs setup only writes .env.local. */
    const setupSource = readFileSync(new URL('../src/commands/setup.ts', import.meta.url), 'utf8');
    expect(setupSource.includes('bun install')).toBe(false);
  });
});

/**
 * Parse the `git ...;` lines from `ensure-localnet` and normalize shell/Make placeholders
 * to tokens so they can be compared directly against `vendorGitSteps` and `vendorPatchCmd`.
 */
function makefileGitSteps(makefile: string): string[][] {
  /** Tab-indented recipe lines of the `ensure-localnet` target. */
  const recipe = targetRecipe(makefile, 'ensure-localnet');
  /** Normalized git invocations in recipe order. */
  const commands: string[][] = [];
  for (const raw of recipe) {
    /** Line stripped of trailing Make line continuation and statement terminator. */
    const cleaned = raw
      .replace(/\s*\\$/, '')
      .replace(/;$/, '')
      .trim();
    if (!cleaned.startsWith('git ')) continue;
    /** Normalized token list matching the argv layout used by `localnet.ts`. */
    const tokens = cleaned
      .split(/\s+/)
      .map((token) =>
        token
          .replaceAll('"$$tmp"', '<tmp>')
          .replaceAll('"$(LOCALNET_REPO)"', '<repo>')
          .replaceAll('"$(LOCALNET_SOURCE)"', '<source>')
          .replaceAll('"$(LOCALNET_SHA)"', '<sha>')
          .replaceAll('"$$patch"', '<patch>'),
      );
    commands.push(tokens);
  }
  return commands;
}

describe('Makefile localnet targets', () => {
  test('localnet targets fetch into the cache, layer overrides, and do not invoke qs', () => {
    /** Makefile next to this package. LocalNet-only targets must run without Bun. */
    const makefile = readFileSync(new URL('../../Makefile', import.meta.url), 'utf8');
    /** Assignment of the cache directory derived from `links.csv`. */
    const cacheDir = /^LOCALNET_CACHE_DIR := (.+)$/m.exec(makefile)?.[1];
    expect(cacheDir).toBe('$(QUICKSTART_DIR)/$(LOCALNET_DEST)/localnet/$(LOCALNET_SHA)');
    /** Explicit-override guard so an explicit `LOCALNET_DIR` skips automatic fetching even at the cache path. */
    expect(makefile).toContain('LOCALNET_DIR_EXPLICIT := false');
    expect(makefile).toContain('LOCALNET_DIR_EXPLICIT := true');
    expect(makefile).toContain('override LOCALNET_DIR := $(LOCALNET_CACHE_DIR)');
    expect(makefile).toContain('@if [ "$(LOCALNET_DIR_EXPLICIT)" = "false" ]; then');
    /** Assignment of the overrides directory. */
    const overrides = /^LOCALNET_OVERRIDES_DIR := (.+)$/m.exec(makefile)?.[1];
    expect(overrides).toBe('$(QUICKSTART_DIR)/docker/modules/localnet-overrides');
    /** LocalNet-only Compose invocation. Must layer the override env and compose files after LocalNet's. */
    expect(makefile).toContain('--env-file $(LOCALNET_DIR)/env/common.env');
    expect(makefile).toContain('--env-file $(LOCALNET_OVERRIDES_DIR)/localnet.env');
    expect(makefile.indexOf('--env-file $(LOCALNET_OVERRIDES_DIR)/localnet.env')).toBeGreaterThan(
      makefile.indexOf('--env-file $(LOCALNET_DIR)/env/common.env'),
    );
    expect(makefile).toContain('-f $(LOCALNET_DIR)/compose.yaml');
    expect(makefile).toContain('-f $(LOCALNET_OVERRIDES_DIR)/compose.yaml');
    expect(makefile.indexOf('-f $(LOCALNET_OVERRIDES_DIR)/compose.yaml')).toBeGreaterThan(
      makefile.indexOf('-f $(LOCALNET_DIR)/compose.yaml'),
    );
    /** Image tag. It comes from the committed Splice pin, not from `make setup`. */
    expect(makefile).toContain("SPLICE_VERSION := $(shell sed -n 's/^SPLICE_VERSION=//p' .env)");
    expect(makefile).toContain('IMAGE_TAG ?= $(SPLICE_VERSION)');
    for (const target of [
      'start-localnet',
      'stop-localnet',
      'clean-localnet',
      'status-localnet',
    ] as const) {
      /** Target header line. Every LocalNet-only target must depend on `ensure-localnet`. */
      const header = makefile.split('\n').find((line) => line.startsWith(`${target}:`));
      expect(header, target).toContain('ensure-localnet');
      /** Recipe for this target. It checks Docker, then runs Compose. */
      const recipe = targetRecipe(makefile, target);
      expect(recipe[0], target).toBe('@docker info >/dev/null');
      expect(
        recipe.some((line) => line.includes('$(QS)') || line.includes('$(SETUP_COMMAND)')),
        target,
      ).toBe(false);
      expect(
        recipe.some((line) => line.includes('$(LOCALNET_ONLY_COMPOSE)')),
        target,
      ).toBe(true);
    }
  });

  test('ensure-localnet runs the exact same git commands and arguments as qs vendor', () => {
    /** Makefile next to this package. Its sparse fetch must stay aligned with `localnet.ts`. */
    const makefile = readFileSync(new URL('../../Makefile', import.meta.url), 'utf8');
    expect(makefileGitSteps(makefile)).toEqual([
      ...vendorGitSteps('<tmp>', '<repo>', '<source>', '<sha>'),
      vendorPatchCmd('<tmp>', '<source>', '<patch>'),
    ]);
  });
});

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

// Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: 0BSD

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runBuild } from '../src/commands/build.ts';
import { runClean, runRestart, runStart } from '../src/commands/stack.ts';
import type { CommandContext } from '../src/lib/context.ts';
import type { Runner } from '../src/lib/exec.ts';
import { scriptedIo } from './io.ts';
import { projectCleaner, tempProject } from './project-fixture.ts';
import { fakeRunner } from './runner.ts';

/** Temp checkouts for this file. */
const cleaner = projectCleaner();

afterEach(() => cleaner.cleanup());

/**
 * Context for a checkout that already has a party hint.
 * `runner` records commands and, for `capture`, returns `script`.
 */
async function ctx(
  runner: Runner,
  scripted = scriptedIo([]),
): Promise<{ context: CommandContext; dir: string; noted(): string }> {
  const dir = await tempProject(cleaner.dirs, 'AUTH_MODE=shared-secret\nPARTY_HINT=App-User-1\n');
  return {
    dir,
    noted: scripted.noted,
    context: {
      io: scripted.io,
      env: {},
      cwd: dir,
      cliDir: dir,
      dryRun: false,
      project: dir,
      runner,
    },
  };
}

/** Executable names of recorded `run` calls. Captures are included too, so filter on the first word. */
function commands(calls: { cmd: string[] }[]): string[][] {
  return calls.map((call) => call.cmd);
}

describe('runBuild', () => {
  test('dry-run does not prompt or write when the party hint is missing', async () => {
    const dir = await tempProject(cleaner.dirs);
    const fake = fakeRunner();
    const io = scriptedIo([]);
    /** Dry-run context with no `.env.local`, so setup would otherwise write one. */
    const context: CommandContext = {
      io: io.io,
      env: {},
      cwd: dir,
      cliDir: dir,
      dryRun: true,
      project: dir,
      runner: fake.runner,
    };
    expect(await runBuild(context)).toBe(0);
    expect(io.output()).toBe('');
    expect(io.noted()).toContain('No party hint yet');
    expect(fake.calls.map((call) => call.cmd[0])).toEqual([
      'bun',
      'bun',
      'dpm',
      './gradlew',
      'docker',
    ]);
  });

  test('builds frontend, Daml, the backend without a second Daml compile, then images', async () => {
    const fake = fakeRunner([{ code: 0 }]);
    const { context } = await ctx(fake.runner);
    expect(await runBuild(context)).toBe(0);
    expect(commands(fake.calls).map((cmd) => cmd[0])).toEqual([
      'bun',
      'bun',
      'dpm',
      './gradlew',
      'docker',
      'docker',
    ]);
    expect(fake.calls[2]?.cmd).toEqual(['dpm', 'build', '--all']);
    expect(fake.calls[2]?.cwd.endsWith('/daml')).toBe(true);
    expect(fake.calls[3]?.cmd).toEqual(['./gradlew', ':backend:build', '-x', ':daml:compileDaml']);
    expect(fake.calls.at(-1)?.cmd.at(-1)).toBe('build');
  });

  test('stops after the first failing step', async () => {
    /** Runner whose first command fails. Later commands must not be recorded. */
    const calls: string[][] = [];
    const runner: Runner = {
      run(cmd) {
        calls.push(cmd);
        return Promise.resolve(calls.length === 1 ? 1 : 0);
      },
      capture(cmd) {
        calls.push(cmd);
        return Promise.resolve({ code: 0, stdout: '', stderr: '' });
      },
    };
    const { context } = await ctx(runner);
    expect(await runBuild(context, 'frontend')).toBe(1);
    expect(calls).toHaveLength(1);
  });

  test('a backend-only build lets Gradle compile Daml', async () => {
    const fake = fakeRunner();
    const { context } = await ctx(fake.runner);
    expect(await runBuild(context, 'backend')).toBe(0);
    expect(fake.calls[0]?.cmd).toEqual(['./gradlew', ':backend:build']);
  });
});

describe('runStart', () => {
  test('--no-build only starts the containers', async () => {
    const fake = fakeRunner([{ code: 0 }]);
    const { context, noted } = await ctx(fake.runner);
    expect(await runStart(context, true)).toBe(0);
    expect(fake.calls.map((call) => call.cmd[0])).toEqual(['docker', 'docker']);
    expect(fake.calls[1]?.cmd.slice(-3)).toEqual(['up', '-d', '--no-recreate']);
    expect(noted()).toContain('http://app-provider.localhost:3000');
  });
});

describe('runRestart', () => {
  test('recreates the tenant container after a backend build', async () => {
    const fake = fakeRunner([{ code: 0 }, { code: 0 }, { code: 0 }]);
    const { context } = await ctx(fake.runner);
    expect(await runRestart(context, 'backend')).toBe(0);
    /** Compose subcommands, ignoring the docker info probes. */
    const subcommands = fake.calls
      .filter((call) => call.cmd[0] === 'docker')
      .map((call) => call.cmd.at(-1));
    expect(subcommands).toContain('backend-service');
    expect(subcommands).toContain('register-app-user-tenant');
  });

  test('rejects an unknown service and lists the known ones', async () => {
    const fake = fakeRunner([{ code: 0 }, { stdout: 'nginx\nbackend-service\n' }]);
    const { context, noted } = await ctx(fake.runner);
    expect(await runRestart(context, 'nope')).toBe(1);
    expect(noted()).toContain('Unknown service: nope');
    expect(noted()).toContain('nginx');
  });
});

/**
 * Write the build outputs `clean build` removes outside Gradle.
 * Returns the files a dry run must leave in place.
 */
async function plantBuildOutput(dir: string): Promise<string[]> {
  /** Frontend bundle and two Daml package outputs, including a nested external package. */
  const files = [
    join(dir, 'frontend', 'dist', 'index.html'),
    join(dir, 'daml', 'licensing', '.daml', 'dist', 'x.dar'),
    join(dir, 'daml', 'external-test-sources', 'pkg', '.daml', 'dist', 'y.dar'),
  ];
  for (const file of files) {
    await mkdir(join(file, '..'), { recursive: true });
    await writeFile(file, 'keep');
  }
  return files;
}

describe('runClean', () => {
  test('clean build removes frontend and Daml output', async () => {
    const fake = fakeRunner();
    const { context, dir } = await ctx(fake.runner);
    /** Files Gradle does not remove. A successful clean must delete each one. */
    const files = await plantBuildOutput(dir);
    expect(await runClean(context, 'build', false)).toBe(0);
    for (const file of files) await expect(readFile(file, 'utf8')).rejects.toThrow();
  });

  test('clean build --dry-run prints the paths and deletes nothing', async () => {
    const fake = fakeRunner();
    const { context, dir, noted } = await ctx(fake.runner);
    context.dryRun = true;
    /** Files that a dry run must not remove. */
    const files = await plantBuildOutput(dir);
    expect(await runClean(context, 'build', false)).toBe(0);
    for (const file of files) await expect(readFile(file, 'utf8')).resolves.toBe('keep');
    expect(noted()).toContain('rm -rf frontend/dist');
    expect(noted()).toContain('rm -rf daml/licensing/.daml/dist');
    expect(noted()).toContain('rm -rf daml/external-test-sources/pkg/.daml/dist');
  });

  test('clean all --yes --dry-run leaves build output in place', async () => {
    const fake = fakeRunner();
    const { context, dir } = await ctx(fake.runner);
    context.dryRun = true;
    /** Files that `clean all` would remove after Gradle. Docker is only printed. */
    const files = await plantBuildOutput(dir);
    expect(await runClean(context, 'all', true)).toBe(0);
    for (const file of files) await expect(readFile(file, 'utf8')).resolves.toBe('keep');
  });

  test('--yes sweeps containers, the network, and volumes', async () => {
    const fake = fakeRunner([
      { code: 0 },
      { code: 0 },
      { stdout: 'abc\n' },
      { stdout: 'net\n' },
      { stdout: 'quickstart_pg\n' },
    ]);
    const { context } = await ctx(fake.runner);
    expect(await runClean(context, 'all', true)).toBe(0);
    /** Flat list of arguments, so the filters are easy to find. */
    const args = fake.calls.flatMap((call) => call.cmd);
    expect(args).toContain('network=quickstart');
    expect(args).toContain('name=quickstart');
    expect(args).toContain('name=^quickstart');
    expect(args).toContain('abc');
  });
});

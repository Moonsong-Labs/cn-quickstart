// Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: 0BSD

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runBuild } from '../src/commands/build.ts';
import { runConsole, runShell } from '../src/commands/console.ts';
import { runInstallRequest } from '../src/commands/demo.ts';
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
      lines() {
        return (async function* empty() {})();
      },
      background() {
        return { stop() {}, exited: Promise.resolve(0) };
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

  test('clean all --dry-run does not prompt and leaves build output in place', async () => {
    const fake = fakeRunner();
    const { context, dir } = await ctx(fake.runner);
    context.dryRun = true;
    /** Files that a dry run must not remove, even without `--yes`. */
    const files = await plantBuildOutput(dir);
    expect(await runClean(context, 'all', false)).toBe(0);
    for (const file of files) await expect(readFile(file, 'utf8')).resolves.toBe('keep');
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
    /**
     * Captures in order: docker info before each `down`, docker info before the sweep,
     * then container, network, and project volume ids. The install-request list is empty.
     */
    const fake = fakeRunner([
      { code: 0 },
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
    expect(args).toContain('name=^quickstart$');
    expect(args).toContain('name=^quickstart');
    expect(args).toContain('name=^create-app-install-request');
    expect(args).toContain('docker/create-app-install-request/compose.yaml');
    expect(args).toContain('abc');
  });

  test('clean docker removes the install-request stack volumes', async () => {
    const fake = fakeRunner([{ code: 0 }]);
    const { context } = await ctx(fake.runner);
    expect(await runClean(context, 'docker', false)).toBe(0);
    /** Both `down -v` commands. `docker rm` and the info probes are the other calls. */
    const downs = fake.calls.filter((call) => call.cmd.includes('down'));
    expect(downs).toHaveLength(2);
    expect(downs[0]?.cmd.slice(-2)).toEqual(['down', '-v']);
    expect(downs[0]?.cmd).not.toContain('docker/create-app-install-request/compose.yaml');
    expect(downs[1]?.cmd).toContain('docker/create-app-install-request/compose.yaml');
    expect(downs[1]?.cmd.slice(-2)).toEqual(['down', '-v']);
  });

  test('clean docker stops when the app stack down fails', async () => {
    /** Commands issued. The install-request `down` must not be among them. */
    const calls: string[][] = [];
    const runner: Runner = {
      run(cmd) {
        calls.push(cmd);
        return Promise.resolve(cmd.includes('down') ? 1 : 0);
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
    const { context } = await ctx(runner);
    expect(await runClean(context, 'docker', false)).toBe(1);
    expect(calls.filter((cmd) => cmd.includes('down'))).toHaveLength(1);
    expect(
      calls.some((cmd) => cmd.includes('docker/create-app-install-request/compose.yaml')),
    ).toBe(false);
  });

  test('sweep removes install-request volumes when the project volumes are absent', async () => {
    /**
     * Captures: docker info, no containers, no network, no project volumes,
     * then the leftover install-request volume.
     */
    const fake = fakeRunner([
      { code: 0 },
      { stdout: '' },
      { stdout: '' },
      { stdout: '' },
      { stdout: 'create-app-install-request_onboarding\n' },
    ]);
    const { context, noted } = await ctx(fake.runner);
    expect(await runClean(context, 'sweep', false)).toBe(0);
    /** Anchored name filters, in the order the sweep prints them. */
    const filters = fake.calls.flatMap((call) =>
      call.cmd.filter((arg) => arg.startsWith('name=^')),
    );
    expect(filters).toEqual([
      'name=^quickstart$',
      'name=^quickstart',
      'name=^create-app-install-request',
    ]);
    expect(
      fake.calls.some((call) => call.cmd.includes('create-app-install-request_onboarding')),
    ).toBe(true);
    expect(noted()).toContain('Removing volumes named create-app-install-request');
    expect(noted()).toContain('(none)');
  });

  test('sweep --dry-run lists install-request volumes and deletes nothing', async () => {
    const fake = fakeRunner();
    const { context } = await ctx(fake.runner);
    context.dryRun = true;
    expect(await runClean(context, 'sweep', false)).toBe(0);
    /** Every argument of the printed commands. A dry run must not remove anything. */
    const args = fake.calls.flatMap((call) => call.cmd);
    expect(args).toContain('name=^create-app-install-request');
    expect(args).not.toContain('rm');
  });

  test('clean console does not need .env.local', async () => {
    const dir = await tempProject(cleaner.dirs);
    const fake = fakeRunner([{ code: 0 }]);
    /** Checkout with no `.env.local`. Removing the container must still run. */
    const context: CommandContext = {
      io: scriptedIo([]).io,
      env: {},
      cwd: dir,
      cliDir: dir,
      dryRun: false,
      project: dir,
      runner: fake.runner,
    };
    expect(await runClean(context, 'console', false)).toBe(0);
    expect(fake.calls.map((call) => call.cmd)).toEqual([
      ['docker', 'info'],
      ['docker', 'rm', '-f', 'canton-console'],
    ]);
  });

  test('console removes only the named container and ignores docker rm', async () => {
    /** Runner whose `docker rm` fails. The command still succeeds. */
    const calls: string[][] = [];
    const runner: Runner = {
      run(cmd) {
        calls.push(cmd);
        return Promise.resolve(1);
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
    const { context } = await ctx(runner);
    expect(await runClean(context, 'console', false)).toBe(0);
    expect(calls).toEqual([['docker', 'rm', '-f', 'canton-console']]);
  });

  test('shell removes only the named container', async () => {
    const fake = fakeRunner([{ code: 0 }]);
    const { context } = await ctx(fake.runner);
    expect(await runClean(context, 'shell', false)).toBe(0);
    expect(fake.calls.map((call) => call.cmd)).toEqual([
      ['docker', 'info'],
      ['docker', 'rm', '-f', 'quickstart-daml-shell'],
    ]);
  });
});

describe('console and shell', () => {
  test('console runs the named container on the app stack', async () => {
    const fake = fakeRunner([{ code: 0 }]);
    const { context, dir } = await ctx(fake.runner);
    expect(await runConsole(context)).toBe(0);
    /** Compose invocation. The info probe is the other call. */
    const cmd = fake.calls[1]?.cmd ?? [];
    expect(cmd.slice(0, 2)).toEqual(['docker', 'compose']);
    expect(cmd).toContain('compose.yaml');
    expect(cmd.slice(-5)).toEqual(['run', '--rm', '--name', 'canton-console', 'console']);
    expect(cmd).toContain(`${dir}/docker/modules/localnet/resource-constraints.yaml`);
  });

  test('shell names the container and uses the daml-shell files', async () => {
    const fake = fakeRunner([{ code: 0 }]);
    const { context, dir } = await ctx(fake.runner);
    expect(await runShell(context)).toBe(0);
    /** Compose invocation. */
    const cmd = fake.calls[1]?.cmd ?? [];
    expect(cmd).toContain(`${dir}/docker/modules/daml-shell/compose.yaml`);
    expect(cmd).toContain(`${dir}/docker/modules/daml-shell/compose.env`);
    expect(cmd.slice(-5)).toEqual(['run', '--rm', '--name', 'quickstart-daml-shell', 'daml-shell']);
    expect(cmd).not.toContain('--profile');
  });
});

describe('runInstallRequest', () => {
  test('keeps the Playwright identity variables and hints when the network is missing', async () => {
    const fake = fakeRunner([
      { code: 0 },
      {
        code: 1,
        stdout: 'submitting\n',
        stderr: 'network quickstart declared as external, but could not be found\n',
      },
    ]);
    const { context, noted } = await ctx(fake.runner);
    context.env = {
      TEST_UNIQUE_REQUEST_TAG: 'tag-1',
      TEST_AUTH_APP_USER_WALLET_ADMIN_USER_NAME: 'alice',
      TEST_AUTH_APP_USER_WALLET_ADMIN_USER_ID: 'id-1',
      TEST_APP_USER_PARTY: 'party-1',
    };
    const io = scriptedIo([]);
    context.io = io.io;
    expect(await runInstallRequest(context)).toBe(1);
    /** Compose capture. The first call is `docker info`. */
    const compose = fake.calls[1];
    expect(compose?.cmd).toContain('docker/create-app-install-request/compose.yaml');
    expect(compose?.cmd.slice(-2)).toEqual(['--rm', 'container']);
    expect(compose?.env?.TEST_UNIQUE_REQUEST_TAG).toBe('tag-1');
    expect(compose?.env?.TEST_AUTH_APP_USER_WALLET_ADMIN_USER_NAME).toBe('alice');
    expect(compose?.env?.TEST_APP_USER_PARTY).toBe('party-1');
    expect(io.output()).toBe('submitting\n');
    expect(io.noted()).toContain('Start Quickstart first: qs start.');
    expect(noted()).toBe('');
  });
});

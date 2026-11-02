// Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: 0BSD

import { afterEach, describe, expect, test } from 'bun:test';
import { runDevFrontend } from '../src/commands/dev.ts';
import { runBrowsers, runDamlTest, runIntegration, runReport } from '../src/commands/testing.ts';
import type { CommandContext } from '../src/lib/context.ts';
import { scriptedIo } from './io.ts';
import { projectCleaner, tempProject } from './project-fixture.ts';
import { fakeRunner } from './runner.ts';

/** Temp checkouts for this file. */
const cleaner = projectCleaner();

afterEach(() => cleaner.cleanup());

/**
 * Context for a checkout. `envLocal` is written when the test needs auth or test mode.
 */
async function ctx(
  envLocal?: string,
): Promise<{ context: CommandContext; dir: string; calls: { cmd: string[]; cwd: string }[] }> {
  const dir = await tempProject(cleaner.dirs, envLocal);
  const fake = fakeRunner([{ code: 0 }]);
  return {
    dir,
    calls: fake.calls,
    context: {
      io: scriptedIo([]).io,
      env: {},
      cwd: dir,
      cliDir: dir,
      dryRun: false,
      project: dir,
      runner: fake.runner,
    },
  };
}

describe('runDamlTest', () => {
  test('builds, then tests licensing-tests', async () => {
    const { context, dir, calls } = await ctx();
    expect(await runDamlTest(context)).toBe(0);
    expect(calls.map((call) => call.cmd)).toEqual([
      ['dpm', 'build', '--all'],
      ['dpm', 'test', '--package-root', 'licensing-tests'],
    ]);
    expect(calls[0]?.cwd).toBe(`${dir}/daml`);
    expect(calls[1]?.cwd).toBe(`${dir}/daml`);
  });
});

describe('runIntegration', () => {
  test('refuses test mode off and shared-secret auth', async () => {
    const off = await ctx('TEST_MODE=off\nAUTH_MODE=oauth2\n');
    await expect(runIntegration(off.context, [], false)).rejects.toThrow('qs setup');
    const secret = await ctx('AUTH_MODE=shared-secret\n');
    await expect(runIntegration(secret.context, [], false)).rejects.toThrow('AUTH_MODE=oauth2');
  });

  test('an unset test mode still runs the suite', async () => {
    const { context, dir, calls } = await ctx('AUTH_MODE=oauth2\n');
    expect(await runIntegration(context, ['--grep', 'wallet'], false)).toBe(0);
    expect(calls.map((call) => call.cmd[0])).toEqual(['docker', 'docker', 'bun', 'bunx']);
    expect(calls.at(-1)?.cmd).toEqual(['bunx', 'playwright', 'test', '--grep', 'wallet']);
    expect(calls.at(-1)?.cwd).toBe(`${dir}/integration-test`);
    expect(calls[1]?.cmd).toEqual(['docker', 'rm', '-f', 'environment-init']);
  });

  test('--install downloads Chromium after the frozen workspace install', async () => {
    const { context, dir, calls } = await ctx('AUTH_MODE=oauth2\n');
    expect(await runIntegration(context, [], true)).toBe(0);
    /** Commands after the Docker probe, in the order they run. */
    const commands = calls.slice(1).map((call) => call.cmd);
    expect(commands).toEqual([
      ['docker', 'rm', '-f', 'environment-init'],
      ['bun', 'install', '--frozen-lockfile'],
      ['bunx', 'playwright', 'install', 'chromium'],
      ['bunx', 'playwright', 'test'],
    ]);
    expect(calls[3]?.cwd).toBe(`${dir}/integration-test`);
    expect(calls[4]?.cwd).toBe(`${dir}/integration-test`);
  });
});

describe('runBrowsers', () => {
  test('installs chromium from integration-test', async () => {
    const { context, dir, calls } = await ctx();
    expect(await runBrowsers(context, false)).toBe(0);
    expect(calls[0]?.cmd).toEqual(['bunx', 'playwright', 'install', 'chromium']);
    expect(calls[0]?.cwd).toBe(`${dir}/integration-test`);
  });
});

describe('runReport', () => {
  test('serves the report from integration-test', async () => {
    const { context, dir, calls } = await ctx();
    expect(await runReport(context)).toBe(0);
    expect(calls[0]?.cmd).toEqual([
      'bunx',
      'playwright',
      'show-report',
      '--port=9323',
      '--host=0.0.0.0',
    ]);
    expect(calls[0]?.cwd).toBe(`${dir}/integration-test`);
  });
});

describe('runDevFrontend', () => {
  test('starts the stack first when asked', async () => {
    const { context, calls } = await ctx('AUTH_MODE=oauth2\nPARTY_HINT=App-User-1\n');
    expect(await runDevFrontend(context, true)).toBe(0);
    expect(calls.at(-1)?.cmd).toEqual(['bun', 'run', '--filter', 'frontend', 'dev']);
    expect(calls.some((call) => call.cmd.includes('up'))).toBe(true);
  });
});

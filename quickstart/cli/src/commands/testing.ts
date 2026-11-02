// Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: 0BSD

import { join } from 'node:path';
import type { Command } from 'commander';
import type { CommandContext } from '../lib/context.ts';
import { ensureDocker } from '../lib/docker.ts';
import { dpmBuild, dpmTest } from '../lib/dpm.ts';
import { definedEnv, loggedRun } from '../lib/exec.ts';
import { projectFromContext } from '../lib/project.ts';
import type { CommandDeps } from '../lib/register.ts';
import { step } from '../lib/step.ts';

/** Message when test mode is explicitly off. An unset value does not trip this check. */
const TEST_MODE_OFF =
  'To run the integration tests Quickstart must be started in test mode. Please run "qs setup" and enable TEST_MODE when prompted';

/** Message when the checkout is using shared-secret auth. Playwright only drives OAuth2. */
const SHARED_SECRET = 'Integration tests supported only for AUTH_MODE=oauth2.';

/**
 * Build the Daml packages, then run `dpm test` for `licensing-tests`.
 * A failed build does not run the tests. Both steps print a heading.
 */
export async function runDamlTest(ctx: CommandContext): Promise<number> {
  /** Checkout whose `daml/` tree is built and tested. `.env.local` is not required. */
  const project = projectFromContext(ctx);
  /** Build status. The tests need the DARs this produces. */
  const built = await step(ctx.io, 'Building Daml', 'Daml built', () => dpmBuild(ctx, project.dir));
  if (built !== 0) return built;
  return step(ctx.io, 'Testing Daml', 'Daml tests passed', () => dpmTest(ctx, project.dir));
}

/**
 * Run the Playwright suite in `integration-test/`.
 * Refuses `TEST_MODE=off` and `AUTH_MODE=shared-secret` with the Makefile's messages.
 * `args` are passed to `playwright test`. `install` downloads Chromium after the frozen
 * workspace install, without system libraries, so `bunx` uses the locked Playwright.
 */
export async function runIntegration(
  ctx: CommandContext,
  args: string[],
  install: boolean,
): Promise<number> {
  /** Checkout whose auth and test mode gate the suite. */
  const project = projectFromContext(ctx);
  if (project.settings.testMode === 'off') throw new Error(TEST_MODE_OFF);
  if (project.settings.authMode === 'shared-secret') throw new Error(SHARED_SECRET);
  /** Daemon check. The suite talks to the running stack. */
  const docker = await ensureDocker(ctx);
  if (docker !== 0) return docker;
  await loggedRun(ctx.io, ctx.runner, ['docker', 'rm', '-f', 'environment-init'], {
    cwd: project.dir,
    env: definedEnv(ctx.env),
  });
  /** Workspace install. Playwright is a dependency of `integration-test`. */
  const installed = await loggedRun(ctx.io, ctx.runner, ['bun', 'install', '--frozen-lockfile'], {
    cwd: project.dir,
    env: definedEnv(ctx.env),
  });
  if (installed !== 0) return installed;
  if (install) {
    /** Browser install. After the lockfile install, so `bunx` does not fetch another Playwright. */
    const browsers = await runBrowsers(ctx, false);
    if (browsers !== 0) return browsers;
  }
  return loggedRun(ctx.io, ctx.runner, ['bunx', 'playwright', 'test', ...args], {
    cwd: join(project.dir, 'integration-test'),
    env: definedEnv(ctx.env),
  });
}

/**
 * Install the Chromium build that `integration-test`'s Playwright version expects.
 * The command runs in that directory, because running it from `quickstart/` installs a different build.
 * `withDeps` adds Playwright's `--with-deps`, which CI uses for the system libraries.
 */
export async function runBrowsers(ctx: CommandContext, withDeps: boolean): Promise<number> {
  /** Checkout that contains `integration-test/`. */
  const project = projectFromContext(ctx);
  /** Install arguments. Chromium only; the suite does not launch the other browsers. */
  const args = ['bunx', 'playwright', 'install', 'chromium', ...(withDeps ? ['--with-deps'] : [])];
  return loggedRun(ctx.io, ctx.runner, args, {
    cwd: join(project.dir, 'integration-test'),
    env: definedEnv(ctx.env),
  });
}

/**
 * Serve the last Playwright HTML report on port 9323.
 * The report is the one `integration-test` wrote. A missing report is Playwright's own error.
 */
export async function runReport(ctx: CommandContext): Promise<number> {
  /** Checkout that contains `integration-test/`. */
  const project = projectFromContext(ctx);
  return loggedRun(
    ctx.io,
    ctx.runner,
    ['bunx', 'playwright', 'show-report', '--port=9323', '--host=0.0.0.0'],
    { cwd: join(project.dir, 'integration-test'), env: definedEnv(ctx.env) },
  );
}

/**
 * Register `qs test` and its subcommands.
 * `qs test` and `qs test daml` both run the licensing tests.
 * Playwright flags go after `--` so they are not read as qs flags.
 */
export function registerTest(program: Command, deps: CommandDeps): void {
  /** Test group. The default action is the Daml suite. */
  const tests = deps
    .addSharedOptions(program.command('test'))
    .description('Run Daml or Playwright tests');
  tests.action(async (_local: unknown, command: Command) => {
    await deps.run(command, runDamlTest);
  });
  deps
    .addSharedOptions(tests.command('daml'))
    .description('Build Daml, then run the licensing tests')
    .action(async (_local: unknown, command: Command) => {
      await deps.run(command, runDamlTest);
    });
  deps
    .addSharedOptions(tests.command('integration'))
    .description('Run the Playwright suite')
    .enablePositionalOptions()
    .passThroughOptions()
    .option('--install', 'Install Chromium before the suite')
    .argument('[args...]', 'Arguments after -- are passed to playwright test')
    .action(async (args: string[], _local: unknown, command: Command) => {
      /** True when Chromium should be installed first. */
      const install = command.opts<{ install?: boolean }>().install === true;
      await deps.run(command, (ctx) => runIntegration(ctx, args, install));
    });
  deps
    .addSharedOptions(tests.command('browsers'))
    .description('Install the Chromium build the integration tests use')
    .option('--with-deps', 'Also install the system libraries Playwright needs')
    .action(async (_local: unknown, command: Command) => {
      /** True when Playwright should install system libraries as well. */
      const withDeps = command.opts<{ withDeps?: boolean }>().withDeps === true;
      await deps.run(command, (ctx) => runBrowsers(ctx, withDeps));
    });
  deps
    .addSharedOptions(tests.command('report'))
    .description('Serve the last Playwright HTML report')
    .action(async (_local: unknown, command: Command) => {
      await deps.run(command, runReport);
    });
}

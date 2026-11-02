// Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: 0BSD

import type { Command } from 'commander';
import { composeArgs, composeEnv } from '../lib/compose.ts';
import type { CommandContext } from '../lib/context.ts';
import { ensureDocker } from '../lib/docker.ts';
import { formatCommand } from '../lib/exec.ts';
import { composeProject } from '../lib/project.ts';
import type { CommandDeps } from '../lib/register.ts';
import { bad, paint } from '../lib/style.ts';

/** Compose's message when the Quickstart network has not been created yet. */
const MISSING_NETWORK = 'declared as external, but could not be found';

/**
 * Submit an App Install Request from the App User participant.
 * `TEST_UNIQUE_REQUEST_TAG` and the other `TEST_*` identity variables are taken from the
 * environment when the env files do not define them. A missing Quickstart network prints
 * `Start Quickstart first: qs start.` after Compose's own error.
 */
export async function runInstallRequest(ctx: CommandContext): Promise<number> {
  /** Checkout whose auth and party settings the container reads. */
  const project = composeProject(ctx);
  /** Daemon check. Skipped for `--dry-run`. */
  const docker = await ensureDocker(ctx);
  if (docker !== 0) return docker;
  /** Full command. Output is collected so a missing network can be recognised. */
  const cmd = [
    'docker',
    'compose',
    ...composeArgs(project.settings, { stack: 'install-request', constraints: false }),
    'run',
    '--rm',
    'container',
  ];
  ctx.io.note(`${paint('dim', `$ ${formatCommand(cmd)}`)}\n`);
  if (ctx.dryRun) return 0;
  /** Container result. Stdout is the script's progress; stderr is Compose. */
  const result = await ctx.runner.capture(cmd, {
    cwd: project.dir,
    env: composeEnv(ctx.env, project),
  });
  if (result.stdout.length > 0) {
    ctx.io.write(result.stdout.endsWith('\n') ? result.stdout : `${result.stdout}\n`);
  }
  if (result.stderr.length > 0) {
    ctx.io.note(result.stderr.endsWith('\n') ? result.stderr : `${result.stderr}\n`);
  }
  if (result.code !== 0 && result.stderr.includes(MISSING_NETWORK)) {
    ctx.io.note(`${bad('Start Quickstart first: qs start.')}\n`);
  }
  return result.code;
}

/**
 * Register `qs demo install-request`.
 * The group exists so later demo steps can sit beside this one.
 */
export function registerDemo(program: Command, deps: CommandDeps): void {
  /** Demo group. The install request is the only demo command. */
  const demo = deps
    .addSharedOptions(program.command('demo'))
    .description('Run a quickstart demo step');
  deps
    .addSharedOptions(demo.command('install-request'))
    .description('Submit an App Install Request from the App User participant')
    .action(async (_local: unknown, command: Command) => {
      await deps.run(command, runInstallRequest);
    });
}

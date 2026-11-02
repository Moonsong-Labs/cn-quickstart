// Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: 0BSD

import type { Command } from 'commander';
import { compose } from '../lib/compose.ts';
import type { CommandContext } from '../lib/context.ts';
import { ensureDocker } from '../lib/docker.ts';
import { composeProject } from '../lib/project.ts';
import type { CommandDeps } from '../lib/register.ts';

/**
 * Open the Canton console in the Quickstart stack.
 * The container is named `canton-console`, so `qs clean console` can remove it.
 * The console's own status is returned. A stopped daemon returns 1 before Compose runs.
 */
export async function runConsole(ctx: CommandContext): Promise<number> {
  /** Checkout whose participants the console connects to. */
  const project = composeProject(ctx);
  /** Daemon check. Skipped for `--dry-run`. */
  const docker = await ensureDocker(ctx);
  if (docker !== 0) return docker;
  return compose(ctx, project, ['run', '--rm', '--name', 'canton-console', 'console']);
}

/**
 * Open the Daml shell against the app-provider PQS database.
 * The container is named `quickstart-daml-shell`, so `qs clean shell` removes that container
 * rather than a Compose-generated name. A second shell cannot start until the first exits.
 */
export async function runShell(ctx: CommandContext): Promise<number> {
  /** Checkout whose PQS settings the shell reads. */
  const project = composeProject(ctx);
  /** Daemon check. Skipped for `--dry-run`. */
  const docker = await ensureDocker(ctx);
  if (docker !== 0) return docker;
  return compose(ctx, project, ['run', '--rm', '--name', 'quickstart-daml-shell', 'daml-shell'], {
    stack: 'daml-shell',
    constraints: false,
  });
}

/**
 * Register `qs console` and `qs shell`.
 * Each container has a fixed name so `qs clean` can remove it.
 */
export function registerConsole(program: Command, deps: CommandDeps): void {
  deps
    .addSharedOptions(program.command('console'))
    .description('Open the Canton console')
    .action(async (_local: unknown, command: Command) => {
      await deps.run(command, runConsole);
    });
  deps
    .addSharedOptions(program.command('shell'))
    .description('Open the Daml shell')
    .action(async (_local: unknown, command: Command) => {
      await deps.run(command, runShell);
    });
}

// Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: 0BSD

import type { Command } from 'commander';
import type { CommandContext } from '../lib/context.ts';
import { definedEnv, loggedRun } from '../lib/exec.ts';
import { projectFromContext } from '../lib/project.ts';
import type { CommandDeps } from '../lib/register.ts';
import { runStart } from './stack.ts';

/**
 * Run the frontend's Vite dev server in the foreground.
 * With `start`, the stack is started first and a failed start does not launch Vite.
 * The child Bun loads `quickstart/.env` itself, which is how `make vite-dev` behaved.
 */
export async function runDevFrontend(ctx: CommandContext, start: boolean): Promise<number> {
  if (start) {
    /** Stack status. Vite is not started when the containers fail to come up. */
    const started = await runStart(ctx, false);
    if (started !== 0) return started;
  }
  /** Checkout whose frontend workspace script is `dev`. */
  const project = projectFromContext(ctx);
  return loggedRun(ctx.io, ctx.runner, ['bun', 'run', '--filter', 'frontend', 'dev'], {
    cwd: project.dir,
    env: definedEnv(ctx.env),
  });
}

/**
 * Register `qs dev frontend`.
 * `--start` brings the stack up before the Vite server.
 */
export function registerDev(program: Command, deps: CommandDeps): void {
  /** Dev group. The frontend is the only dev command. */
  const dev = deps
    .addSharedOptions(program.command('dev'))
    .description('Run a package in development mode');
  deps
    .addSharedOptions(dev.command('frontend'))
    .description('Run the Vite dev server')
    .option('--start', 'Start the stack before Vite')
    .action(async (_local: unknown, command: Command) => {
      /** True when the stack should be started first. */
      const start = command.opts<{ start?: boolean }>().start === true;
      await deps.run(command, (ctx) => runDevFrontend(ctx, start));
    });
}

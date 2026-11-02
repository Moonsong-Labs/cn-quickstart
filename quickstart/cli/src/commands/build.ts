// Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: 0BSD

import type { Command } from 'commander';
import { Argument } from 'commander';
import { compose } from '../lib/compose.ts';
import type { CommandContext } from '../lib/context.ts';
import { ensureDocker } from '../lib/docker.ts';
import { dpmBuild } from '../lib/dpm.ts';
import { definedEnv, loggedRun } from '../lib/exec.ts';
import { type Project, projectFromContext, requireEnvLocal } from '../lib/project.ts';
import type { CommandDeps } from '../lib/register.ts';
import { step } from '../lib/step.ts';
import { aside } from '../lib/style.ts';
import { runSetup } from './setup.ts';

/** Which piece `qs build` should build. Omitted means all of them, in order. */
export type BuildTarget = 'frontend' | 'backend' | 'daml' | 'images';

/**
 * Require a party hint before a full build, matching `make build`.
 * A terminal with no hint runs `setup`. A pipe fails instead of waiting for input.
 * `--dry-run` does not prompt and does not write `.env.local`.
 * After a real setup, a still-empty hint fails with the Makefile's message.
 */
export async function ensurePartyHint(ctx: CommandContext, project: Project): Promise<Project> {
  if (project.hasEnvLocal && project.settings.partyHint) return project;
  if (ctx.dryRun) {
    ctx.io.note(`${aside('No party hint yet. A real build runs qs setup first.')}\n`);
    return project;
  }
  if (process.stdin.isTTY !== true) {
    throw new Error('Run qs setup (or qs setup --yes) first.');
  }
  await runSetup({
    projectDir: project.dir,
    io: ctx.io,
    env: ctx.env,
    dryRun: false,
    yes: false,
  });
  /** Checkout reread so the new party hint is visible. */
  const updated = projectFromContext(ctx);
  requireEnvLocal(updated);
  if (!updated.settings.partyHint) {
    throw new Error('Setup did not produce a valid .env.local. Please try again.');
  }
  return updated;
}

/**
 * Install dependencies and build the frontend from the workspace root Bun walks up to.
 */
async function buildFrontend(ctx: CommandContext, dir: string): Promise<number> {
  /** Shared environment for both Bun invocations. */
  const env = definedEnv(ctx.env);
  /** Frozen install. A failure stops the build before Vite runs. */
  const install = await loggedRun(ctx.io, ctx.runner, ['bun', 'install', '--frozen-lockfile'], {
    cwd: dir,
    env,
  });
  if (install !== 0) return install;
  return loggedRun(ctx.io, ctx.runner, ['bun', 'run', '--filter', 'frontend', 'build'], {
    cwd: dir,
    env,
  });
}

/**
 * Build the backend distribution.
 * `skipDamlCompile` excludes `:daml:compileDaml` so a full build does not run `dpm` twice.
 */
async function buildBackend(
  ctx: CommandContext,
  dir: string,
  skipDamlCompile: boolean,
): Promise<number> {
  /** Gradle command. The exclusion is only used after `dpmBuild` has already produced the DARs. */
  const cmd = ['./gradlew', ':backend:build'];
  if (skipDamlCompile) cmd.push('-x', ':daml:compileDaml');
  return loggedRun(ctx.io, ctx.runner, cmd, { cwd: dir, env: definedEnv(ctx.env) });
}

/**
 * Build one piece, or the whole stack when `target` is omitted.
 * The whole stack is frontend, Daml, backend, then images. A failed step stops the rest.
 * Only the whole stack demands a party hint. Image builds also require `.env.local` and Docker.
 */
export async function runBuild(ctx: CommandContext, target?: BuildTarget): Promise<number> {
  /** Checkout. Throws when the Splice version is missing. */
  let project = projectFromContext(ctx);
  if (target === undefined) project = await ensurePartyHint(ctx, project);

  /** Steps still to run. A single target is a one-element list. */
  const targets: BuildTarget[] =
    target === undefined ? ['frontend', 'daml', 'backend', 'images'] : [target];

  for (const piece of targets) {
    if (piece === 'frontend') {
      /** Frontend status. Non-zero skips the later pieces. */
      const status = await step(ctx.io, 'Building frontend', 'Frontend built', () =>
        buildFrontend(ctx, project.dir),
      );
      if (status !== 0) return status;
    }
    if (piece === 'daml') {
      const status = await step(ctx.io, 'Building Daml', 'Daml built', () =>
        dpmBuild(ctx, project.dir),
      );
      if (status !== 0) return status;
    }
    if (piece === 'backend') {
      const status = await step(ctx.io, 'Building backend', 'Backend built', () =>
        buildBackend(ctx, project.dir, target === undefined),
      );
      if (status !== 0) return status;
    }
    if (piece === 'images') {
      if (!ctx.dryRun) requireEnvLocal(project);
      /** Docker preflight. Skipped for `--dry-run`. */
      const docker = await ensureDocker(ctx);
      if (docker !== 0) return docker;
      const status = await step(ctx.io, 'Building images', 'Images built', () =>
        compose(ctx, project, ['build']),
      );
      if (status !== 0) return status;
    }
  }
  return 0;
}

/**
 * Register `qs build`.
 * With no target, the pieces run in order and a failure stops the rest.
 */
export function registerBuild(program: Command, deps: CommandDeps): void {
  deps
    .addSharedOptions(program.command('build'))
    .description('Build the frontend, Daml, backend, and images')
    .addArgument(
      new Argument('[target]', 'Piece to build').choices(['frontend', 'backend', 'daml', 'images']),
    )
    .action(async (target: BuildTarget | undefined, _local: unknown, command: Command) => {
      await deps.run(command, (ctx) => runBuild(ctx, target));
    });
}

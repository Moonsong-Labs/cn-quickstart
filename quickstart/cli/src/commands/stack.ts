// Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: 0BSD

import type { Dirent } from 'node:fs';
import { readdir, rm } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { compose, composeArgs, composeEnv } from '../lib/compose.ts';
import type { CommandContext } from '../lib/context.ts';
import { ensureDocker } from '../lib/docker.ts';
import type { Captured } from '../lib/exec.ts';
import { definedEnv, formatCommand, loggedRun } from '../lib/exec.ts';
import { composeProject, type Project, projectFromContext } from '../lib/project.ts';
import { askYesNo } from '../lib/prompts.ts';
import { step } from '../lib/step.ts';
import { aside, bad, paint } from '../lib/style.ts';
import { runBuild } from './build.ts';
import { openTargetUrl } from './open.ts';

/**
 * Docker preflight, then `compose`.
 * The preflight is skipped for `--dry-run`. A stopped daemon returns 1 before Compose runs.
 */
async function composeReady(
  ctx: CommandContext,
  project: Project,
  args: string[],
): Promise<number> {
  /** Daemon check. Zero when Docker is ready or this is a dry run. */
  const docker = await ensureDocker(ctx);
  if (docker !== 0) return docker;
  return compose(ctx, project, args);
}

/**
 * `docker compose` with the quickstart files, collecting the output.
 * Used to list service names. Dry-run still runs this, because it only reads config.
 */
function composeCapture(ctx: CommandContext, project: Project, args: string[]): Promise<Captured> {
  return ctx.runner.capture(['docker', 'compose', ...composeArgs(project.settings), ...args], {
    cwd: project.dir,
    env: composeEnv(ctx.env, project),
  });
}

/**
 * Build unless `noBuild`, then start the stack in the background.
 * Prints the two UIs and the logs command when the start succeeds.
 */
export async function runStart(ctx: CommandContext, noBuild: boolean): Promise<number> {
  if (!noBuild) {
    /** Build status. A failed build does not try to start the containers. */
    const built = await runBuild(ctx);
    if (built !== 0) return built;
  }
  /** Checkout reread so a build that ran setup is visible. */
  const project = composeProject(ctx);
  /** `up` status. The heading and duration come from `step`. */
  const status = await step(ctx.io, 'Starting Quickstart', 'Quickstart is starting', () =>
    composeReady(ctx, project, ['up', '-d', '--no-recreate']),
  );
  if (status !== 0) return status;
  ctx.io.note(`${aside(`App UI     ${openTargetUrl('app')}`)}\n`);
  ctx.io.note(`${aside(`App user   ${openTargetUrl('app-user-wallet')}`)}\n`);
  ctx.io.note(`${aside('Logs       qs logs -f')}\n`);
  return 0;
}

/** Stop the stack, including the resource-constraint files. */
export async function runStop(ctx: CommandContext): Promise<number> {
  return composeReady(ctx, composeProject(ctx), ['down']);
}

/** Show `docker compose ps`. */
export async function runStatus(ctx: CommandContext): Promise<number> {
  return composeReady(ctx, composeProject(ctx), ['ps']);
}

/**
 * Show logs. `follow` adds `-f`. `services` limits the output to those names.
 */
export async function runLogs(
  ctx: CommandContext,
  follow: boolean,
  services: string[],
): Promise<number> {
  /** Arguments after the files and profiles. `-f` comes before the service names. */
  const args = ['logs', ...(follow ? ['-f'] : []), ...services];
  return composeReady(ctx, composeProject(ctx), args);
}

/**
 * Pass `args` through to `docker compose` with the quickstart files added.
 * Nothing is written to stdout except what Compose itself prints.
 */
export async function runCompose(ctx: CommandContext, args: string[]): Promise<number> {
  if (args.length === 0) throw new Error('Give a compose command, for example: qs compose config');
  return composeReady(ctx, composeProject(ctx), args);
}

/**
 * Restart the whole stack, the backend, the frontend, or one Compose service.
 * `backend` and `frontend` rebuild first. Any other name is checked against `config --services`.
 */
export async function runRestart(ctx: CommandContext, target?: string): Promise<number> {
  if (target === undefined) {
    /** Stop status. A failed stop does not start the stack again. */
    const stopped = await runStop(ctx);
    if (stopped !== 0) return stopped;
    return runStart(ctx, false);
  }
  if (target === 'backend') return restartBackend(ctx);
  if (target === 'frontend') return restartFrontend(ctx);
  return restartService(ctx, target);
}

/** Rebuild the backend, then recreate the tenant registration container. */
async function restartBackend(ctx: CommandContext): Promise<number> {
  /** Backend build. Includes the Daml compile, because this path did not just run `dpm`. */
  const built = await runBuild(ctx, 'backend');
  if (built !== 0) return built;
  /** Checkout the rebuilt artefacts will run in. */
  const project = composeProject(ctx);
  /** Remove the old backend. `-s` stops it first. */
  const removed = await composeReady(ctx, project, ['rm', '-s', '-f', 'backend-service']);
  if (removed !== 0) return removed;
  /** Remove the tenant container so the next `up` recreates it. */
  const tenant = await composeReady(ctx, project, ['rm', '-s', '-f', 'register-app-user-tenant']);
  if (tenant !== 0) return tenant;
  return composeReady(ctx, project, ['up', '-d', '--no-recreate', 'register-app-user-tenant']);
}

/** Rebuild the frontend and restart nginx, which serves `frontend/dist`. */
async function restartFrontend(ctx: CommandContext): Promise<number> {
  /** Frontend build. */
  const built = await runBuild(ctx, 'frontend');
  if (built !== 0) return built;
  return composeReady(ctx, composeProject(ctx), ['restart', 'nginx']);
}

/**
 * Recreate one service. The name has to appear in `docker compose config --services`.
 * A typo prints that list instead of asking Compose to create an unknown service.
 */
async function restartService(ctx: CommandContext, name: string): Promise<number> {
  /** Checkout whose service list is checked. */
  const project = composeProject(ctx);
  /** Daemon check. A stopped daemon is reported before the service list is read. */
  const docker = await ensureDocker(ctx);
  if (docker !== 0) return docker;
  /** Service names, one per line. */
  const listed = await composeCapture(ctx, project, ['config', '--services']);
  if (listed.code !== 0) {
    ctx.io.note(`${bad('Could not list Compose services.')}\n`);
    return listed.code;
  }
  /** Names Compose knows about for this combination of files and profiles. */
  const names = listed.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (!names.includes(name)) {
    ctx.io.note(`${bad(`Unknown service: ${name}`)}\n`);
    ctx.io.note(`${aside(names.join(', '))}\n`);
    return 1;
  }
  /** Remove the old container, then start a new one without recreating its dependencies. */
  const removed = await composeReady(ctx, project, ['rm', '-s', '-f', name]);
  if (removed !== 0) return removed;
  return composeReady(ctx, project, ['up', '-d', '--no-recreate', name]);
}

/** What `qs clean` deletes. `sweep` is the leftover containers, network, and volumes only. */
export type CleanTarget = 'build' | 'docker' | 'sweep' | 'all';

/**
 * Delete build output, Docker state, leftover Docker objects, or all of them.
 * `all` asks for confirmation unless `yes`. Declining leaves everything in place and returns 0.
 * `sweep` does not ask, matching `make clean-all-docker`.
 */
export async function runClean(
  ctx: CommandContext,
  target: CleanTarget,
  yes: boolean,
): Promise<number> {
  if (target === 'all' && !yes) {
    if (process.stdin.isTTY !== true) {
      throw new Error('Pass --yes to remove containers and volumes without a prompt.');
    }
    /** Answer. Empty input means no. */
    const agreed = await askYesNo(
      ctx.io,
      'Remove all Quickstart containers, the quickstart network and its volumes',
      false,
    );
    if (!agreed) {
      ctx.io.note(`${aside('Left everything in place.')}\n`);
      return 0;
    }
  }
  if (target === 'build' || target === 'all') {
    /** Gradle clean, then the frontend and Daml outputs Gradle does not remove. */
    const status = await cleanBuild(ctx);
    if (status !== 0) return status;
  }
  if (target === 'docker' || target === 'all') {
    /** Compose volumes, then the shell and console containers that live outside the project. */
    const status = await cleanDocker(ctx);
    if (status !== 0) return status;
  }
  if (target === 'sweep' || target === 'all') return cleanSweep(ctx);
  return 0;
}

/**
 * `./gradlew clean`, then `frontend/dist` and each package's `.daml/dist`.
 * Missing directories are ignored. `--dry-run` prints those paths and deletes nothing.
 * A Gradle failure leaves the extra directories in place.
 */
async function cleanBuild(ctx: CommandContext): Promise<number> {
  /** Checkout whose build output is removed. `.env.local` is not required. */
  const project = projectFromContext(ctx);
  return step(ctx.io, 'Removing build output', 'Build output removed', async () => {
    /** Gradle status. A failure leaves the extra directories in place. */
    const status = await loggedRun(ctx.io, ctx.runner, ['./gradlew', 'clean'], {
      cwd: project.dir,
      env: definedEnv(ctx.env),
    });
    if (status !== 0) return status;
    /** Extra output Gradle does not remove. The same list is printed or deleted. */
    const extra = await buildOutputDirs(project.dir);
    if (ctx.dryRun) {
      for (const path of extra) {
        /** Same line `loggedRun` prints, so a dry run shows the deletion it will not perform. */
        const line = formatCommand(['rm', '-rf', relative(project.dir, path)]);
        ctx.io.note(`${paint('dim', `$ ${line}`)}\n`);
      }
      return 0;
    }
    for (const path of extra) await rm(path, { recursive: true, force: true });
    return 0;
  });
}

/**
 * Directories removed after `./gradlew clean`: `frontend/dist`, then each `.daml/dist`
 * one and two levels under `daml/`. Two levels covers the external test packages.
 * Files are skipped, and a missing `daml/` contributes no Daml paths.
 * The directories need not exist; `rm` ignores a missing one.
 */
async function buildOutputDirs(projectDir: string): Promise<string[]> {
  /** Paths passed to `rm`. `frontend/dist` is always included. */
  const paths = [join(projectDir, 'frontend', 'dist')];
  /** Top of the Daml tree. Missing means there is nothing further to remove. */
  let entries: Dirent[];
  try {
    entries = await readdir(join(projectDir, 'daml'), { withFileTypes: true });
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return paths;
    throw error;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    paths.push(join(projectDir, 'daml', entry.name, '.daml', 'dist'));
    /** Nested packages, such as `external-test-sources/<name>`. Files are skipped. */
    let nested: Dirent[] = [];
    try {
      nested = await readdir(join(projectDir, 'daml', entry.name), { withFileTypes: true });
    } catch {
      nested = [];
    }
    for (const child of nested) {
      if (!child.isDirectory()) continue;
      paths.push(join(projectDir, 'daml', entry.name, child.name, '.daml', 'dist'));
    }
  }
  return paths;
}

/**
 * Remove the shell and console containers, then `docker compose down -v`.
 * `docker rm` errors are ignored, matching the Makefile's `|| true`.
 */
async function cleanDocker(ctx: CommandContext): Promise<number> {
  /** Checkout whose volumes are removed. */
  const project = composeProject(ctx);
  return step(
    ctx.io,
    'Removing containers and volumes',
    'Containers and volumes removed',
    async () => {
      await loggedRun(
        ctx.io,
        ctx.runner,
        ['docker', 'rm', '-f', 'quickstart-daml-shell', 'canton-console'],
        {
          cwd: project.dir,
          env: definedEnv(ctx.env),
        },
      );
      return composeReady(ctx, project, ['down', '-v']);
    },
  );
}

/**
 * Remove leftover containers, the project network, and volumes named after it.
 * An empty group prints `(none)` and is not an error.
 */
async function cleanSweep(ctx: CommandContext): Promise<number> {
  /** Checkout whose `DOCKER_NETWORK` is swept. */
  const project = composeProject(ctx);
  return step(ctx.io, 'Removing leftover Docker state', 'Leftover Docker state removed', () =>
    sweepGroups(ctx, project),
  );
}

/**
 * Remove containers, the project network, and volumes named after it.
 * An empty group prints `(none)` and is not an error. The step heading is printed by `cleanSweep`.
 */
async function sweepGroups(ctx: CommandContext, project: Project): Promise<number> {
  /** Network name from `.env`, or `quickstart`. */
  const network = project.settings.dockerNetwork;
  if (ctx.dryRun) {
    await loggedRun(ctx.io, ctx.runner, ['docker', 'ps', '-aq', '--filter', `network=${network}`], {
      cwd: project.dir,
      env: definedEnv(ctx.env),
    });
    await loggedRun(
      ctx.io,
      ctx.runner,
      ['docker', 'network', 'ls', '-q', '--filter', `name=${network}`],
      { cwd: project.dir, env: definedEnv(ctx.env) },
    );
    await loggedRun(
      ctx.io,
      ctx.runner,
      ['docker', 'volume', 'ls', '-q', '--filter', `name=^${network}`],
      { cwd: project.dir, env: definedEnv(ctx.env) },
    );
    return 0;
  }
  /** Daemon check before the listing commands. */
  const docker = await ensureDocker(ctx);
  if (docker !== 0) return docker;
  ctx.io.note(`${paint('bold', `Removing containers on ${network}`)}\n`);
  /** Container ids attached to the network. */
  const containers = await idList(ctx, project.dir, [
    'docker',
    'ps',
    '-aq',
    '--filter',
    `network=${network}`,
  ]);
  if (containers.length === 0) ctx.io.note(`${aside('(none)')}\n`);
  else {
    /** Remove status. A failure stops before the network is touched. */
    const status = await loggedRun(ctx.io, ctx.runner, ['docker', 'rm', '-f', ...containers], {
      cwd: project.dir,
      env: definedEnv(ctx.env),
    });
    if (status !== 0) return status;
  }
  ctx.io.note(`${paint('bold', `Removing network ${network}`)}\n`);
  /** Network ids whose name contains `network`. */
  const networks = await idList(ctx, project.dir, [
    'docker',
    'network',
    'ls',
    '-q',
    '--filter',
    `name=${network}`,
  ]);
  if (networks.length === 0) ctx.io.note(`${aside('(none)')}\n`);
  else {
    const status = await loggedRun(ctx.io, ctx.runner, ['docker', 'network', 'rm', ...networks], {
      cwd: project.dir,
      env: definedEnv(ctx.env),
    });
    if (status !== 0) return status;
  }
  ctx.io.note(`${paint('bold', `Removing volumes named ${network}`)}\n`);
  /** Volume names matching the Makefile's anchored filter. */
  const volumes = await idList(ctx, project.dir, [
    'docker',
    'volume',
    'ls',
    '-q',
    '--filter',
    `name=^${network}`,
  ]);
  if (volumes.length === 0) {
    ctx.io.note(`${aside('(none)')}\n`);
    return 0;
  }
  return loggedRun(ctx.io, ctx.runner, ['docker', 'volume', 'rm', ...volumes], {
    cwd: project.dir,
    env: definedEnv(ctx.env),
  });
}

/**
 * Run `cmd` and split the output into non-empty lines.
 * A non-zero status throws, because a failed listing should not look like an empty group.
 */
async function idList(ctx: CommandContext, cwd: string, cmd: string[]): Promise<string[]> {
  /** Listing result. Dry-run still executes this, since it only reads Docker. */
  const result = await ctx.runner.capture(cmd, { cwd, env: definedEnv(ctx.env) });
  if (result.code !== 0) {
    throw new Error(`${cmd.join(' ')} failed (exit ${result.code}).`);
  }
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

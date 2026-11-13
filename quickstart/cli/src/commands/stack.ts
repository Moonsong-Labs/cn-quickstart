// Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: 0BSD

import type { Dirent } from 'node:fs';
import { readdir, rm } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { Argument, type Command, CommanderError } from 'commander';
import { type ComposeCall, compose, composeArgs, composeEnv } from '../lib/compose.ts';
import type { CommandContext } from '../lib/context.ts';
import { ensureDocker } from '../lib/docker.ts';
import type { Captured } from '../lib/exec.ts';
import { definedEnv, formatCommand, loggedRun } from '../lib/exec.ts';
import { composeProject, type Project, projectFromContext } from '../lib/project.ts';
import { askYesNo } from '../lib/prompts.ts';
import type { CommandDeps } from '../lib/register.ts';
import { step } from '../lib/step.ts';
import { aside, bad, paint } from '../lib/style.ts';
import { runBuild } from './build.ts';
import { runCapture } from './capture.ts';
import { openTargetUrl } from './open.ts';

/**
 * Docker preflight, then `compose`.
 * The preflight is skipped for `--dry-run`. A stopped daemon returns 1 before Compose runs.
 * `opts` chooses the stack. Omitting it runs the app stack.
 */
async function composeReady(
  ctx: CommandContext,
  project: Project,
  args: string[],
  opts?: ComposeCall,
): Promise<number> {
  /** Daemon check. Zero when Docker is ready or this is a dry run. */
  const docker = await ensureDocker(ctx);
  if (docker !== 0) return docker;
  return compose(ctx, project, args, opts);
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

/**
 * What `qs clean` deletes.
 * `sweep` is the leftover containers, network, and volumes only.
 * `console` and `shell` remove one named container and leave the stack running.
 */
export type CleanTarget = 'build' | 'docker' | 'sweep' | 'all' | 'console' | 'shell';

/**
 * Delete build output, Docker state, leftover Docker objects, or all of them.
 * `all` asks for confirmation unless `yes` or `--dry-run`. Declining leaves everything in place and returns 0.
 * `console` and `shell` only remove that container. A `docker rm` failure is ignored.
 * `sweep` does not ask, matching `make clean-all-docker`.
 */
export async function runClean(
  ctx: CommandContext,
  target: CleanTarget,
  yes: boolean,
): Promise<number> {
  if (target === 'console') return removeNamedContainer(ctx, 'canton-console');
  if (target === 'shell') return removeNamedContainer(ctx, 'quickstart-daml-shell');
  if (target === 'all' && !yes && !ctx.dryRun) {
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
    /** App and install-request volumes, plus the shell and console containers. */
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
 * Remove one leftover container by name.
 * `docker rm` status is ignored, matching the Makefile's `|| true`. A stopped daemon returns 1.
 * `.env.local` is not required. The container is not part of the Compose project.
 */
async function removeNamedContainer(ctx: CommandContext, name: string): Promise<number> {
  /** Checkout used as the working directory. Missing setup must not block `docker rm`. */
  const project = projectFromContext(ctx);
  /** Daemon check. Skipped for `--dry-run`. */
  const docker = await ensureDocker(ctx);
  if (docker !== 0) return docker;
  await loggedRun(ctx.io, ctx.runner, ['docker', 'rm', '-f', name], {
    cwd: project.dir,
    env: definedEnv(ctx.env),
  });
  return 0;
}

/**
 * Remove the shell and console containers, then `docker compose down -v`
 * for the app stack and the install-request stack.
 * `docker rm` errors are ignored, matching the Makefile's `|| true`.
 * The install-request project has its own volume, which the app stack's `down -v` does not see.
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
      /** App stack. A failure leaves the install-request volume in place. */
      const app = await composeReady(ctx, project, ['down', '-v']);
      if (app !== 0) return app;
      /** Install-request stack. Constraint files belong to the app stack only. */
      return composeReady(ctx, project, ['down', '-v'], {
        stack: 'install-request',
        constraints: false,
      });
    },
  );
}

/**
 * Remove leftover containers, the project network, and volumes named after
 * the project or the install-request stack.
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
 * Remove containers, the project network, and volumes named after the project
 * or the install-request stack.
 * An empty group prints `(none)` and is not an error. The step heading is printed by `cleanSweep`.
 */
async function sweepGroups(ctx: CommandContext, project: Project): Promise<number> {
  /** Network name from `.env`, or `quickstart`. */
  const network = project.settings.dockerNetwork;
  /** Prefix of install-request volumes. The app stack's `down` does not remove them. */
  const installRequest = 'create-app-install-request';
  if (ctx.dryRun) {
    await loggedRun(ctx.io, ctx.runner, ['docker', 'ps', '-aq', '--filter', `network=${network}`], {
      cwd: project.dir,
      env: definedEnv(ctx.env),
    });
    await loggedRun(
      ctx.io,
      ctx.runner,
      ['docker', 'network', 'ls', '-q', '--filter', `name=^${network}$`],
      { cwd: project.dir, env: definedEnv(ctx.env) },
    );
    await loggedRun(
      ctx.io,
      ctx.runner,
      ['docker', 'volume', 'ls', '-q', '--filter', `name=^${network}`],
      { cwd: project.dir, env: definedEnv(ctx.env) },
    );
    await loggedRun(
      ctx.io,
      ctx.runner,
      ['docker', 'volume', 'ls', '-q', '--filter', `name=^${installRequest}`],
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
  /** Network ids whose name is exactly `network`. The filter is anchored so a longer name is kept. */
  const networks = await idList(ctx, project.dir, [
    'docker',
    'network',
    'ls',
    '-q',
    '--filter',
    `name=^${network}$`,
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
  /** Project volumes. A failure stops before the install-request volumes are touched. */
  const projectVolumes = await removeVolumes(ctx, project, network);
  if (projectVolumes !== 0) return projectVolumes;
  ctx.io.note(`${paint('bold', `Removing volumes named ${installRequest}`)}\n`);
  return removeVolumes(ctx, project, installRequest);
}

/**
 * Remove Docker volumes whose names start with `prefix`.
 * An empty list prints `(none)` and returns 0. The caller prints the heading.
 * A failed `docker volume rm` returns its status.
 */
async function removeVolumes(
  ctx: CommandContext,
  project: Project,
  prefix: string,
): Promise<number> {
  /** Names returned by the anchored `name=` filter. */
  const volumes = await idList(ctx, project.dir, [
    'docker',
    'volume',
    'ls',
    '-q',
    '--filter',
    `name=^${prefix}`,
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

/**
 * Register the stack commands: start, stop, restart, status, logs, compose, and clean.
 * `logs --capture` follows container events. `clean console` and `clean shell` remove one container.
 */
export function registerStack(program: Command, deps: CommandDeps): void {
  /** A subcommand that already has the shared flags. */
  const sub = (name: string) => deps.addSharedOptions(program.command(name));

  sub('start')
    .description('Build, then start the stack')
    .option('--no-build', 'Start the containers without building first')
    .action(async (_local: unknown, command: Command) => {
      /** True when `--no-build` was set. Commander stores the positive name `build` as false. */
      const noBuild = command.opts<{ build?: boolean }>().build === false;
      await deps.run(command, (ctx) => runStart(ctx, noBuild));
    });

  sub('stop')
    .description('Stop the stack')
    .action(async (_local: unknown, command: Command) => {
      await deps.run(command, runStop);
    });

  sub('restart')
    .description('Restart the stack, or one of backend, frontend, or a service')
    .argument(
      '[target]',
      'backend, frontend, or a Compose service. Service names are checked when the command runs',
    )
    .action(async (target: string | undefined, _local: unknown, command: Command) => {
      await deps.run(command, (ctx) => runRestart(ctx, target));
    });

  sub('status')
    .description('Show the Compose services')
    .action(async (_local: unknown, command: Command) => {
      await deps.run(command, runStatus);
    });

  sub('logs')
    .description('Show service logs')
    .option('-f, --follow', 'Keep streaming logs')
    .option('--capture', 'Follow container events and write them under logs/')
    .argument('[services...]', 'Services to show. Omit to show all of them')
    .action(async (services: string[], _local: unknown, command: Command) => {
      /** True when `-f` or `--follow` was set. */
      const follow = command.opts<{ follow?: boolean }>().follow === true;
      /** True when `--capture` was set. It replaces the Compose log stream. */
      const capture = command.opts<{ capture?: boolean }>().capture === true;
      if (capture && (follow || services.length > 0)) {
        throw new CommanderError(
          2,
          'qs.usage',
          '--capture cannot be combined with -f or service names.',
        );
      }
      await deps.run(command, (ctx) =>
        capture ? runCapture(ctx) : runLogs(ctx, follow, services),
      );
    });

  sub('compose')
    .description('Run docker compose with the quickstart files')
    .allowUnknownOption()
    .passThroughOptions()
    .argument('[args...]', 'Arguments passed through to docker compose')
    .addHelpText('after', () =>
      [
        '',
        aside('Put qs flags before the compose arguments: qs compose --dry-run config.'),
        aside('Set QS_EXTRA_COMPOSE_FILES or QS_EXTRA_ENV_FILES in .env.local'),
        aside('to append your own files. Separate paths with colons.'),
      ].join('\n'),
    )
    .action(async (args: string[], _local: unknown, command: Command) => {
      await deps.run(command, (ctx) => runCompose(ctx, args));
    });

  sub('clean')
    .description('Remove build output, Compose state, or leftover Docker objects')
    .addArgument(
      new Argument('<target>', 'What to remove').choices([
        'build',
        'docker',
        'sweep',
        'all',
        'console',
        'shell',
      ]),
    )
    .option('--yes', 'Skip the confirmation prompt. Only all asks')
    .addHelpText('after', () => {
      /**
       * One help row. The name is coloured and padded so the details line up.
       */
      const row = (name: string, detail: string) =>
        `${paint('yellow', name.padEnd(8))}${aside(detail)}`;
      return [
        '',
        row('build', 'Gradle output, frontend/dist, and each package .daml/dist'),
        row(
          'docker',
          'App and install-request containers and volumes, plus the shell and console containers',
        ),
        row(
          'sweep',
          'Containers on the project network, that network, and volumes named after it or the install request',
        ),
        row('all', 'build, then docker, then sweep. Asks first unless --yes'),
        row('console', 'The canton-console container, leaving the stack running'),
        row('shell', 'The quickstart-daml-shell container, leaving the stack running'),
      ].join('\n');
    })
    .action(async (target: CleanTarget, _local: unknown, command: Command) => {
      /** True when `--yes` was set. An absent flag leaves the confirmation prompt in place. */
      const yes = command.opts<{ yes?: boolean }>().yes === true;
      await deps.run(command, (ctx) => runClean(ctx, target, yes));
    });
}

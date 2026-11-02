// Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: 0BSD

import type { CommandContext } from './context.ts';
import { definedEnv, loggedRun } from './exec.ts';
import type { Project, Settings } from './project.ts';

/**
 * Which Compose project a command runs.
 * `app` is the Quickstart stack. `daml-shell` and `install-request` are the two one-shot projects.
 */
export type ComposeStack = 'app' | 'daml-shell' | 'install-request';

/** Which stack to run, and whether it wants the resource-constraint files. */
export type ComposeCall = {
  /** When false, constraint files are left out even if the settings enable them. Defaults to true. Ignored except for `app`. */
  constraints?: boolean;
  /** Compose project. Defaults to `app`. */
  stack?: ComposeStack;
};

/**
 * Env files shared by every stack, in the Makefile's order.
 * Keycloak's file is included only for `oauth2`.
 */
function baseEnvFiles(settings: Settings): string[] {
  /** Built-in env files. `.env.local` is always listed; the caller checks that it exists. */
  const envFiles = [
    '--env-file',
    '.env',
    '--env-file',
    '.env.local',
    '--env-file',
    `${settings.localnetDir}/compose.env`,
    '--env-file',
    `${settings.localnetDir}/env/common.env`,
  ];
  if (settings.authMode === 'oauth2') {
    envFiles.push('--env-file', `${settings.modulesDir}/keycloak/compose.env`);
  }
  envFiles.push('--env-file', `${settings.modulesDir}/pqs/compose.env`);
  return envFiles;
}

/** `QS_EXTRA_ENV_FILES`, each prefixed so Compose treats it as an env file. */
function extraEnvArgs(settings: Settings): string[] {
  /** Extra env files in listed order. */
  const args: string[] = [];
  for (const extra of settings.extraEnvFiles) args.push('--env-file', extra);
  return args;
}

/**
 * Arguments between `docker compose` and the subcommand.
 * `app` matches the Makefile: files, env files, profiles, then constraint files.
 * `daml-shell` and `install-request` use their own first file and no profiles or constraint files.
 * Extra files from `QS_EXTRA_*` are appended to their own list. Extra Compose files apply to `app` only.
 */
export function composeArgs(settings: Settings, opts?: ComposeCall): string[] {
  /** Project this command runs. The shell and install request do not use the app files. */
  const stack = opts?.stack ?? 'app';
  if (stack === 'daml-shell') {
    return [
      '-f',
      `${settings.modulesDir}/daml-shell/compose.yaml`,
      ...baseEnvFiles(settings),
      '--env-file',
      `${settings.modulesDir}/daml-shell/compose.env`,
      ...extraEnvArgs(settings),
    ];
  }
  if (stack === 'install-request') {
    return [
      '-f',
      'docker/create-app-install-request/compose.yaml',
      ...baseEnvFiles(settings),
      ...extraEnvArgs(settings),
    ];
  }
  /** Compose files, in merge order. Later files override earlier ones. */
  const files = ['-f', 'compose.yaml', '-f', `${settings.localnetDir}/compose.yaml`];
  if (settings.authMode === 'oauth2') {
    files.push('-f', `${settings.modulesDir}/keycloak/compose.yaml`);
  }
  files.push(
    '-f',
    `${settings.modulesDir}/splice-onboarding/compose.yaml`,
    '-f',
    `${settings.modulesDir}/pqs/compose.yaml`,
  );
  if (settings.debug) files.push('-f', './docker/backend-service/debug.yaml');
  for (const extra of settings.extraComposeFiles) files.push('-f', extra);

  /** Env files shared with the other stacks, then any extras from `.env.local`. */
  const envFiles = [...baseEnvFiles(settings), ...extraEnvArgs(settings)];

  /** Profiles that are always on, then the optional ones. */
  const profiles = ['app-provider', 'app-user', 'sv', 'swagger-ui'];
  if (settings.authMode === 'oauth2') profiles.push('keycloak');
  profiles.push('pqs-app-provider');
  if (settings.pqsAppUser) profiles.push('pqs-app-user');
  if (settings.pqsSv) profiles.push('pqs-sv');

  /** Full argument list before the subcommand. */
  const args = [...files, ...envFiles];
  for (const profile of profiles) args.push('--profile', profile);

  if ((opts?.constraints ?? true) && settings.resourceConstraints) {
    args.push('-f', `${settings.localnetDir}/resource-constraints.yaml`);
    if (settings.authMode === 'oauth2') {
      args.push('-f', `${settings.modulesDir}/keycloak/resource-constraints.yaml`);
    }
    args.push(
      '-f',
      `${settings.modulesDir}/splice-onboarding/resource-constraints.yaml`,
      '-f',
      `${settings.modulesDir}/pqs/resource-constraints.yaml`,
      '-f',
      './docker/backend-service/resource-constraints.yaml',
    );
  }
  return args;
}

/**
 * Environment for a Compose child.
 * A non-empty parent value is kept, so Compose interpolation honours the same
 * override as the files and profiles (`make start KEY=value`, `KEY=value qs start`).
 * A file key the parent left unset or empty is removed, so Compose reads that one
 * from the env files. `MODULES_DIR`, `LOCALNET_DIR`, and `IMAGE_TAG` are then set
 * to the resolved values.
 */
export function composeEnv(
  env: Record<string, string | undefined>,
  project: Project,
): Record<string, string> {
  /** Child environment. Overrides stay; other file keys are left to the env files. */
  const child = definedEnv(env);
  for (const key of project.fileKeys) {
    /** Parent value. Empty or absent means Compose should read the env file. */
    const fromParent = env[key];
    if (fromParent === undefined || fromParent.length === 0) delete child[key];
  }
  child.MODULES_DIR = project.settings.modulesDir;
  child.LOCALNET_DIR = project.settings.localnetDir;
  child.IMAGE_TAG = project.settings.splice;
  return child;
}

/**
 * Run `docker compose` with the quickstart files.
 * Prints the command, then runs it in the checkout directory.
 * Constraint files are included when the settings leave them on.
 */
export async function compose(
  ctx: CommandContext,
  project: Project,
  args: string[],
  opts?: ComposeCall,
): Promise<number> {
  /** Full command, including the files and profiles for this checkout. */
  const cmd = ['docker', 'compose', ...composeArgs(project.settings, opts), ...args];
  return loggedRun(ctx.io, ctx.runner, cmd, {
    cwd: project.dir,
    env: composeEnv(ctx.env, project),
  });
}

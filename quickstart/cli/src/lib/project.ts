// Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: 0BSD

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { CommandContext } from './context.ts';
import { expandEnvValue, parseDotEnv } from './env.ts';
import { resolveProjectRoot } from './paths.ts';

/**
 * Values that change the Compose files, profiles, and a few commands.
 * A decision flag is true only for the same literal the Makefile compares.
 */
export type Settings = {
  /** Overrides the local Compose env file for isolated runs. Defaults to .env.local. */
  localEnvFile?: string;
  /** `oauth2` adds Keycloak. Any other value, including unset, leaves it out. */
  authMode: 'oauth2' | 'shared-secret' | undefined;
  /** Party hint from the files or the environment. Empty when setup has not been run. */
  partyHint: string | undefined;
  /** `on` or `off` when the files say so. Otherwise unset. */
  testMode: 'on' | 'off' | undefined;
  /** True unless the resolved value is present and is not the string `true`. The default is on. */
  resourceConstraints: boolean;
  /** True only when the resolved value is `true`. The default is off. */
  debug: boolean;
  /** True only when `PQS_APP_USER_PROFILE` is `on`. */
  pqsAppUser: boolean;
  /** True only when `PQS_SV_PROFILE` is `on`. */
  pqsSv: boolean;
  /** `SPLICE_VERSION`. Empty when neither the files nor the environment set it. */
  splice: string;
  /** Docker network name. `quickstart` when nothing sets `DOCKER_NETWORK`. */
  dockerNetwork: string;
  /** Absolute `docker/modules` directory, or `MODULES_DIR` when that is set. */
  modulesDir: string;
  /** Absolute LocalNet directory, or `LOCALNET_DIR` when that is set. */
  localnetDir: string;
  /** Extra Compose files from `QS_EXTRA_COMPOSE_FILES`, in listed order. */
  extraComposeFiles: string[];
  /** Extra env files from `QS_EXTRA_ENV_FILES`, in listed order. */
  extraEnvFiles: string[];
};

/** A quickstart checkout plus the settings read from it. */
export type Project = {
  /** Absolute quickstart directory. Compose runs with this as its working directory. */
  dir: string;
  /** `.env` overlaid by `.env.local`. Later keys win. */
  fileEnv: Map<string, string>;
  /** Every key defined in either file, including keys whose value is empty. */
  fileKeys: Set<string>;
  /** True when `.env.local` exists. Compose is given that path even when the file is empty. */
  hasEnvLocal: boolean;
  /** Resolved decisions for this checkout. */
  settings: Settings;
};

/** Where `loadProject` looks, and which environment supplies the fallback values. */
export type ProjectInput = {
  /** Working directory for a relative `--project` and for the upward search. */
  cwd: string;
  /** CLI source directory, searched when `cwd` is not inside a checkout. */
  cliDir: string;
  /** Process environment. A non-empty value beats the files, and the files beat defaults. */
  env: Record<string, string | undefined>;
  /** `--project`, when passed. */
  project?: string;
};

/**
 * Read a text file. A missing file is null. Any other error is rethrown.
 */
function readOptional(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }
}

/**
 * First non-empty value. An empty string does not count, so a blank assignment
 * falls through to the next candidate, and the caller supplies the default.
 */
function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    if (value !== undefined && value.length > 0) return value;
  }
  return undefined;
}

/**
 * Value of `key` from the environment, then the files.
 * A non-empty environment value wins, so `make start KEY=value` and
 * `KEY=value qs start` override `.env` and `.env.local`. An empty environment
 * value does not count and falls through to the file.
 */
function fromEnvThenFiles(
  fileEnv: Map<string, string>,
  env: Record<string, string | undefined>,
  key: string,
): string | undefined {
  /** Shell value. Blank does not override a file the way an explicit value does. */
  const fromEnv = env[key];
  if (fromEnv !== undefined && fromEnv.length > 0) return fromEnv;
  if (fileEnv.has(key)) return fileEnv.get(key);
  return fromEnv;
}

/**
 * Split a colon-separated path list. Empty pieces and surrounding spaces are dropped.
 */
function colonList(value: string | undefined): string[] {
  if (value === undefined || value.length === 0) return [];
  return value
    .split(':')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

/**
 * Read the checkout at `dir`. Does not require `SPLICE_VERSION`.
 * Reads the selected local env file (normally `.env.local`) over the checkout defaults.
 * A non-empty value in `env` overrides both files.
 * `${NAME}` and `$(NAME)` are expanded the way Make expands an included env file,
 * so `LOCALNET_DIR=${MODULES_DIR}/localnet` is a real path. `$$` is a literal `$`.
 */
export function readProject(
  dir: string,
  env: Record<string, string | undefined>,
  localEnvFile = '.env.local',
): Project {
  /** Parsed `.env`. The project marker guarantees the file exists. */
  const fileEnv = parseDotEnv(readOptional(join(dir, '.env')) ?? '');
  /** Local overrides, or null if the selected file does not exist. */
  const localText = readOptional(resolve(dir, localEnvFile));
  if (localText !== null) {
    for (const [key, value] of parseDotEnv(localText)) fileEnv.set(key, value);
  }

  /** `<checkout>/docker/modules`. Used when nothing sets `MODULES_DIR`. */
  const defaultModules = join(dir, 'docker', 'modules');
  /** Names currently being expanded. A repeat is a cycle. */
  const expanding: string[] = [];
  /**
   * Expanded value of `name`.
   * A non-empty environment or file value is expanded. Otherwise `MODULES_DIR`
   * and `LOCALNET_DIR` use the checkout defaults, and any other name is empty.
   * Throws when a reference loops back to a name already on the stack.
   */
  const lookup = (name: string): string => {
    if (expanding.includes(name)) {
      throw new Error(`Cyclic environment reference: ${[...expanding, name].join(' -> ')}`);
    }
    /** Unexpanded value. Empty does not count, so a blank assignment uses the default. */
    const raw = fromEnvThenFiles(fileEnv, env, name);
    if (raw !== undefined && raw.length > 0) {
      expanding.push(name);
      try {
        return expandEnvValue(raw, lookup);
      } finally {
        expanding.pop();
      }
    }
    if (name === 'MODULES_DIR') return defaultModules;
    if (name === 'LOCALNET_DIR') return join(resolvedModules(), 'localnet');
    return '';
  };
  /**
   * `MODULES_DIR` for the `LOCALNET_DIR` default.
   * A set value is expanded. An unset value uses the checkout default without
   * looking `MODULES_DIR` up again, so a reference from that default cannot cycle.
   */
  const resolvedModules = (): string => {
    /** File or environment value, before the checkout default. */
    const raw = fromEnvThenFiles(fileEnv, env, 'MODULES_DIR');
    if (raw !== undefined && raw.length > 0) return lookup('MODULES_DIR');
    return defaultModules;
  };
  /**
   * Environment value when it is non-empty, otherwise the file value.
   * References inside the chosen value are expanded. An unset key stays unset
   * so the caller can apply its own default.
   */
  const pick = (key: string): string | undefined => {
    /** Chosen value, still containing any `${NAME}` references. */
    const raw = fromEnvThenFiles(fileEnv, env, key);
    if (raw === undefined || raw.length === 0) return raw;
    return lookup(key);
  };
  /** `MODULES_DIR`, or `<checkout>/docker/modules`. Relative values are resolved from the checkout. */
  const modulesDir = resolve(dir, firstNonEmpty(pick('MODULES_DIR')) ?? join('docker', 'modules'));
  /** `LOCALNET_DIR`, or `<modules>/localnet`. */
  const localnetDir = resolve(
    dir,
    firstNonEmpty(pick('LOCALNET_DIR')) ?? join(modulesDir, 'localnet'),
  );
  /** Auth mode. Only the two Makefile values are kept. */
  const authRaw = pick('AUTH_MODE');
  /** Test mode. Only `on` and `off` are kept. */
  const testRaw = pick('TEST_MODE');
  /** Resource constraints. Unset means on, matching `RESOURCE_CONSTRAINTS_ENABLED ?= true`. */
  const constraintsRaw = pick('RESOURCE_CONSTRAINTS_ENABLED');

  return {
    dir,
    fileEnv,
    fileKeys: new Set(fileEnv.keys()),
    hasEnvLocal: localText !== null,
    settings: {
      localEnvFile,
      authMode: authRaw === 'oauth2' || authRaw === 'shared-secret' ? authRaw : undefined,
      partyHint: firstNonEmpty(pick('PARTY_HINT')),
      testMode: testRaw === 'on' || testRaw === 'off' ? testRaw : undefined,
      resourceConstraints: (constraintsRaw ?? 'true') === 'true',
      debug: pick('DEBUG_ENABLED') === 'true',
      pqsAppUser: pick('PQS_APP_USER_PROFILE') === 'on',
      pqsSv: pick('PQS_SV_PROFILE') === 'on',
      splice: firstNonEmpty(pick('SPLICE_VERSION')) ?? '',
      dockerNetwork: firstNonEmpty(pick('DOCKER_NETWORK')) ?? 'quickstart',
      modulesDir,
      localnetDir,
      extraComposeFiles: colonList(pick('QS_EXTRA_COMPOSE_FILES')),
      extraEnvFiles: colonList(pick('QS_EXTRA_ENV_FILES')),
    },
  };
}

/**
 * Resolve the checkout and read it. Throws when `SPLICE_VERSION` is missing,
 * because an empty `IMAGE_TAG` would make Compose pull `:latest`.
 */
export function loadProject(input: ProjectInput): Project {
  /** Checkout directory. Throws when the markers cannot be found. */
  const dir = resolveProjectRoot(input.cwd, input.cliDir, input.project);
  /** Settings for that checkout. */
  const project = readProject(dir, input.env);
  if (project.settings.splice.length === 0) {
    throw new Error('SPLICE_VERSION is not set in .env.');
  }
  return project;
}

/**
 * Throw when `.env.local` is missing.
 * Compose is always given that env file, and Docker fails less clearly when it is absent.
 */
export function requireEnvLocal(project: Project): void {
  if (!project.hasEnvLocal) throw new Error('Run qs setup first.');
}

/**
 * Load the checkout for this command.
 * Throws when the directory cannot be found or `SPLICE_VERSION` is missing.
 */
export function projectFromContext(ctx: CommandContext): Project {
  return loadProject({
    cwd: ctx.cwd,
    cliDir: ctx.cliDir,
    env: ctx.env,
    ...(ctx.project !== undefined ? { project: ctx.project } : {}),
  });
}

/**
 * Load the checkout for a Compose command.
 * A real run requires `.env.local`. `--dry-run` still returns the checkout so the command line can be printed.
 */
export function composeProject(ctx: CommandContext): Project {
  /** Checkout, including the Splice version check. */
  const project = projectFromContext(ctx);
  if (!ctx.dryRun) requireEnvLocal(project);
  return project;
}

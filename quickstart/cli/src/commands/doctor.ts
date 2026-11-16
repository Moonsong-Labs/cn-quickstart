// Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: 0BSD

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Command } from 'commander';
import type { CommandContext } from '../lib/context.ts';
import {
  compareVersions,
  dockerStatus,
  dockerVersions,
  MIN_COMPOSE,
  MIN_DOCKER,
  plainVersion,
} from '../lib/docker.ts';
import { damlSdkVersion, dpmExecutable } from '../lib/dpm.ts';
import type { Captured } from '../lib/exec.ts';
import { resolveProjectRoot } from '../lib/paths.ts';
import { readProject } from '../lib/project.ts';
import type { CommandDeps } from '../lib/register.ts';
import { step } from '../lib/step.ts';
import { paint } from '../lib/style.ts';

/** One doctor line: a required failure, a warning, or a pass. */
type Check = {
  /** `bad` fails the command. `warn` does not. */
  kind: 'ok' | 'warn' | 'bad';
  /** Short name, padded so the details line up. */
  name: string;
  /** What was found, or what to do next. */
  detail: string;
};

/**
 * Print one aligned check. The mark and the name are coloured. The detail stays plain.
 */
function report(ctx: CommandContext, check: Check) {
  /** Name padded so the detail column lines up across the list. */
  const label = check.name.padEnd(14);
  /** Coloured mark and name. The tick, bang, and cross match the other commands. */
  const painted =
    check.kind === 'ok'
      ? paint('green', `✓ ${label}`)
      : check.kind === 'warn'
        ? paint('yellow', `! ${label}`)
        : paint('red', `✗ ${label}`);
  ctx.io.note(`${painted}${check.detail}\n`);
}

/**
 * Major Java version from `java -version` output, which is written to stderr.
 * Returns null when the text has no `version "N"` field.
 */
export function javaMajor(text: string): number | null {
  /** First `version "N"` field. The rest of the version is ignored. */
  const match = /version "(\d+)/.exec(text);
  if (!match?.[1]) return null;
  return Number.parseInt(match[1], 10);
}

/**
 * Read `.bun-version` from the checkout's parent, which is the workspace root in this repo.
 * Returns null when the file is absent.
 */
function pinnedBun(projectDir: string): string | null {
  try {
    return readFileSync(join(projectDir, '..', '.bun-version'), 'utf8').trim();
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }
}

/**
 * Check Docker, Compose, the Splice pin, and the advisory tools.
 * Required failures return 1. Warnings return 0. Every check is printed either way.
 */
export async function runDoctor(ctx: CommandContext): Promise<number> {
  return step(ctx.io, 'Quickstart doctor', 'Checks finished', () => collectChecks(ctx));
}

/**
 * Probe every check, print the list, and return 1 when a required check failed.
 * Warnings are printed and still return 0. The step heading is printed by `runDoctor`.
 */
async function collectChecks(ctx: CommandContext): Promise<number> {
  /** Checkout. A missing project still throws, because there is nothing to check. */
  const dir = resolveProjectRoot(ctx.cwd, ctx.cliDir, ctx.project);
  /** Settings. An empty Splice version is reported below instead of thrown. */
  const project = readProject(dir, ctx.env);
  /** Lines to print after the probes finish, so a slow Docker call does not split the list. */
  const checks: Check[] = [];

  /** Docker daemon probe. The same sentences are printed by `ensureDocker`. */
  const docker = await dockerStatus(ctx);
  if (!docker.ok) {
    checks.push({ kind: 'bad', name: 'Docker', detail: docker.detail });
  } else {
    /** Client and Compose versions. Only queried once the daemon has answered. */
    const versions = await dockerVersions(ctx);
    checks.push(versionCheck('Docker', versions.docker, MIN_DOCKER));
    checks.push(versionCheck('Compose', versions.compose, MIN_COMPOSE));
  }

  if (project.settings.splice.length === 0) {
    checks.push({ kind: 'bad', name: 'Splice', detail: 'SPLICE_VERSION is not set in .env' });
  } else {
    checks.push({ kind: 'ok', name: 'Splice', detail: project.settings.splice });
  }

  if (!project.hasEnvLocal) {
    checks.push({ kind: 'warn', name: '.env.local', detail: 'missing. Run qs setup' });
  } else if (!project.settings.partyHint) {
    checks.push({ kind: 'warn', name: '.env.local', detail: 'has no PARTY_HINT. Run qs setup' });
  } else {
    checks.push({ kind: 'ok', name: '.env.local', detail: project.settings.partyHint });
  }

  checks.push(await toolVersion(ctx, 'Bun', ['bun', '--version'], pinnedBun(dir)));
  checks.push(await dpmSdkCheck(ctx, dir));
  checks.push(await dpmCliCheck(ctx));
  checks.push(await javaCheck(ctx));

  for (const check of checks) report(ctx, check);
  return checks.some((check) => check.kind === 'bad') ? 1 : 0;
}

/**
 * Compare a captured version with `minimum`. A failed probe becomes a required failure.
 * The displayed version has any `-suffix` removed.
 */
function versionCheck(name: string, captured: Captured, minimum: string): Check {
  if (captured.code !== 0) {
    return { kind: 'bad', name, detail: `could not read the version (exit ${captured.code})` };
  }
  /** Version number, without a newline or pre-release suffix. */
  const have = plainVersion(captured.stdout);
  if (compareVersions(have, minimum) < 0) {
    return { kind: 'bad', name, detail: `${have} is older than ${minimum}` };
  }
  return { kind: 'ok', name, detail: have };
}

/**
 * Advisory version probe. A missing tool is a warning.
 * When `expected` is set, a different installed version is also a warning.
 */
async function toolVersion(
  ctx: CommandContext,
  name: string,
  cmd: string[],
  expected: string | null,
): Promise<Check> {
  /** Probe result. Status 127 means the executable is not on `PATH`. */
  const result = await ctx.runner.capture(cmd, { cwd: ctx.cwd });
  if (result.code !== 0) {
    return { kind: 'warn', name, detail: 'not found on PATH' };
  }
  /** First line of the version output. Bun prints the number alone. */
  const have = (result.stdout || result.stderr).trim().split(/\r?\n/)[0] ?? '';
  if (expected !== null && have !== expected) {
    return { kind: 'warn', name, detail: `${have} (pinned ${expected} in .bun-version)` };
  }
  return { kind: 'ok', name, detail: have };
}

/** Where the licensing package's `sdk-version` lives, relative to the quickstart root. */
const LICENSING_DIR = join('daml', 'licensing');

/**
 * Advisory Daml SDK check.
 * `dpm version --active` runs in `daml/licensing`, the package `pinnedSdk` reads.
 * A missing dpm binary is a warning. Any other dpm failure is a warning with dpm's own text.
 * An active SDK that is not installed, or that differs from `sdk-version`, is also a warning.
 * A manifest read error stays a warning so the rest of the checklist still prints.
 */
async function dpmSdkCheck(ctx: CommandContext, projectDir: string): Promise<Check> {
  /** dpm binary. `DPM_PATH` replaces the `PATH` lookup when it is set. */
  const bin = dpmExecutable(ctx.env);
  /** Licensing package. `dpm version --active` reads `sdk-version` from this directory. */
  const licensing = join(projectDir, LICENSING_DIR);
  /** Active SDK. Status 127 means the executable is not on `PATH`. */
  const result = await ctx.runner.capture([bin, 'version', '--active'], { cwd: licensing });
  if (result.code === 127) {
    return { kind: 'warn', name: 'Daml SDK', detail: 'not found on PATH' };
  }
  if (result.code !== 0) {
    return { kind: 'warn', name: 'Daml SDK', detail: activeSdkFailure(result) };
  }
  /** First line. `dpm version --active` prints the version alone, installed or not. */
  const have = (result.stdout || result.stderr).trim().split(/\r?\n/)[0] ?? '';
  if (have.length === 0) {
    return { kind: 'warn', name: 'Daml SDK', detail: 'could not read the version' };
  }
  /** Whether `dpm version -o json` marks this version installed. Null when the listing is unusable. */
  const installed = await sdkInstalled(ctx, bin, licensing, have);
  /** Pin from `daml.yaml`, or the warning text when that file cannot be read. */
  const pin = pinnedSdk(projectDir);
  if (installed === false) {
    return { kind: 'warn', name: 'Daml SDK', detail: notInstalledDetail(have, pin) };
  }
  if (!pin.ok) {
    return { kind: 'warn', name: 'Daml SDK', detail: `${have} (${pin.detail})` };
  }
  if (have !== pin.version) {
    return {
      kind: 'warn',
      name: 'Daml SDK',
      detail: `${have} (pinned ${pin.version} in daml/licensing/daml.yaml)`,
    };
  }
  return { kind: 'ok', name: 'Daml SDK', detail: have };
}

/** `sdk-version` from the licensing manifest, or a warning detail when it cannot be read. */
type PinnedSdk = { ok: true; version: string } | { ok: false; detail: string };

/**
 * `sdk-version` from `daml/licensing/daml.yaml`.
 * A missing file, a missing key, or any other read error is a detail string.
 * Nothing is rethrown, so one bad manifest does not drop the rest of the checklist.
 */
function pinnedSdk(projectDir: string): PinnedSdk {
  try {
    return { ok: true, version: damlSdkVersion(projectDir) };
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === 'sdk-version not found in daml/licensing/daml.yaml'
    ) {
      return { ok: false, detail: 'sdk-version not found in daml/licensing/daml.yaml' };
    }
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return { ok: false, detail: 'sdk-version not found in daml/licensing/daml.yaml' };
    }
    /** `code` from a Node `fs` error, such as `EACCES`. Empty for any other throw. */
    const code =
      error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : '';
    return {
      ok: false,
      detail:
        code.length > 0
          ? `could not read daml/licensing/daml.yaml (${code})`
          : 'could not read daml/licensing/daml.yaml',
    };
  }
}

/**
 * First error line from a failed `dpm version --active`.
 * Drops a leading `Error:` so the checklist shows dpm's reason, not "not found on PATH".
 */
function activeSdkFailure(result: Captured): string {
  /** stderr first. A usage dump on stdout is not the reason. */
  const line = (result.stderr || result.stdout).trim().split(/\r?\n/)[0] ?? '';
  /** Reason without the `Error:` prefix dpm prints. */
  const text = line.replace(/^Error:\s*/, '');
  if (text.length === 0) return `could not read the active SDK (exit ${result.code})`;
  return text;
}

/**
 * True when `dpm version -o json` marks `version` active and installed.
 * False when that row is active and not installed. Null when the listing cannot be read.
 * `dpm version --active` prints the pin even when that SDK is not installed.
 */
async function sdkInstalled(
  ctx: CommandContext,
  bin: string,
  licensing: string,
  version: string,
): Promise<boolean | null> {
  /** Version table, including an `installed` flag the `--active` line does not print. */
  const listed = await ctx.runner.capture([bin, 'version', '-o', 'json'], { cwd: licensing });
  if (listed.code !== 0) return null;
  return installedFlag(listed.stdout, version);
}

/** One row of `dpm version -o json`. */
type SdkRow = { version: string; installed?: boolean; active?: boolean };

/**
 * Whether `value` is an SDK row. The `installed` and `active` flags are optional.
 */
function isSdkRow(value: unknown): value is SdkRow {
  if (value === null || typeof value !== 'object') return false;
  return 'version' in value && typeof value.version === 'string';
}

/**
 * Installation flag for the active row whose version is `version`.
 * Returns null when the JSON is not a list or has no matching active row.
 */
function installedFlag(json: string, version: string): boolean | null {
  try {
    /** Parsed listing. Anything other than an array is ignored. */
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return null;
    /** Active row for this version. A missing `installed` flag means it is not installed. */
    const row = parsed.find(
      (item) => isSdkRow(item) && item.version === version && item.active === true,
    );
    if (!isSdkRow(row)) return null;
    return row.installed === true;
  } catch {
    return null;
  }
}

/**
 * Warning text when the active SDK is not installed.
 * A different pin, or a manifest that could not be read, is appended.
 */
function notInstalledDetail(have: string, pin: PinnedSdk): string {
  if (!pin.ok) return `${have} is not installed (${pin.detail})`;
  if (have !== pin.version) {
    return `${have} is not installed (pinned ${pin.version} in daml/licensing/daml.yaml)`;
  }
  return `${have} is not installed`;
}

/**
 * Advisory dpm CLI check.
 * `dpm --version` prints the CLI, a different number from the Daml SDK.
 */
async function dpmCliCheck(ctx: CommandContext): Promise<Check> {
  /** dpm binary. `DPM_PATH` replaces the `PATH` lookup when it is set. */
  const bin = dpmExecutable(ctx.env);
  /** CLI version. A non-zero status means dpm did not answer, including when it is missing. */
  const result = await ctx.runner.capture([bin, '--version'], { cwd: ctx.cwd });
  if (result.code !== 0) {
    return { kind: 'warn', name: 'dpm CLI', detail: 'not found on PATH' };
  }
  /** Version number, without the `version:` prefix `dpm --version` prints. */
  const have = dpmCliVersion(`${result.stdout}\n${result.stderr}`);
  if (have.length === 0) {
    return { kind: 'warn', name: 'dpm CLI', detail: 'could not read the version' };
  }
  return { kind: 'ok', name: 'dpm CLI', detail: have };
}

/**
 * CLI version from `dpm --version`.
 * The first line is `version:` followed by the number. A line without that prefix is unchanged.
 */
function dpmCliVersion(text: string): string {
  /** First line. Later lines are the build id and the build date. */
  const line = text.trim().split(/\r?\n/)[0] ?? '';
  /** Number after `version:`. Absent when the line is already just the number. */
  const match = /^version:\s*(\S+)/.exec(line);
  return match?.[1] ?? line;
}

/**
 * Advisory JDK check. Gradle 8.8 is supported on 21 and 22.
 * Anything else, including a missing JDK, is a warning.
 */
async function javaCheck(ctx: CommandContext): Promise<Check> {
  /** `java -version` writes to stderr and usually exits 0. */
  const result = await ctx.runner.capture(['java', '-version'], { cwd: ctx.cwd });
  if (result.code !== 0) return { kind: 'warn', name: 'JDK', detail: 'not found on PATH' };
  /** Major version, or null when the banner was not recognised. */
  const major = javaMajor(`${result.stderr}\n${result.stdout}`);
  if (major === null) return { kind: 'warn', name: 'JDK', detail: 'could not read the version' };
  if (major < 21 || major > 22) {
    return {
      kind: 'warn',
      name: 'JDK',
      detail: `${major} is outside 21–22, which Gradle 8.8 supports`,
    };
  }
  return { kind: 'ok', name: 'JDK', detail: String(major) };
}

/**
 * Register `qs doctor`.
 * The checks run against the real tools, including under `--dry-run`.
 */
export function registerDoctor(program: Command, deps: CommandDeps): void {
  deps
    .addSharedOptions(program.command('doctor'))
    .description('Check Docker, Compose, and the local tools')
    .action(async (_local: unknown, command: Command) => {
      await deps.run(command, runDoctor);
    });
}

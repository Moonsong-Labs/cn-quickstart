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
import { dpmExecutable } from '../lib/dpm.ts';
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
  checks.push(await toolVersion(ctx, 'dpm', [dpmExecutable(ctx.env), '--version'], null));
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

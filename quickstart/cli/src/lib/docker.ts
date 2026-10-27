// Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: 0BSD

import type { CommandContext } from './context.ts';
import type { Captured } from './exec.ts';
import { bad } from './style.ts';

/** Minimum Docker client version. Older clients are rejected by `doctor`. */
export const MIN_DOCKER = '27.0.0';

/** Minimum Docker Compose version. */
export const MIN_COMPOSE = '2.27.0';

/**
 * Compare two dotted versions. A `-suffix` is ignored, and a missing part counts as 0.
 * Returns a negative number when `left` is older, 0 when they are equal, and positive when `left` is newer.
 */
export function compareVersions(left: string, right: string): number {
  /** Numeric parts of one version, with any pre-release suffix removed. */
  const parts = (value: string) =>
    value
      .split('-')[0]
      .split('.')
      .map((part) => Number.parseInt(part, 10) || 0);
  /** Parts of each side, compared from the left. */
  const a = parts(left);
  const b = parts(right);
  /** How many parts to compare. The shorter side is padded with zeros. */
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const da = a[index] ?? 0;
    const db = b[index] ?? 0;
    if (da !== db) return da < db ? -1 : 1;
  }
  return 0;
}

/** Version string with a trailing newline and any `-suffix` removed. */
export function plainVersion(raw: string): string {
  return raw.trim().split('-')[0] ?? '';
}

/** What `docker info` showed. `detail` is the checklist line `doctor` and `ensureDocker` both use. */
export type DockerStatus = { ok: true } | { ok: false; detail: string };

/** Checklist text when the `docker` executable is missing. */
const DOCKER_CLI_MISSING = 'CLI not found. See https://docs.docker.com/engine/install/';

/** Checklist text when the CLI exists and the daemon does not answer. */
const DOCKER_DAEMON_STOPPED =
  'daemon is not running. See https://docs.docker.com/engine/daemon/start/';

/**
 * Ask `docker info` whether the CLI and the daemon are available.
 * Does not print. Callers that want to skip the check, such as `--dry-run`, do so themselves.
 */
export async function dockerStatus(ctx: CommandContext): Promise<DockerStatus> {
  /** Result of `docker info`, or status 127 when the CLI is not installed. */
  const result = await ctx.runner.capture(['docker', 'info'], { cwd: ctx.cwd });
  if (result.code === 0) return { ok: true };
  if (result.code === 127) return { ok: false, detail: DOCKER_CLI_MISSING };
  return { ok: false, detail: DOCKER_DAEMON_STOPPED };
}

/**
 * Check that the Docker CLI exists and the daemon answers `docker info`.
 * Returns 0 when it does. `--dry-run` skips the check and returns 0.
 * A failure prints the same sentence `doctor` puts in its checklist.
 */
export async function ensureDocker(ctx: CommandContext): Promise<number> {
  if (ctx.dryRun) return 0;
  /** Shared Docker result. Printed here and recorded as a checklist line by `doctor`. */
  const status = await dockerStatus(ctx);
  if (status.ok) return 0;
  ctx.io.note(`${bad(`✗ Docker: ${status.detail}`)}\n`);
  return 1;
}

/**
 * Read the Docker and Compose versions.
 * Each call uses `capture`, so a dry run still reports the real versions.
 */
export async function dockerVersions(
  ctx: CommandContext,
): Promise<{ docker: Captured; compose: Captured }> {
  /** Docker client version, from the Go template the Makefile uses. */
  const docker = await ctx.runner.capture(
    ['docker', 'version', '--format', '{{.Client.Version}}'],
    { cwd: ctx.cwd },
  );
  /** Compose version. `--short` prints the number only. */
  const compose = await ctx.runner.capture(['docker', 'compose', 'version', '--short'], {
    cwd: ctx.cwd,
  });
  return { docker, compose };
}

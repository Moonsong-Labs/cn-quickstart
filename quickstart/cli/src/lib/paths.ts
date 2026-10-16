// Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: 0BSD

import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/**
 * True when `dir` is a quickstart project: both `.env` and `docker/modules` exist.
 * Either marker alone is not enough, so a repository checkout that only has one of them is rejected.
 */
export function isProjectRoot(dir: string): boolean {
  return existsSync(resolve(dir, '.env')) && existsSync(resolve(dir, 'docker', 'modules'));
}

/**
 * Walk from `start` towards the filesystem root and return the nearest directory
 * that passes `isProjectRoot`. Returns null at the root without throwing.
 */
export function findProjectRoot(start: string): string | null {
  /** Absolute directory currently being tested. Moves to its parent each miss. */
  let dir = resolve(start);
  for (;;) {
    if (isProjectRoot(dir)) return dir;
    /** Parent of `dir`. Equal to `dir` only at the filesystem root, which ends the walk. */
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Choose the quickstart directory for this invocation.
 * An override is resolved against `cwd` and must already be a project root, or this throws.
 * With no override, walk up from `cwd`, then from `cliDir`, so `bun run qs` works from the
 * repository root and `make setup` works from `quickstart/`. Throws when neither walk finds a project.
 */
export function resolveProjectRoot(cwd: string, cliDir: string, override?: string): string {
  if (override !== undefined) {
    /** `--project` resolved against the working directory, including relative paths. */
    const dir = resolve(cwd, override);
    if (!isProjectRoot(dir)) {
      throw new Error(`Not a quickstart project: ${dir}`);
    }
    return dir;
  }
  /** First match from the working directory, otherwise the first match from the CLI source tree. */
  const found = findProjectRoot(cwd) ?? findProjectRoot(cliDir);
  if (found === null) {
    throw new Error(
      'Could not find the quickstart directory (expected .env and docker/modules). Pass --project.',
    );
  }
  return found;
}

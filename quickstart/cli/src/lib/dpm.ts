// Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: 0BSD

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CommandContext } from './context.ts';
import { definedEnv, loggedRun } from './exec.ts';

/**
 * `sdk-version` from `daml/licensing/daml.yaml`.
 * Matches `VersionFiles.kt`: comments are stripped, and the first `sdk-version:` line wins.
 * Throws when the file or the key is missing.
 */
export function damlSdkVersion(projectDir: string): string {
  /** Path of the licensing package manifest. */
  const path = join(projectDir, 'daml', 'licensing', 'daml.yaml');
  /** Manifest text. A missing file throws from `readFileSync`. */
  const text = readFileSync(path, 'utf8');
  for (const raw of text.split(/\r?\n/)) {
    /** Line with an inline comment removed. */
    const line = raw.split('#')[0]?.trim() ?? '';
    if (line.startsWith('sdk-version:')) return line.slice('sdk-version:'.length).trim();
  }
  throw new Error('sdk-version not found in daml/licensing/daml.yaml');
}

/**
 * `dpm` executable for this environment.
 * `DPM_PATH`, when set and non-empty, replaces the `PATH` lookup. Otherwise the command is `dpm`.
 */
export function dpmExecutable(env: Record<string, string | undefined>): string {
  /** Injected component path. An empty value falls through to `PATH`. */
  const configured = env.DPM_PATH;
  return configured !== undefined && configured.length > 0 ? configured : 'dpm';
}

/**
 * Build every Daml package with `dpm build --all`.
 * Runs in `daml/` and sets `DPM_SDK_VERSION` from `damlSdkVersion`.
 */
export async function dpmBuild(ctx: CommandContext, projectDir: string): Promise<number> {
  /** SDK version the packages were written for. */
  const version = damlSdkVersion(projectDir);
  return loggedRun(ctx.io, ctx.runner, [dpmExecutable(ctx.env), 'build', '--all'], {
    cwd: join(projectDir, 'daml'),
    env: { ...definedEnv(ctx.env), DPM_SDK_VERSION: version },
  });
}

/**
 * Run the licensing tests with `dpm test --package-root licensing-tests`.
 * Runs in `daml/` and sets `DPM_SDK_VERSION` from `damlSdkVersion`, as the Gradle task did.
 */
export async function dpmTest(ctx: CommandContext, projectDir: string): Promise<number> {
  /** SDK version the tests were written for. */
  const version = damlSdkVersion(projectDir);
  return loggedRun(
    ctx.io,
    ctx.runner,
    [dpmExecutable(ctx.env), 'test', '--package-root', 'licensing-tests'],
    {
      cwd: join(projectDir, 'daml'),
      env: { ...definedEnv(ctx.env), DPM_SDK_VERSION: version },
    },
  );
}

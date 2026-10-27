// Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: 0BSD

import type { PromptIo } from './prompts.ts';
import { paint } from './style.ts';

/** Where a child process runs, and the environment it inherits. */
export type SpawnOptions = {
  /** Working directory. Relative paths in the command are resolved from here. */
  cwd: string;
  /** Environment for the child. Undefined values are dropped by the caller. */
  env?: Record<string, string>;
};

/** Text captured from a child that was not attached to the terminal. */
export type Captured = {
  /** Exit status. 127 means the executable could not be found. */
  code: number;
  /** Decoded standard output. Empty when the process wrote nothing. */
  stdout: string;
  /** Decoded standard error. `java -version` writes its version here. */
  stderr: string;
};

/**
 * Runs host commands. Tests replace it. `--dry-run` replaces `run` only,
 * so read-only probes such as `docker version` still execute.
 */
export type Runner = {
  /**
   * Run `cmd` with the terminal attached. Resolves to the child status.
   * A signal that kills the child with no status becomes 130.
   */
  run(cmd: string[], opts: SpawnOptions): Promise<number>;
  /** Run `cmd` and collect both streams. Does not attach them to the terminal. */
  capture(cmd: string[], opts: SpawnOptions): Promise<Captured>;
};

/** Characters that need quoting before a command is shown in a shell. */
const SHELL_META = /[\s'"$`|&;<>(){}[\]!*?\\]/;

/**
 * Join `cmd` as one shell-safe line.
 * Arguments with spaces or shell metacharacters are wrapped in single quotes.
 */
export function formatCommand(cmd: readonly string[]): string {
  return cmd
    .map((arg) => (SHELL_META.test(arg) ? `'${arg.replaceAll("'", "'\\''")}'` : arg))
    .join(' ');
}

/**
 * Copy `env`, dropping undefined values, so it can be passed to `Bun.spawn`.
 * Keys set to undefined are removed rather than passed as the string "undefined".
 */
export function definedEnv(env: Record<string, string | undefined>): Record<string, string> {
  /** Child environment. Only keys with a string value are copied. */
  const copy: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) copy[key] = value;
  }
  return copy;
}

/** True when `error` is a missing executable rather than a crash inside it. */
function isMissingExecutable(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

/**
 * Spawn `cmd`. `pipe` collects the streams; otherwise they are the terminal's.
 * ENOENT becomes status 127 so callers can report a missing tool.
 */
async function spawn(
  cmd: string[],
  opts: SpawnOptions,
  pipe: boolean,
): Promise<Captured & { code: number }> {
  try {
    /** Child process. SIGINT is ignored in this process so the child receives it. */
    const child = Bun.spawn({
      cmd,
      cwd: opts.cwd,
      env: opts.env,
      stdin: pipe ? 'ignore' : 'inherit',
      stdout: pipe ? 'pipe' : 'inherit',
      stderr: pipe ? 'pipe' : 'inherit',
    });
    /** Swallow SIGINT here. The terminal still delivers it to the child. */
    const ignore = () => {};
    process.on('SIGINT', ignore);
    try {
      if (!pipe) {
        /** Status from an attached child. Null means a signal stopped it. */
        const status = await child.exited;
        return { code: status ?? 130, stdout: '', stderr: '' };
      }
      /** Collected streams and status. Read in parallel so a full pipe cannot stall the child. */
      const [stdout, stderr, status] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      return { code: status ?? 130, stdout, stderr };
    } finally {
      process.off('SIGINT', ignore);
    }
  } catch (error) {
    if (isMissingExecutable(error)) return { code: 127, stdout: '', stderr: '' };
    throw error;
  }
}

/** Runner that executes commands. `run` inherits the terminal. `capture` collects both streams. */
export function realRunner(): Runner {
  return {
    run(cmd, opts) {
      return spawn(cmd, opts, false).then((result) => result.code);
    },
    capture(cmd, opts) {
      return spawn(cmd, opts, true);
    },
  };
}

/**
 * Runner used for `--dry-run`. `run` prints nothing and does not spawn.
 * `capture` still uses `real`, so version probes keep working.
 * The caller prints the command it would have run.
 */
export function dryRunRunner(real: Runner): Runner {
  return {
    run() {
      return Promise.resolve(0);
    },
    capture(cmd, opts) {
      return real.capture(cmd, opts);
    },
  };
}

/**
 * Choose the runner for this invocation.
 * An injected runner wins, including under `--dry-run`, so tests stay in control.
 */
export function selectRunner(dryRun: boolean, injected?: Runner): Runner {
  if (injected) return injected;
  /** Live runner. Reused as the capture half of a dry run. */
  const real = realRunner();
  return dryRun ? dryRunRunner(real) : real;
}

/**
 * Print `cmd` in dim text, then run it.
 * Dry-run prints the same line and the runner returns without spawning.
 */
export async function loggedRun(
  io: PromptIo,
  runner: Runner,
  cmd: string[],
  opts: SpawnOptions,
): Promise<number> {
  io.note(`${paint('dim', `$ ${formatCommand(cmd)}`)}\n`);
  return runner.run(cmd, opts);
}

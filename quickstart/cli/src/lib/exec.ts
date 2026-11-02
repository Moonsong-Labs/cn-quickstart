// Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: 0BSD

import { closeSync, openSync } from 'node:fs';
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

/** A child that keeps running after `background` returns. `stop` kills it. */
export type BackgroundChild = {
  /** Kill the child. A second call does nothing harmful. */
  stop(): void;
  /** Status once the child exits. 130 when a signal stopped it. */
  exited: Promise<number>;
};

/** Where a background child appends its combined output. */
export type BackgroundOptions = SpawnOptions & {
  /** File opened in append mode for both stdout and stderr. Created if missing. */
  output: string;
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
  /** Stream stdout one line at a time. The child is killed when iteration stops. */
  lines(cmd: string[], opts: SpawnOptions): AsyncIterable<string>;
  /** Start `cmd` and append both streams to `opts.output`. Does not wait for it. */
  background(cmd: string[], opts: BackgroundOptions): BackgroundChild;
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

/**
 * Yield stdout of `cmd` one line at a time, without the line ending.
 * Stderr stays on the terminal. The child is killed when the caller stops reading.
 */
async function* readLines(cmd: string[], opts: SpawnOptions): AsyncIterable<string> {
  /** Events child. Stdout is collected a chunk at a time so a long line cannot be split wrongly. */
  const child = Bun.spawn({
    cmd,
    cwd: opts.cwd,
    env: opts.env,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'inherit',
  });
  /** Piped stdout. Null only when stdout was not piped, which this spawn never does. */
  const stdout = child.stdout;
  if (stdout === null) {
    child.kill();
    return;
  }
  /** Chunk reader. Released in `finally` so a thrown error does not leak the stream. */
  const reader = stdout.getReader();
  /** Decoder that keeps a trailing partial code point for the next chunk. */
  const decoder = new TextDecoder();
  /** Text after the last yielded newline. */
  let pending = '';
  try {
    while (true) {
      /** Next chunk. `done` means the child closed stdout. */
      const chunk = await reader.read();
      if (chunk.done) break;
      pending += decoder.decode(chunk.value, { stream: true });
      /** Index of the next newline, or -1 when the chunk ends mid-line. */
      let newline = pending.indexOf('\n');
      while (newline !== -1) {
        yield pending.slice(0, newline).replace(/\r$/, '');
        pending = pending.slice(newline + 1);
        newline = pending.indexOf('\n');
      }
    }
    pending += decoder.decode();
    if (pending.length > 0) yield pending.replace(/\r$/, '');
  } finally {
    reader.releaseLock();
    child.kill();
    await child.exited;
  }
}

/**
 * Start `cmd` with both streams appended to `opts.output`.
 * The file descriptor stays open until the child exits.
 */
function spawnBackground(cmd: string[], opts: BackgroundOptions): BackgroundChild {
  /** Append descriptor shared by both streams, matching `>> file 2>&1`. */
  const output = openSync(opts.output, 'a');
  /** Detached from the terminal. Killing it is `stop`. */
  const child = Bun.spawn({
    cmd,
    cwd: opts.cwd,
    env: opts.env,
    stdin: 'ignore',
    stdout: output,
    stderr: output,
  });
  return {
    stop() {
      child.kill();
    },
    exited: child.exited.then((code) => code ?? 130).finally(() => closeSync(output)),
  };
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
    lines(cmd, opts) {
      return readLines(cmd, opts);
    },
    background(cmd, opts) {
      return spawnBackground(cmd, opts);
    },
  };
}

/**
 * Runner used for `--dry-run`. `run`, `lines`, and `background` do not spawn.
 * `capture` still uses `real`, so version probes keep working.
 * The caller prints the command it would have run.
 */
export function dryRunRunner(real: Pick<Runner, 'capture'>): Runner {
  return {
    run() {
      return Promise.resolve(0);
    },
    capture(cmd, opts) {
      return real.capture(cmd, opts);
    },
    lines() {
      return (async function* empty() {})();
    },
    background() {
      return { stop() {}, exited: Promise.resolve(0) };
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

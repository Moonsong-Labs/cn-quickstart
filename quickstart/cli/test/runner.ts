// Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: 0BSD

import type { Runner } from '../src/lib/exec.ts';

/** A background child that has already finished. `stop` does nothing. */
function finishedChild(): ReturnType<Runner['background']> {
  return { stop() {}, exited: Promise.resolve(0) };
}

/** One recorded spawn, in the order the command issued it. */
export type Call = {
  /** Executable and arguments. */
  cmd: string[];
  /** Working directory the command requested. */
  cwd: string;
  /** Environment the command requested, when the caller passed one. */
  env?: Record<string, string>;
};

/** A scripted `capture` result. Omitted fields are an empty string or status 0. */
type Scripted = {
  /** Exit status. Defaults to 0. */
  code?: number;
  /** Standard output. */
  stdout?: string;
  /** Standard error. */
  stderr?: string;
};

/**
 * A runner that records every call and never spawns.
 * `capture` replies come from `script` in order. Further captures succeed with empty output.
 * `run` always returns 0, so a lifecycle test can assert the command list of a successful path.
 */
export function fakeRunner(
  script: readonly Scripted[] = [],
  events: readonly string[] = [],
): {
  runner: Runner;
  /** Every `run`, `capture`, `lines`, and `background`, in call order. */
  calls: Call[];
} {
  /** Recorded calls. */
  const calls: Call[] = [];
  /** Next scripted capture. `run` does not consume these. */
  let captureAt = 0;
  return {
    calls,
    runner: {
      run(cmd, opts) {
        calls.push({ cmd, cwd: opts.cwd, ...(opts.env !== undefined ? { env: opts.env } : {}) });
        return Promise.resolve(0);
      },
      capture(cmd, opts) {
        calls.push({ cmd, cwd: opts.cwd, ...(opts.env !== undefined ? { env: opts.env } : {}) });
        /** Reply for this capture, or an empty success when the script has run out. */
        const next = script[captureAt] ?? {};
        captureAt += 1;
        return Promise.resolve({
          code: next.code ?? 0,
          stdout: next.stdout ?? '',
          stderr: next.stderr ?? '',
        });
      },
      lines(cmd, opts) {
        calls.push({ cmd, cwd: opts.cwd, ...(opts.env !== undefined ? { env: opts.env } : {}) });
        return (async function* scripted() {
          for (const line of events) yield line;
        })();
      },
      background(cmd, opts) {
        calls.push({ cmd, cwd: opts.cwd, ...(opts.env !== undefined ? { env: opts.env } : {}) });
        return finishedChild();
      },
    },
  };
}

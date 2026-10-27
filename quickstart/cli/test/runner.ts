// Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: 0BSD

import type { Runner } from '../src/lib/exec.ts';

/** One recorded spawn, in the order the command issued it. */
export type Call = {
  /** Executable and arguments. */
  cmd: string[];
  /** Working directory the command requested. */
  cwd: string;
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
export function fakeRunner(script: readonly Scripted[] = []): {
  runner: Runner;
  /** Every `run` and `capture`, in call order. */
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
        calls.push({ cmd, cwd: opts.cwd });
        return Promise.resolve(0);
      },
      capture(cmd, opts) {
        calls.push({ cmd, cwd: opts.cwd });
        /** Reply for this capture, or an empty success when the script has run out. */
        const next = script[captureAt] ?? {};
        captureAt += 1;
        return Promise.resolve({
          code: next.code ?? 0,
          stdout: next.stdout ?? '',
          stderr: next.stderr ?? '',
        });
      },
    },
  };
}

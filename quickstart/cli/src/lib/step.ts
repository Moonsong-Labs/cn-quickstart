// Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: 0BSD

import type { PromptIo } from './prompts.ts';
import { bad, ok, paint } from './style.ts';

/**
 * Format a duration for a finished step.
 * Under a minute is shown in seconds with one decimal. Longer runs use minutes and seconds.
 */
export function formatDuration(ms: number): string {
  /** Whole seconds, used once the run lasts at least a minute. */
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)} s`;
  /** Whole minutes, with the leftover seconds rounded. */
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes}m ${rest}s`;
}

/**
 * Print a heading, run `action`, then print how long it took.
 * A non-zero status prints a failure line and is returned unchanged.
 * Both lines go through `note`, so they stay off stdout.
 */
export async function step(
  io: PromptIo,
  doing: string,
  done: string,
  action: () => Promise<number>,
): Promise<number> {
  io.note(`${paint(['bold', 'cyan'], '▸')} ${doing}\n`);
  /** When the step started. The duration includes the child process. */
  const started = Date.now();
  /** Status from the step. Zero continues the command. */
  const status = await action();
  /** Elapsed time, formatted after the step so a failure can show it too. */
  const elapsed = formatDuration(Date.now() - started);
  if (status !== 0) {
    io.note(`${bad(`✗ ${doing} failed (exit ${status})`)}\n`);
    return status;
  }
  io.note(`${ok(`${done} (${elapsed})`)}\n`);
  return 0;
}

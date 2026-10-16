// Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: 0BSD

import type { PromptIo } from '../src/lib/prompts.ts';

/**
 * Build a `PromptIo` that answers from `lines` in order and records every `write`.
 * After the last line, `readLine` returns null, which prompts treat as end of input.
 */
export function scriptedIo(lines: readonly string[]): {
  io: PromptIo;
  /** Everything written so far, in order, with no extra separators. */
  output(): string;
} {
  /** Remaining answers. Each `readLine` removes one. */
  const queue = [...lines];
  /** Concatenation of every `write` call. */
  let written = '';
  return {
    /** Snapshot of `written`. Later writes are not included until the next call. */
    output: () => written,
    io: {
      /** Append `text` exactly, including newlines the caller already included. */
      write(text: string) {
        written += text;
      },
      /** Next scripted line, or null when the script has been consumed. */
      readLine() {
        if (queue.length === 0) return Promise.resolve(null);
        return Promise.resolve(queue.shift() ?? '');
      },
    },
  };
}

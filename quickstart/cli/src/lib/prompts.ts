// Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: 0BSD

import { createInterface } from 'node:readline';
import { askMark, bad, paint, warn } from './style.ts';

/**
 * Terminal used by prompts. Tests supply a scripted implementation; the real process uses stdin and stdout.
 */
export type PromptIo = {
  /** Write prompt text exactly. Does not add a newline of its own. */
  write(text: string): void;
  /**
   * Progress and check results. The real terminal writes these to stderr,
   * so a command's stdout stays usable in a pipe.
   */
  note(text: string): void;
  /**
   * Next answer without its line terminator.
   * Null means end of input. Callers abort on null instead of asking again.
   */
  readLine(): Promise<string | null>;
};

/**
 * Thrown when a prompt needs another answer and `readLine` returns null.
 * Stops the CLI instead of looping, which the old Gradle task did on EOF.
 */
export class EndOfInputError extends Error {
  /** Sets a stable name and the message written by the CLI on exit 1. */
  constructor() {
    super('End of input while reading an answer.');
    this.name = 'EndOfInputError';
  }
}

/**
 * Move to the next line after an answer when stdin is not a terminal.
 * A terminal already does this when the user presses enter. A pipe does not,
 * so the next line would continue on the end of the prompt.
 */
function finishAnswer(io: PromptIo) {
  if (process.stdin.isTTY !== true) io.write('\n');
}

/** Lower-cased tokens that mean yes. Comparison happens after trim. Empty input is not in this set. */
const YES = new Set(['y', 'yes', 'true', 't', '1']);

/** Lower-cased tokens that mean no. Anything outside `YES` and `NO` is rejected and re-asked. */
const NO = new Set(['n', 'no', 'false', 'f', '0']);

/**
 * Ask a yes/no question until the answer is recognised.
 * Empty input returns `defaultYes`. The prompt shows `Y/n` when the default is yes and `y/N` when it is no.
 * Unrecognised input prints `Enter yes or no.` and asks again. End of input throws `EndOfInputError`.
 */
export async function askYesNo(
  io: PromptIo,
  prompt: string,
  defaultYes: boolean,
): Promise<boolean> {
  /** Hint printed in parentheses. The capital letter is the default. */
  const optionsText = defaultYes ? 'Y/n' : 'y/N';
  for (;;) {
    io.write(`${askMark()} ${prompt} ${paint('dim', `(${optionsText})`)} `);
    /** Raw answer, or null when the input stream has closed. */
    const input = await io.readLine();
    finishAnswer(io);
    if (input === null) throw new EndOfInputError();
    /** Answer with surrounding whitespace removed. Empty takes the default. */
    const trimmed = input.trim();
    if (trimmed.length === 0) return defaultYes;
    /** Case-folded answer, matched against `YES` and `NO`. */
    const answer = trimmed.toLowerCase();
    if (YES.has(answer)) return true;
    if (NO.has(answer)) return false;
    io.write(`${bad('Enter yes or no.')}\n`);
  }
}

/**
 * Ask for a free-text value until `validate` accepts it.
 * A non-empty `defaultValue` is shown in brackets and used when the answer is empty.
 * An empty answer with no default prints `emptyMessage` and asks again.
 * `validate` returns an error string to print, or null to accept the candidate.
 * End of input throws `EndOfInputError`.
 */
export async function askText(
  io: PromptIo,
  prompt: string,
  options: {
    /** Value used for an empty answer. An empty string means there is no default. */
    defaultValue: string;
    /** Printed when the answer and the default are both empty. */
    emptyMessage: string;
    /** Null accepts the candidate. A string is printed and the question is asked again. */
    validate: (value: string) => string | null;
  },
): Promise<string> {
  /** Prompt text, with `[default]` appended only when a default exists. */
  const shown = options.defaultValue.length > 0 ? `${prompt} [${options.defaultValue}]` : prompt;
  for (;;) {
    io.write(`${askMark()} ${shown} `);
    /** Raw answer, or null when the input stream has closed. */
    const input = await io.readLine();
    finishAnswer(io);
    if (input === null) throw new EndOfInputError();
    /** Answer with surrounding whitespace removed. */
    const trimmed = input.trim();
    /** Trimmed answer, or the default when the user pressed enter. */
    const candidate = trimmed.length === 0 ? options.defaultValue : trimmed;
    if (candidate.length === 0) {
      io.write(`${warn(options.emptyMessage)}\n`);
      continue;
    }
    /** Validation failure to print, or null when `candidate` is acceptable. */
    const error = options.validate(candidate);
    if (error !== null) {
      io.write(`${bad(error)}\n`);
      continue;
    }
    return candidate;
  }
}

/**
 * Read answers from the process terminal. `close` must be called so stdin does not keep the process alive.
 * Lines are queued by a listener that stays attached for the whole session. Subscribing once per question
 * drops lines that readline has already buffered from a pipe.
 */
export function createStdioPrompt(): PromptIo & { close(): void } {
  /** Line reader over stdin. It also owns the close event used as end of input. */
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  /** Lines already received, including a trailing null once the stream has closed. */
  const queued: Array<string | null> = [];
  /** Resolvers for `readLine` calls that arrived before the next line. */
  const waiting: Array<(line: string | null) => void> = [];
  /** True after the close event. Further closes do not enqueue another null. */
  let closed = false;

  /**
   * Deliver one line to the oldest waiter, or store it until somebody asks.
   * A null line means end of input.
   */
  const push = (line: string | null) => {
    /** Waiter to wake, if a `readLine` call is already pending. */
    const resolve = waiting.shift();
    if (resolve) resolve(line);
    else queued.push(line);
  };

  rl.on('line', push);
  rl.on('close', () => {
    if (closed) return;
    closed = true;
    push(null);
  });

  return {
    /** Write prompt text to stdout without going through readline, so prompts are not echoed twice. */
    write(text: string) {
      process.stdout.write(text);
    },
    /** Progress, warnings, and check results. Kept off stdout so pipes stay clean. */
    note(text: string) {
      process.stderr.write(text);
    },
    /**
     * Return the next queued line. After close, further calls resolve to null
     * instead of waiting forever.
     */
    readLine() {
      /** Next buffered line, or null if the buffer's next item is end of input. */
      const next = queued.shift();
      if (next !== undefined) return Promise.resolve(next);
      if (closed) return Promise.resolve(null);
      return new Promise((resolve) => {
        waiting.push(resolve);
      });
    },
    /** Close stdin so the process can exit after the command finishes. */
    close() {
      rl.close();
    },
  };
}

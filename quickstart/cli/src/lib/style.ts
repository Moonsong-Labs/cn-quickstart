// Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: 0BSD

import { styleText } from 'node:util';

/** A style, or a list of styles, accepted by `node:util` `styleText`. */
type Style = Parameters<typeof styleText>[0];

/**
 * True when stdout is a colour terminal.
 * A stream without `hasColors` is treated as capable once it is a TTY.
 */
function terminalSupportsColor(): boolean {
  const stdout = process.stdout;
  if (stdout.isTTY !== true) return false;
  const hasColors = (stdout as { hasColors?: () => boolean }).hasColors;
  if (typeof hasColors !== 'function') return true;
  return hasColors.call(stdout);
}

/**
 * True when messages should include colour.
 * Matches Commander's rules: `NO_COLOR`, `FORCE_COLOR=0`, and `FORCE_COLOR=false` turn colour off.
 * Any other `FORCE_COLOR`, or `CLICOLOR_FORCE`, turns it on. Otherwise the decision follows stdout.
 * Read on every call, so changing the environment takes effect without restarting the process.
 */
export function colorsEnabled(): boolean {
  if (
    process.env.NO_COLOR ||
    process.env.FORCE_COLOR === '0' ||
    process.env.FORCE_COLOR === 'false'
  ) {
    return false;
  }
  if (process.env.FORCE_COLOR || process.env.CLICOLOR_FORCE !== undefined) return true;
  return terminalSupportsColor();
}

/**
 * Colour `text` when `colorsEnabled` is true. Otherwise return `text` unchanged.
 * `validateStream` is off because `colorsEnabled` already made the decision.
 */
export function paint(style: Style, text: string): string {
  if (!colorsEnabled()) return text;
  return styleText(style, text, { validateStream: false });
}

/** Dim indented note. Does not add a newline. */
export function aside(text: string): string {
  return `  ${paint('dim', text)}`;
}

/** Cyan question mark that starts an interactive prompt. */
export function askMark(): string {
  return paint(['bold', 'cyan'], '?');
}

/** Green success text, including the tick. Does not add a newline. */
export function ok(text: string): string {
  return paint('green', `✓ ${text}`);
}

/** Yellow text. Does not add a newline. */
export function warn(text: string): string {
  return paint('yellow', text);
}

/** Red text. Does not add a newline. */
export function bad(text: string): string {
  return paint('red', text);
}

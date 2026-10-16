// Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: 0BSD

/**
 * Parse dotenv text the same way `VersionFiles.kt` does.
 * Blank lines and lines whose trimmed form starts with `#` are skipped.
 * Each remaining line is split on the first `=`; both sides are trimmed, so `A=b=c` keeps `b=c`.
 * Lines with no `=` are ignored. A later line for the same key replaces the earlier value.
 */
export function parseDotEnv(text: string): Map<string, string> {
  /** Keys in file order, with duplicates collapsed to the last value. */
  const values = new Map<string, string>();
  for (const raw of text.split(/\r?\n/)) {
    /** Trimmed line. Leading spaces do not stop a `#` from counting as a comment. */
    const line = raw.trim();
    if (line.length === 0 || line.startsWith('#')) continue;
    /** Index of the first `=`. Absence means the line is not an assignment. */
    const index = line.indexOf('=');
    if (index === -1) continue;
    /** Key with surrounding whitespace removed. An empty key is stored as-is. */
    const key = line.slice(0, index).trim();
    /** Value after the first `=`, trimmed. Quotes are kept as literal characters. */
    const value = line.slice(index + 1).trim();
    values.set(key, value);
  }
  return values;
}

/**
 * Replace `KEY=` lines in place and append any keys that were not already present, in entry order.
 * A line matches only when it starts with `KEY=` with no trim, so ` AUTH_MODE=` and `# AUTH_MODE=` stay untouched.
 * Every matching line is replaced, including duplicates. A single trailing newline is dropped so the
 * result has no trailing newline; a blank line in the middle is kept. CRLF input is rewritten with `\n`.
 */
export function upsertEnvFile(
  existing: string,
  entries: ReadonlyArray<readonly [string, string]>,
): string {
  /**
   * Existing lines, or an empty list for an empty file.
   * A terminating newline becomes one extra empty element and is removed below.
   */
  let lines = existing.length === 0 ? [] : existing.split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === '' && /\r?\n$/.test(existing)) {
    lines = lines.slice(0, -1);
  }

  /** Keys that already had at least one `KEY=` line, so they must not also be appended. */
  const found = new Set<string>();
  lines = lines.map((line) => {
    for (const [key, value] of entries) {
      if (line.startsWith(`${key}=`)) {
        found.add(key);
        return `${key}=${value}`;
      }
    }
    return line;
  });

  for (const [key, value] of entries) {
    if (!found.has(key)) lines.push(`${key}=${value}`);
  }
  return lines.join('\n');
}

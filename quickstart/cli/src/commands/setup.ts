// Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: 0BSD

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type Command, Option } from 'commander';
import { upsertEnvFile } from '../lib/env.ts';
import { askText, askYesNo, type PromptIo } from '../lib/prompts.ts';
import type { CommandDeps } from '../lib/register.ts';
import { aside, ok, paint, warn } from '../lib/style.ts';

/**
 * Party hint shape: an alphabetical organisation, an alphabetical function, and a numeric enumerator.
 * Digits, spaces, and extra hyphens fail the check.
 */
export const PARTY_HINT_PATTERN = /^[A-Za-z]+-[A-Za-z]+-\d+$/;

/** Question printed before the party hint. A default, when one exists, is added in brackets by `askText`. */
const PARTY_HINT_PROMPT = 'Party hint';

/** Printed when enter is pressed and no username-derived default exists. The question is asked again. */
const EMPTY_PARTY_HINT = 'No default is available. You must enter a valid party hint.';

/** Printed when a party hint fails `PARTY_HINT_PATTERN`. The two lines are one message. */
const INVALID_PARTY_HINT = [
  'Party hint must look like organisation-function-number.',
  'Both words are letters, and the last part is a number. Example: App-User-1.',
].join('\n');

/** Process environment viewed by party-hint defaulting. Missing keys are `undefined`, not empty. */
export type EnvVars = Record<string, string | undefined>;

/** Inputs for one setup run. Omitted mode flags mean "ask", unless `yes` accepts the default. */
export type SetupOptions = {
  /** Quickstart directory whose `.env.local` is read and, unless `dryRun`, replaced. */
  projectDir: string;
  /** Where prompts, confirmations, the caution, and the success line are written. */
  io: PromptIo;
  /** Source of `USER` and `USERNAME` for the party-hint default. */
  env: EnvVars;
  /** When true, print the new file text and do not create or modify `.env.local`. */
  dryRun: boolean;
  /** `oauth2` or `shared-secret`. When set, the OAuth question is skipped. */
  authMode?: string;
  /** Party hint. When set, the party-hint question is skipped after the pattern check. */
  partyHint?: string;
  /** `on` or `off`. When set, the test-mode question is skipped. */
  testMode?: string;
  /** Accept the default for every prompt that has no flag. Does not override a flag. */
  yes: boolean;
};

/**
 * Default party hint `quickstart-<letters>-1`.
 * Uses `USER`, then `USERNAME`. Characters other than letters are removed.
 * Returns an empty string when neither variable contains a letter, so the caller must not invent one.
 */
export function defaultPartyHint(env: EnvVars): string {
  /** Raw username. An unset variable is skipped; an empty string is not. */
  const raw = env.USER ?? env.USERNAME ?? '';
  /** Letters from `raw`. Digits and punctuation are dropped, not replaced. */
  const cleaned = raw.replace(/[^A-Za-z]/g, '');
  if (cleaned.length === 0) return '';
  return `quickstart-${cleaned}-1`;
}

/**
 * Null when `value` matches `PARTY_HINT_PATTERN`.
 * Otherwise the two-line invalid-hint message, which the caller prints or throws.
 */
export function partyHintError(value: string): string | null {
  if (PARTY_HINT_PATTERN.test(value)) return null;
  return INVALID_PARTY_HINT;
}

/**
 * Return `value` when it is `oauth2` or `shared-secret`.
 * Any other string throws before a prompt is shown.
 */
function requireAuthMode(value: string): 'oauth2' | 'shared-secret' {
  if (value === 'oauth2' || value === 'shared-secret') return value;
  throw new Error('--auth-mode must be oauth2 or shared-secret.');
}

/**
 * Return `value` when it is `on` or `off`.
 * Any other string throws before a prompt is shown.
 */
function requireTestMode(value: string): 'on' | 'off' {
  if (value === 'on' || value === 'off') return value;
  throw new Error('--test-mode must be on or off.');
}

/**
 * Heading and one line of context.
 * The interactive line mentions enter-to-accept. The other line is for flags and `--yes`, which ask nothing.
 */
function writeIntro(io: PromptIo, interactive: boolean) {
  io.write(`\n${paint('bold', 'Quickstart setup')}\n`);
  const detail = interactive
    ? 'Answers are written to .env.local. Press enter to keep a default.'
    : 'Writing AUTH_MODE, PARTY_HINT and TEST_MODE to .env.local.';
  io.write(`${aside(detail)}\n\n`);
}

/**
 * Colour a chosen value. The two usual defaults are green. The two cautionary choices are yellow.
 * Any other value, including a party hint, is bold.
 */
function paintValue(value: string): string {
  if (value === 'on' || value === 'shared-secret') return warn(value);
  if (value === 'off' || value === 'oauth2') return paint('green', value);
  return paint('bold', value);
}

/**
 * Print one accepted setting on its own line.
 * The name is padded so the values share a column. No trailing blank line; the caller adds a gap.
 */
function confirm(io: PromptIo, name: string, value: string) {
  io.write(`  ${paint('dim', name.padEnd(11))}${paintValue(value)}\n`);
}

/**
 * Warning printed only after `TEST_MODE` is set to `on`.
 * Built on each call so colour follows the environment at that moment.
 * It is not printed for `off`, and it is not written into `.env.local`.
 */
function testModeCaution(): string {
  return [
    warn('! Test mode is not for production.'),
    aside('The backend reads the party id from the token, so each test run'),
    aside('gets its own AppUser party.'),
  ].join('\n');
}

/**
 * Read `.env.local` as text. A missing file is an empty string, so the first run appends every key.
 * Any other read error is rethrown and nothing is written.
 */
async function readExisting(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return '';
    throw error;
  }
}

/**
 * Resolve auth mode, party hint, and test mode, then update `.env.local`.
 * Flags are validated before any question, so a bad flag prints nothing and writes nothing.
 * A flag skips its question. `--yes` fills the remaining questions with defaults: oauth2, the
 * derived party hint, and test mode off. `--yes` throws when there is no party-hint default.
 * Each accepted value is printed in a column. Test mode `on` then prints `testModeCaution`.
 * `--dry-run` prints a notice and the new file, and leaves the disk untouched.
 * A real run writes the file with no trailing newline and then prints the success line.
 */
export async function runSetup(options: SetupOptions): Promise<void> {
  /** Terminal for this run. Captured so later branches do not re-read `options`. */
  const { io } = options;
  if (options.authMode !== undefined) requireAuthMode(options.authMode);
  if (options.testMode !== undefined) requireTestMode(options.testMode);
  if (options.partyHint !== undefined) {
    /** Pattern failure for a flag. Thrown as the process error instead of being printed and re-asked. */
    const error = partyHintError(options.partyHint);
    if (error !== null) throw new Error(error);
  }

  /** True when this run still has to ask at least one question. Flags and `--yes` skip their prompts. */
  const interactive =
    (options.authMode === undefined && !options.yes) ||
    (options.partyHint === undefined && !options.yes) ||
    (options.testMode === undefined && !options.yes);
  writeIntro(io, interactive);

  /**
   * Auth mode written to `AUTH_MODE`.
   * Flag, then `--yes` (oauth2), then the prompt whose empty answer is also oauth2.
   */
  let authMode: 'oauth2' | 'shared-secret';
  if (options.authMode !== undefined) {
    authMode = requireAuthMode(options.authMode);
  } else if (options.yes) {
    authMode = 'oauth2';
  } else {
    io.write(`${aside('OAuth2 starts Keycloak. No uses a shared secret.')}\n`);
    authMode = (await askYesNo(io, 'Enable OAuth2', true)) ? 'oauth2' : 'shared-secret';
  }
  confirm(io, 'AUTH_MODE', authMode);
  if (interactive) io.write('\n');

  /** Username-derived hint, or empty when the environment has no letters to use. */
  const hintedDefault = defaultPartyHint(options.env);
  /** Party hint written to `PARTY_HINT`. A flag is already known to match the pattern. */
  let partyHint: string;
  if (options.partyHint !== undefined) {
    partyHint = options.partyHint;
  } else if (options.yes) {
    if (hintedDefault.length === 0) throw new Error(EMPTY_PARTY_HINT);
    partyHint = hintedDefault;
  } else {
    io.write(`${aside('This name is how the participant appears on the network.')}\n`);
    io.write(`${aside('Use organisation-function-number, such as App-User-1.')}\n`);
    partyHint = await askText(io, PARTY_HINT_PROMPT, {
      defaultValue: hintedDefault,
      emptyMessage: EMPTY_PARTY_HINT,
      validate: partyHintError,
    });
  }
  confirm(io, 'PARTY_HINT', partyHint);
  if (interactive) io.write('\n');

  /**
   * Test mode written to `TEST_MODE`.
   * Flag, then `--yes` (off), then the prompt whose empty answer is also off.
   */
  let testMode: 'on' | 'off';
  if (options.testMode !== undefined) {
    testMode = requireTestMode(options.testMode);
  } else if (options.yes) {
    testMode = 'off';
  } else {
    io.write(`${aside('Leave this off for a normal local network.')}\n`);
    testMode = (await askYesNo(io, 'Enable test mode', false)) ? 'on' : 'off';
  }
  confirm(io, 'TEST_MODE', testMode);
  io.write('\n');
  if (testMode === 'on') io.write(`${testModeCaution()}\n\n`);

  /** Absolute path of the env file in the quickstart directory. Not created until a real write. */
  const path = join(options.projectDir, '.env.local');
  /** Full file text after in-place replacement. Has no trailing newline. */
  const next = upsertEnvFile(await readExisting(path), [
    ['AUTH_MODE', authMode],
    ['PARTY_HINT', partyHint],
    ['TEST_MODE', testMode],
  ]);
  if (options.dryRun) {
    io.write(`${warn('Dry run. .env.local was not written.')}\n\n${next}\n`);
    return;
  }
  await writeFile(path, next);
  io.write(`${ok('Wrote .env.local')}\n`);
}

/**
 * Register `qs setup`.
 * Flags that are omitted are prompted for, unless `--yes` accepts the default.
 */
export function registerSetup(program: Command, deps: CommandDeps): void {
  deps
    .addSharedOptions(program.command('setup'))
    .description('Configure auth, party hint, and test mode')
    .addHelpText('after', () =>
      [
        '',
        aside('Writes AUTH_MODE, PARTY_HINT and TEST_MODE to .env.local.'),
        aside('Prompts for any value you do not pass as a flag.'),
      ].join('\n'),
    )
    .addOption(
      new Option('--auth-mode <mode>', 'oauth2, or shared-secret').choices([
        'oauth2',
        'shared-secret',
      ]),
    )
    .option('--party-hint <hint>', 'organisation-function-number')
    .addOption(new Option('--test-mode <mode>', 'on, or off').choices(['on', 'off']))
    .option('--yes', 'Accept the default for every prompt you omit')
    .action(async (_local: unknown, command: Command) => {
      await deps.executeSetup(command);
    });
}

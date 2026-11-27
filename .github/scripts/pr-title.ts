// Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: 0BSD

/**
 * Checks a pull request title against Conventional Commits:
 * `type(optional-scope)!: subject`.
 *
 * Run with the title in PR_TITLE. Prints a GitHub annotation and exits 1
 * when the title does not match. A gitmoji may begin the subject. It is
 * not required: REVIEW.md and the pull request template treat it as style,
 * not as part of the rule.
 */

/** Standard Conventional Commits types a title may start with. */
const COMMIT_TYPES = [
  'feat',
  'fix',
  'docs',
  'style',
  'refactor',
  'perf',
  'test',
  'build',
  'ci',
  'chore',
  'revert',
] as const;

/**
 * Parenthesized scope, such as `auth` or `deps-dev`.
 * The first character is a letter or digit; the rest may also be `.`, `_`,
 * `/`, or `-`. Empty parentheses are not a scope.
 */
const SCOPE = '\\([A-Za-z0-9][A-Za-z0-9._/-]*\\)';

/**
 * Matches `type(optional-scope)!: subject`.
 * `!` before the colon marks a breaking change. After the colon and one
 * space, the subject must contain a non-space character. A gitmoji is
 * subject text, so it satisfies that on its own.
 */
const CONVENTIONAL_TITLE = new RegExp(`^(?:${COMMIT_TYPES.join('|')})(?:${SCOPE})?!?: \\S.*$`, 'u');

/**
 * What the author sees when the title is rejected: the format, two titles
 * that pass, and the accepted types. The rejected title is not included;
 * the caller prints it separately, with newlines removed.
 */
const FAILURE_LINES = [
  'PR title must follow Conventional Commits: type(optional-scope)!: subject.',
  'Example: ci: 👷 Install dpm with a plain bootstrap',
  'Example: feat(auth): ✨ Add OIDC tenants',
  `Types: ${COMMIT_TYPES.join(', ')}.`,
  'A scope and a breaking-change ! are optional.',
  'A gitmoji may start the subject and is not required.',
  'The subject after ": " must be non-empty.',
] as const;

/**
 * Returns undefined when `title` is a Conventional Commit, and the
 * author-facing explanation when it is not.
 */
export function checkTitle(title: string): string | undefined {
  if (CONVENTIONAL_TITLE.test(title)) return undefined;
  return FAILURE_LINES.join('\n');
}

/**
 * Reads PR_TITLE, reports a rejected title, and exits 1.
 * Newlines in the title are shown as spaces so the title cannot start a
 * workflow command on the next log line.
 */
function main(): void {
  /** The pull request title, or empty when the workflow omitted it. */
  const title = process.env.PR_TITLE ?? '';
  /** Undefined when the title matches; otherwise the text for the author. */
  const message = checkTitle(title);
  if (message === undefined) {
    console.log('The title follows Conventional Commits.');
    return;
  }
  console.log(`::error::${message.replaceAll('\n', '%0A')}`);
  console.log(message);
  /** One physical line. A raw newline would let the title inject `::error::`. */
  const shown = title.replace(/[\r\n]+/g, ' ');
  console.log(`Got: ${shown}`);
  process.exit(1);
}

if (import.meta.main) main();

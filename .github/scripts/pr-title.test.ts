// Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: 0BSD

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkTitle } from './pr-title';

/** Standard Conventional Commits types. The checker must accept each one. */
const STANDARD_TYPES = [
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

/** The workflow that runs this checker. */
const WORKFLOW = readFileSync(
  join(import.meta.dir, '..', 'workflows', 'pr-description.yml'),
  'utf8',
);

/** The aggregate workflow. The title check must stay out of `ci-ok`. */
const CI = readFileSync(join(import.meta.dir, '..', 'workflows', 'ci.yml'), 'utf8');

describe('checkTitle', () => {
  test('accepts every standard type, a scope, and a breaking-change mark', () => {
    for (const type of STANDARD_TYPES) {
      expect(checkTitle(`${type}: subject`)).toBeUndefined();
      expect(checkTitle(`${type}(auth): subject`)).toBeUndefined();
      expect(checkTitle(`${type}!: subject`)).toBeUndefined();
      expect(checkTitle(`${type}(deps-dev)!: subject`)).toBeUndefined();
    }
  });

  test('accepts the examples it tells the author to use', () => {
    const message = checkTitle('not a conventional title');
    expect(message).toBeDefined();
    if (message === undefined) return;
    /** Titles copied out of the failure text. Each one has to pass. */
    const examples = message
      .split('\n')
      .filter((line) => line.startsWith('Example: '))
      .map((line) => line.slice('Example: '.length));
    expect(examples).toEqual([
      'ci: 👷 Install dpm with a plain bootstrap',
      'feat(auth): ✨ Add OIDC tenants',
    ]);
    for (const example of examples) expect(checkTitle(example)).toBeUndefined();
  });

  test('accepts a subject with no gitmoji', () => {
    expect(checkTitle('feat: add UUID for contract keys uniqueness')).toBeUndefined();
    expect(checkTitle('test: wait for PQS to catch up before ledger tests')).toBeUndefined();
    expect(
      checkTitle('build(deps): bump follow-redirects in /quickstart/frontend'),
    ).toBeUndefined();
    expect(checkTitle('ci: x')).toBeUndefined();
    expect(checkTitle('fix(ui/form): correct the label')).toBeUndefined();
    expect(checkTitle('perf(api.v2): faster reads')).toBeUndefined();
  });

  test('names the format when the title is not a Conventional Commit', () => {
    /** Titles that must fail, including a newline that could inject a command. */
    const rejected = [
      '',
      'Install dpm',
      'Feat: Add tenants',
      'feature: add tenants',
      'CI: verify downloads',
      'ci:',
      'ci: ',
      'ci:   ',
      'ci:subject',
      'ci:  subject',
      ' feat: subject',
      'feat(): add',
      'feat!(auth): add',
      'feat(auth) : add',
      'feat (auth): add',
      'feat(auth)!:',
      'feat(auth)!: ',
      'feat(has space): add',
      'ci: ok\n::error::injected',
    ];
    for (const title of rejected) {
      const message = checkTitle(title);
      expect(message).toContain('type(optional-scope)!: subject');
      expect(message).toContain('feat(auth): ✨ Add OIDC tenants');
      expect(message).toContain('gitmoji may start the subject and is not required');
    }
  });
});

describe('pr-description workflow', () => {
  test('reruns on an edited title and passes it through the environment', () => {
    expect(WORKFLOW).toMatch(
      /types:\s*\[opened, edited, reopened, synchronize, ready_for_review\]/,
    );
    expect(WORKFLOW).toMatch(/PR_TITLE:\s*\$\{\{\s*github\.event\.pull_request\.title\s*\}\}/);
    expect(WORKFLOW).not.toMatch(/^\s*paths:/m);
    expect(WORKFLOW).toContain('name: PR description');
    /** `run` lines. The title must not be interpolated into one of them. */
    const runLines = WORKFLOW.split('\n').filter((line) => /^\s*run:/.test(line));
    expect(runLines.length).toBeGreaterThan(0);
    for (const line of runLines) {
      expect(line).not.toContain('github.event.pull_request.title');
    }
  });

  test('reports the title when the description check has failed', () => {
    // GitHub treats an if with no status function as success(), which would
    // skip the title step after a description failure.
    expect(WORKFLOW).toMatch(
      /if:\s*\$\{\{\s*!cancelled\(\)\s*&&\s*steps\.tests\.outcome == 'success'\s*\}\}/,
    );
  });

  test('leaves ci-ok aggregating the other jobs only', () => {
    /** The `needs` list of the `ci-ok` job, brackets included. */
    const needs = / {2}ci-ok:[\s\S]*?\n {4}needs:\s*\[([\s\S]*?)\]/.exec(CI);
    expect(needs).not.toBeNull();
    expect(needs?.[1]).not.toMatch(/pr-description|pr-title/);
    expect(needs?.[1]).toContain('integration-test');
  });
});

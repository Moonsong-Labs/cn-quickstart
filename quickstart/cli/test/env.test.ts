// Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: 0BSD

import { describe, expect, test } from 'bun:test';
import { expandEnvValue, parseDotEnv, upsertEnvFile } from '../src/lib/env.ts';

/** Key order used when an empty or partial file is updated. Later tests rely on this order. */
const entries = [
  ['AUTH_MODE', 'oauth2'],
  ['PARTY_HINT', 'quickstart-alice-1'],
  ['TEST_MODE', 'off'],
] as const;

describe('parseDotEnv', () => {
  test('skips blanks and comments and keeps the value after the first equals', () => {
    const parsed = parseDotEnv('# comment\n\n  A=b=c  \nB=2\nnot a pair\n');
    expect(parsed.get('A')).toBe('b=c');
    expect(parsed.get('B')).toBe('2');
    expect(parsed.has('not a pair')).toBe(false);
  });
});

/** `$` followed by `{name}`, the brace form Make expands in an included env file. */
function braced(name: string): string {
  return ['$', '{', name, '}'].join('');
}

describe('expandEnvValue', () => {
  /** Replacement for MODULES_DIR. Any other name is unset. */
  const lookup = (name: string) => (name === 'MODULES_DIR' ? '/modules' : '');

  test('expands a braced name, a parenthesised name, and a doubled dollar', () => {
    expect(expandEnvValue(`${braced('MODULES_DIR')}/localnet`, lookup)).toBe('/modules/localnet');
    expect(expandEnvValue('$(MODULES_DIR)/localnet', lookup)).toBe('/modules/localnet');
    expect(expandEnvValue(`$${braced('MODULES_DIR')}`, lookup)).toBe(braced('MODULES_DIR'));
    expect(expandEnvValue(`${braced('MISSING')}/x`, lookup)).toBe('/x');
    expect(expandEnvValue('keep$literal', lookup)).toBe('keep$literal');
  });
});

describe('upsertEnvFile', () => {
  test('appends keys to an empty file without a trailing newline', () => {
    expect(upsertEnvFile('', entries)).toBe(
      'AUTH_MODE=oauth2\nPARTY_HINT=quickstart-alice-1\nTEST_MODE=off',
    );
  });

  test('replaces every matching line and keeps comments and other keys', () => {
    const existing = '# comment\nOTHER=1\nAUTH_MODE=shared-secret\n# AUTH_MODE=nope\n';
    expect(upsertEnvFile(existing, entries)).toBe(
      [
        '# comment',
        'OTHER=1',
        'AUTH_MODE=oauth2',
        '# AUTH_MODE=nope',
        'PARTY_HINT=quickstart-alice-1',
        'TEST_MODE=off',
      ].join('\n'),
    );
  });

  test('replaces duplicate keys in place', () => {
    expect(upsertEnvFile('AUTH_MODE=a\nAUTH_MODE=b', [['AUTH_MODE', 'oauth2']])).toBe(
      'AUTH_MODE=oauth2\nAUTH_MODE=oauth2',
    );
  });

  test('accepts CRLF input', () => {
    expect(upsertEnvFile('OTHER=1\r\n', [['AUTH_MODE', 'oauth2']])).toBe(
      'OTHER=1\nAUTH_MODE=oauth2',
    );
  });
});

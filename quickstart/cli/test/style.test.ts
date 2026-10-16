// Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: 0BSD

import { afterEach, describe, expect, test } from 'bun:test';
import { colorsEnabled, paint } from '../src/lib/style.ts';

/** Saved colour environment. Restored after each test so later tests see the process defaults. */
const saved = {
  NO_COLOR: process.env.NO_COLOR,
  FORCE_COLOR: process.env.FORCE_COLOR,
  CLICOLOR_FORCE: process.env.CLICOLOR_FORCE,
};

/** Put one colour variable back, deleting it when the saved value was unset. */
function restore(name: 'NO_COLOR' | 'FORCE_COLOR' | 'CLICOLOR_FORCE') {
  const value = saved[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

afterEach(() => {
  restore('NO_COLOR');
  restore('FORCE_COLOR');
  restore('CLICOLOR_FORCE');
});

describe('paint', () => {
  test('NO_COLOR returns the text unchanged', () => {
    process.env.NO_COLOR = '1';
    delete process.env.FORCE_COLOR;
    expect(colorsEnabled()).toBe(false);
    expect(paint('red', 'plain')).toBe('plain');
  });

  test('FORCE_COLOR wraps the text in a colour code', () => {
    delete process.env.NO_COLOR;
    process.env.FORCE_COLOR = '1';
    expect(paint('red', 'plain')).toBe('\u001b[31mplain\u001b[39m');
  });
});

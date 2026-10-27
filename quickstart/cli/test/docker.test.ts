// Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: 0BSD

import { describe, expect, test } from 'bun:test';
import { javaMajor } from '../src/commands/doctor.ts';
import { compareVersions, plainVersion } from '../src/lib/docker.ts';

describe('compareVersions', () => {
  test('compares each numeric part and ignores a suffix', () => {
    expect(compareVersions('29.8.2', '27.0.0')).toBeGreaterThan(0);
    expect(compareVersions('5.5.0', '2.27.0')).toBeGreaterThan(0);
    expect(compareVersions('2.26.0', '2.27.0')).toBeLessThan(0);
    expect(compareVersions('27.0.0-rc1', '27.0.0')).toBe(0);
    expect(compareVersions('27', '27.0.0')).toBe(0);
  });
});

describe('plainVersion', () => {
  test('trims and drops a suffix', () => {
    expect(plainVersion(' 29.8.2-rc1\n')).toBe('29.8.2');
  });
});

describe('javaMajor', () => {
  test('reads the major version from the java banner', () => {
    expect(javaMajor('openjdk version "21.0.2" 2024-01-16\n')).toBe(21);
    expect(javaMajor('java version "27.0.1"\n')).toBe(27);
    expect(javaMajor('')).toBeNull();
  });
});

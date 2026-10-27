// Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: 0BSD

import { describe, expect, test } from 'bun:test';
import { dryRunRunner, formatCommand, realRunner } from '../src/lib/exec.ts';

describe('formatCommand', () => {
  test('quotes arguments that the shell would split', () => {
    expect(formatCommand(['docker', 'compose', '-f', 'my file.yaml'])).toBe(
      "docker compose -f 'my file.yaml'",
    );
    expect(formatCommand(['echo', "a'b"])).toBe(`echo 'a'\\''b'`);
  });
});

describe('dryRunRunner', () => {
  test('does not spawn run, and still captures', async () => {
    /** Stand-in for the real runner. `run` would fail the test if dry-run called it. */
    let captured = false;
    const real = {
      run() {
        throw new Error('dry-run spawned a command');
      },
      capture() {
        captured = true;
        return Promise.resolve({ code: 0, stdout: 'ok', stderr: '' });
      },
    };
    /** Dry-run wrapper. `run` returns success without calling `real.run`. */
    const runner = dryRunRunner(real);
    expect(await runner.run(['docker'], { cwd: '/' })).toBe(0);
    expect(await runner.capture(['docker', 'version'], { cwd: '/' })).toEqual({
      code: 0,
      stdout: 'ok',
      stderr: '',
    });
    expect(captured).toBe(true);
    expect(realRunner).toBeTypeOf('function');
  });
});

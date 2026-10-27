// Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: 0BSD

import { afterEach, describe, expect, test } from 'bun:test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runDoctor } from '../src/commands/doctor.ts';
import type { CommandContext } from '../src/lib/context.ts';
import { dpmExecutable } from '../src/lib/dpm.ts';
import { scriptedIo } from './io.ts';
import { projectCleaner, tempProject } from './project-fixture.ts';
import { fakeRunner } from './runner.ts';

/** Temp checkouts for this file. */
const cleaner = projectCleaner();

afterEach(() => cleaner.cleanup());

/**
 * Context whose captures come from `script`.
 * The checkout is a real temp directory so `.env` can be read.
 */
async function ctx(script: Parameters<typeof fakeRunner>[0]): Promise<{
  context: CommandContext;
  noted(): string;
}> {
  const dir = await tempProject(cleaner.dirs, 'PARTY_HINT=App-User-1\n');
  await writeFile(join(dir, '..', '.bun-version'), '1.3.3\n');
  /** Scripted terminal and runner. */
  const io = scriptedIo([]);
  const { runner } = fakeRunner(script);
  return {
    noted: io.noted,
    context: {
      io: io.io,
      env: {},
      cwd: dir,
      cliDir: dir,
      dryRun: false,
      project: dir,
      runner,
    },
  };
}

describe('runDoctor', () => {
  test('passes when Docker, Compose, Bun, dpm, and the JDK are in range', async () => {
    const { context, noted } = await ctx([
      { code: 0 },
      { stdout: '29.8.2\n' },
      { stdout: '5.5.0\n' },
      { stdout: '1.3.3\n' },
      { stdout: '3.5.2\n' },
      { stderr: 'openjdk version "21.0.2"\n' },
    ]);
    expect(await runDoctor(context)).toBe(0);
    expect(noted()).toContain('✓ Docker');
    expect(noted()).toContain('✓ Compose');
    expect(noted()).toContain('0.8.4');
    expect(noted()).toContain('✓ JDK');
  });

  test('probes DPM_PATH when it is set', async () => {
    const dir = await tempProject(cleaner.dirs, 'PARTY_HINT=App-User-1\n');
    const io = scriptedIo([]);
    const fake = fakeRunner([
      { code: 0 },
      { stdout: '29.8.2\n' },
      { stdout: '5.5.0\n' },
      { stdout: '1.3.3\n' },
      { stdout: '3.5.2\n' },
      { stderr: 'openjdk version "21.0.2"\n' },
    ]);
    expect(dpmExecutable({ DPM_PATH: '/opt/dpm' })).toBe('/opt/dpm');
    expect(
      await runDoctor({
        io: io.io,
        env: { DPM_PATH: '/opt/dpm' },
        cwd: dir,
        cliDir: dir,
        dryRun: false,
        project: dir,
        runner: fake.runner,
      }),
    ).toBe(0);
    expect(fake.calls.some((call) => call.cmd[0] === '/opt/dpm')).toBe(true);
  });

  test('fails when the Docker CLI is missing', async () => {
    const { context, noted } = await ctx([
      { code: 127 },
      { code: 127 },
      { code: 127 },
      { stderr: 'openjdk version "21.0.2"\n' },
    ]);
    expect(await runDoctor(context)).toBe(1);
    expect(noted()).toContain('CLI not found');
  });

  test('fails when the daemon is stopped', async () => {
    const { context, noted } = await ctx([
      { code: 1 },
      { code: 127 },
      { code: 127 },
      { code: 127 },
    ]);
    expect(await runDoctor(context)).toBe(1);
    expect(noted()).toContain('daemon is not running');
  });

  test('warns for JDK 27 and still succeeds', async () => {
    const { context, noted } = await ctx([
      { code: 0 },
      { stdout: '29.8.2\n' },
      { stdout: '5.5.0\n' },
      { stdout: '1.3.14\n' },
      { stdout: '3.5.2\n' },
      { stderr: 'openjdk version "27.0.1"\n' },
    ]);
    expect(await runDoctor(context)).toBe(0);
    expect(noted()).toContain('outside 21–22');
    expect(noted()).toContain('pinned 1.3.3');
  });
});

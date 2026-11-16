// Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: 0BSD

import { afterEach, describe, expect, test } from 'bun:test';
import { chmod, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runDoctor } from '../src/commands/doctor.ts';
import type { CommandContext } from '../src/lib/context.ts';
import { dpmExecutable } from '../src/lib/dpm.ts';
import { scriptedIo } from './io.ts';
import { projectCleaner, tempProject } from './project-fixture.ts';
import { fakeRunner } from './runner.ts';

/** Temp checkouts for this file. */
const cleaner = projectCleaner();

/**
 * `dpm version -o json` listing one active, installed SDK.
 * `--active` prints the version either way, so the install flag comes from this listing.
 */
function installedJson(version: string): { stdout: string } {
  return { stdout: `[{"version":"${version}","installed":true,"active":true}]\n` };
}

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
      installedJson('3.5.2'),
      { stdout: 'version: 1.0.21\nbuild: abc\n' },
      { stderr: 'openjdk version "21.0.2"\n' },
    ]);
    expect(await runDoctor(context)).toBe(0);
    expect(noted()).toContain('✓ Docker');
    expect(noted()).toContain('✓ Compose');
    expect(noted()).toContain('0.8.4');
    expect(noted()).toContain('✓ Daml SDK');
    expect(noted()).toContain('3.5.2');
    expect(noted()).toContain('✓ dpm CLI');
    expect(noted()).toContain('1.0.21');
    expect(noted()).not.toContain('pinned');
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
      installedJson('3.5.2'),
      { stdout: 'version: 1.0.21\n' },
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
    const dpmCalls = fake.calls.filter((call) => call.cmd[0] === '/opt/dpm');
    expect(dpmCalls.map((call) => call.cmd)).toEqual([
      ['/opt/dpm', 'version', '--active'],
      ['/opt/dpm', 'version', '-o', 'json'],
      ['/opt/dpm', '--version'],
    ]);
    expect(dpmCalls[0]?.cwd).toBe(join(dir, 'daml', 'licensing'));
    expect(dpmCalls[1]?.cwd).toBe(join(dir, 'daml', 'licensing'));
    expect(io.noted()).toContain('✓ Daml SDK');
    expect(io.noted()).toContain('3.5.2');
  });

  test('fails when the Docker CLI is missing', async () => {
    const { context, noted } = await ctx([
      { code: 127 },
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
      installedJson('3.5.2'),
      { stdout: 'version: 1.0.21\n' },
      { stderr: 'openjdk version "27.0.1"\n' },
    ]);
    expect(await runDoctor(context)).toBe(0);
    expect(noted()).toContain('outside 21–22');
    expect(noted()).toContain('pinned 1.3.3');
  });

  test('warns when the active SDK differs from daml.yaml and still succeeds', async () => {
    const { context, noted } = await ctx([
      { code: 0 },
      { stdout: '29.8.2\n' },
      { stdout: '5.5.0\n' },
      { stdout: '1.3.3\n' },
      { stdout: '3.4.0\n' },
      installedJson('3.4.0'),
      { stdout: '1.0.21\n' },
      { stderr: 'openjdk version "21.0.2"\n' },
    ]);
    expect(await runDoctor(context)).toBe(0);
    expect(noted()).toContain('! Daml SDK');
    expect(noted()).toContain('3.4.0 (pinned 3.5.2 in daml/licensing/daml.yaml)');
    expect(noted()).toContain('✓ dpm CLI');
    expect(noted()).toContain('1.0.21');
  });

  test('warns when daml.yaml has no sdk-version', async () => {
    const dir = await tempProject(cleaner.dirs, 'PARTY_HINT=App-User-1\n');
    await writeFile(join(dir, 'daml', 'licensing', 'daml.yaml'), 'name: licensing\n');
    await writeFile(join(dir, '..', '.bun-version'), '1.3.3\n');
    const io = scriptedIo([]);
    const fake = fakeRunner([
      { code: 0 },
      { stdout: '29.8.2\n' },
      { stdout: '5.5.0\n' },
      { stdout: '1.3.3\n' },
      { stdout: '3.5.2\n' },
      installedJson('3.5.2'),
      { stdout: 'version: 1.0.21\n' },
      { stderr: 'openjdk version "21.0.2"\n' },
    ]);
    expect(
      await runDoctor({
        io: io.io,
        env: {},
        cwd: dir,
        cliDir: dir,
        dryRun: false,
        project: dir,
        runner: fake.runner,
      }),
    ).toBe(0);
    expect(io.noted()).toContain('sdk-version not found in daml/licensing/daml.yaml');
  });

  test('warns when the active SDK is not installed and still succeeds', async () => {
    const { context, noted } = await ctx([
      { code: 0 },
      { stdout: '29.8.2\n' },
      { stdout: '5.5.0\n' },
      { stdout: '1.3.3\n' },
      { stdout: '3.5.2\n' },
      { stdout: '[{"version":"3.5.2","active":true}]\n' },
      { stdout: 'version: 1.0.21\n' },
      { stderr: 'openjdk version "21.0.2"\n' },
    ]);
    expect(await runDoctor(context)).toBe(0);
    expect(noted()).toContain('! Daml SDK');
    expect(noted()).toContain('3.5.2 is not installed');
    expect(noted()).not.toContain('not found on PATH');
    expect(noted()).toContain('✓ JDK');
  });

  test('reports a dpm error instead of a missing binary', async () => {
    const { context, noted } = await ctx([
      { code: 0 },
      { stdout: '29.8.2\n' },
      { stdout: '5.5.0\n' },
      { stdout: '1.3.3\n' },
      { code: 1, stderr: 'Error: no SDK version is active\n' },
      { stdout: 'version: 1.0.21\n' },
      { stderr: 'openjdk version "21.0.2"\n' },
    ]);
    expect(await runDoctor(context)).toBe(0);
    expect(noted()).toContain('no SDK version is active');
    expect(noted()).not.toContain('not found on PATH');
    expect(noted()).toContain('✓ dpm CLI');
    expect(noted()).toContain('✓ JDK');
  });

  test('warns when daml.yaml cannot be read and still prints the other checks', async () => {
    const dir = await tempProject(cleaner.dirs, 'PARTY_HINT=App-User-1\n');
    /** Manifest made unreadable. The same user then gets EACCES from readFileSync. */
    const yaml = join(dir, 'daml', 'licensing', 'daml.yaml');
    await chmod(yaml, 0o000);
    await writeFile(join(dir, '..', '.bun-version'), '1.3.3\n');
    const io = scriptedIo([]);
    const fake = fakeRunner([
      { code: 0 },
      { stdout: '29.8.2\n' },
      { stdout: '5.5.0\n' },
      { stdout: '1.3.3\n' },
      { stdout: '3.5.2\n' },
      installedJson('3.5.2'),
      { stdout: 'version: 1.0.21\n' },
      { stderr: 'openjdk version "21.0.2"\n' },
    ]);
    try {
      expect(
        await runDoctor({
          io: io.io,
          env: {},
          cwd: dir,
          cliDir: dir,
          dryRun: false,
          project: dir,
          runner: fake.runner,
        }),
      ).toBe(0);
    } finally {
      await chmod(yaml, 0o644);
    }
    expect(io.noted()).toContain('could not read daml/licensing/daml.yaml (EACCES)');
    expect(io.noted()).toContain('✓ JDK');
    expect(io.noted()).toContain('✓ Docker');
  });
});

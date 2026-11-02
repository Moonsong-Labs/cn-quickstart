// Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: 0BSD

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { formatEventTime, logFileFor, parseEvent, runCapture } from '../src/commands/capture.ts';
import type { CommandContext } from '../src/lib/context.ts';
import { scriptedIo } from './io.ts';
import { projectCleaner, tempProject } from './project-fixture.ts';
import { fakeRunner } from './runner.ts';

/** Temp checkouts for this file. */
const cleaner = projectCleaner();

afterEach(() => cleaner.cleanup());

describe('parseEvent', () => {
  test('keeps the action text after the name', () => {
    expect(parseEvent('abc 1700000000 canton health_status: healthy')).toEqual({
      id: 'abc',
      time: 1700000000,
      name: 'canton',
      action: 'health_status: healthy',
    });
  });

  test('rejects a short line', () => {
    expect(parseEvent('abc 1')).toBeUndefined();
  });
});

describe('formatEventTime', () => {
  test('prints UTC without a trailing Z', () => {
    expect(formatEventTime(1700000000)).toBe('2023-11-14T22:13:20');
  });
});

describe('logFileFor', () => {
  test('uses .clog for the three lnav services', () => {
    expect(logFileFor('canton')).toBe('.clog');
    expect(logFileFor('splice')).toBe('.clog');
    expect(logFileFor('backend-service')).toBe('.clog');
    expect(logFileFor('nginx')).toBe('.log');
  });
});

describe('runCapture', () => {
  test('writes attached start events and follows their logs', async () => {
    const dir = await tempProject(cleaner.dirs, 'AUTH_MODE=oauth2\n');
    await mkdir(join(dir, 'logs', 'old'), { recursive: true });
    await writeFile(join(dir, 'logs', 'keep.txt'), 'gone');
    const fake = fakeRunner(
      [{ code: 0 }, { stdout: '{"quickstart_default":{}}' }, { code: 1 }],
      ['not an event', 'abc 1700000000 canton start', 'def 1700000001 nginx die'],
    );
    const io = scriptedIo([]);
    /** Context whose network name is the default `quickstart`. */
    const context: CommandContext = {
      io: io.io,
      env: {},
      cwd: dir,
      cliDir: dir,
      dryRun: false,
      project: dir,
      runner: fake.runner,
    };
    expect(await runCapture(context)).toBe(0);
    expect(io.output()).toBe('2023-11-14T22:13:20 canton start\n>> canton\n');
    expect(await readFile(join(dir, 'logs', 'compose.log'), 'utf8')).toBe(io.output());
    await expect(readFile(join(dir, 'logs', 'keep.txt'), 'utf8')).rejects.toThrow();
    /** Log follower. The nginx event was not attached, so it has no follower. */
    const follow = fake.calls.filter((call) => call.cmd[1] === 'logs');
    expect(follow).toEqual([{ cmd: ['docker', 'logs', '-f', 'abc'], cwd: dir, env: {} }]);
  });

  test('dry-run does not create logs/', async () => {
    const dir = await tempProject(cleaner.dirs);
    const fake = fakeRunner();
    const io = scriptedIo([]);
    /** Dry-run context. `.env.local` is absent and must stay unneeded. */
    const context: CommandContext = {
      io: io.io,
      env: {},
      cwd: dir,
      cliDir: dir,
      dryRun: true,
      project: dir,
      runner: fake.runner,
    };
    expect(await runCapture(context)).toBe(0);
    expect(io.noted()).toContain('docker events');
    await expect(readFile(join(dir, 'logs', 'compose.log'), 'utf8')).rejects.toThrow();
    expect(fake.calls).toEqual([]);
  });

  test('returns 130 when SIGINT arrives during the stream', async () => {
    const dir = await tempProject(cleaner.dirs, 'AUTH_MODE=oauth2\n');
    const fake = fakeRunner([{ code: 0 }]);
    /** Lines implementation that signals before yielding, so the loop stops. */
    const lines = fake.runner.lines.bind(fake.runner);
    fake.runner.lines = (cmd, opts) => {
      process.emit('SIGINT');
      return lines(cmd, opts);
    };
    const io = scriptedIo([]);
    const context: CommandContext = {
      io: io.io,
      env: {},
      cwd: dir,
      cliDir: dir,
      dryRun: false,
      project: dir,
      runner: fake.runner,
    };
    expect(await runCapture(context)).toBe(130);
  });
});

// Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: 0BSD

import { appendFile, mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { CommandContext } from '../lib/context.ts';
import { ensureDocker } from '../lib/docker.ts';
import type { BackgroundChild } from '../lib/exec.ts';
import { definedEnv, formatCommand } from '../lib/exec.ts';
import { composeProject, type Project } from '../lib/project.ts';
import { paint } from '../lib/style.ts';

/** Services whose logs are written with the `.clog` suffix lnav expects. */
const CLOG_SERVICES = new Set(['canton', 'splice', 'backend-service']);

/** Docker event actions `capture-logs` subscribed to. */
const EVENT_FILTERS = [
  'type=container',
  'event=start',
  'event=stop',
  'event=restart',
  'event=kill',
  'event=die',
  'event=destroy',
  'event=health_status',
  'event=oom',
];

/** One container event from `docker events`. `action` keeps spaces, so health events stay intact. */
export type ContainerEvent = {
  /** Container id. Passed to `docker logs`. */
  id: string;
  /** Unix seconds from the event. */
  time: number;
  /** Compose service name. */
  name: string;
  /** Action text, including anything after the first word. */
  action: string;
};

/**
 * Parse one `docker events` line of `id time name action`.
 * Returns undefined when the line does not have those four fields.
 */
export function parseEvent(line: string): ContainerEvent | undefined {
  /** id, epoch seconds, name, and the remainder as the action. */
  const match = /^(\S+) (\d+) (\S+) (.*)$/.exec(line.trim());
  if (match === null) return undefined;
  return {
    id: match[1] ?? '',
    time: Number(match[2]),
    name: match[3] ?? '',
    action: match[4] ?? '',
  };
}

/**
 * UTC timestamp `YYYY-MM-DDTHH:MM:SS` for an epoch in seconds.
 * Matches `date -u` without the `Z` that `toISOString` would add.
 */
export function formatEventTime(seconds: number): string {
  return new Date(seconds * 1000).toISOString().slice(0, 19);
}

/**
 * Suffix for a service's captured log.
 * `canton`, `splice`, and `backend-service` use `.clog`. Every other service uses `.log`.
 */
export function logFileFor(name: string): '.clog' | '.log' {
  return CLOG_SERVICES.has(name) ? '.clog' : '.log';
}

/**
 * Follow container events and append logs under `logs/`.
 * The directory is emptied first and kept. Ctrl-C stops the stream and the log followers and returns 130.
 * `--dry-run` prints the events command and does not touch `logs/`.
 */
export async function runCapture(ctx: CommandContext): Promise<number> {
  /** Checkout whose network name selects which events are kept. */
  const project = composeProject(ctx);
  /** Daemon check. Skipped for `--dry-run`. */
  const docker = await ensureDocker(ctx);
  if (docker !== 0) return docker;
  /** Event command. Filters match the Makefile's `docker events` invocation. */
  const cmd = [
    'docker',
    'events',
    ...EVENT_FILTERS.flatMap((filter) => ['--filter', filter]),
    '--format',
    '{{.Actor.ID}} {{.Time}} {{.Actor.Attributes.name}} {{.Action}}',
  ];
  ctx.io.note(`${paint('dim', `$ ${formatCommand(cmd)}`)}\n`);
  if (ctx.dryRun) return 0;
  /** Directory the Makefile wrote. Existing files are removed; the directory stays. */
  const logsDir = join(project.dir, 'logs');
  await emptyLogs(logsDir);
  /** Log followers started for `start` events. Stopped when the stream ends. */
  const children: BackgroundChild[] = [];
  /** Set when Ctrl-C arrives, so the command exits 130 rather than 0. */
  let interrupted = false;
  /** Mark the run as interrupted. The events child also receives the signal and closes. */
  const onSigint = () => {
    interrupted = true;
  };
  process.on('SIGINT', onSigint);
  try {
    for await (const line of ctx.runner.lines(cmd, {
      cwd: project.dir,
      env: definedEnv(ctx.env),
    })) {
      if (interrupted) break;
      await recordEvent(ctx, project, logsDir, line, children);
    }
  } finally {
    process.off('SIGINT', onSigint);
    for (const child of children) child.stop();
  }
  return interrupted ? 130 : 0;
}

/**
 * Delete everything inside `dir`, creating the directory when it is missing.
 * The directory itself is kept so a watcher pointed at it survives.
 */
async function emptyLogs(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  /** Names currently in the directory. Each is removed, including nested directories. */
  const names = await readdir(dir);
  await Promise.all(names.map((name) => rm(join(dir, name), { recursive: true, force: true })));
}

/**
 * Write one event when its container is on the project network, and follow logs on `start`.
 * A container that has already gone is skipped.
 */
async function recordEvent(
  ctx: CommandContext,
  project: Project,
  logsDir: string,
  line: string,
  children: BackgroundChild[],
): Promise<void> {
  /** Parsed event. A line Docker did not format is ignored. */
  const event = parseEvent(line);
  if (event === undefined) return;
  /** True when one of the container's networks contains the project network name. */
  const attached = await containerOnNetwork(ctx, project, event.id);
  if (!attached) return;
  /** The Makefile's timestamped line, also appended to `logs/compose.log`. */
  const text = `${formatEventTime(event.time)} ${event.name} ${event.action}\n`;
  await writeBoth(ctx, logsDir, text);
  if (event.action !== 'start') return;
  await writeBoth(ctx, logsDir, `>> ${event.name}\n`);
  children.push(
    ctx.runner.background(['docker', 'logs', '-f', event.id], {
      cwd: project.dir,
      env: definedEnv(ctx.env),
      output: join(logsDir, `${event.name}${logFileFor(event.name)}`),
    }),
  );
}

/**
 * True when `docker inspect` reports a network whose name contains the project network.
 * A failed inspect, or JSON that is not an object, counts as not attached.
 */
async function containerOnNetwork(
  ctx: CommandContext,
  project: Project,
  id: string,
): Promise<boolean> {
  /** Inspect result. A gone container is a non-zero status and is skipped. */
  const result = await ctx.runner.capture(
    ['docker', 'inspect', '--format', '{{json .NetworkSettings.Networks}}', id],
    { cwd: project.dir, env: definedEnv(ctx.env) },
  );
  if (result.code !== 0) return false;
  try {
    /** Network map. Keys are the network names. */
    const networks = JSON.parse(result.stdout) as unknown;
    if (networks === null || typeof networks !== 'object' || Array.isArray(networks)) return false;
    return Object.keys(networks).some((name) => name.includes(project.settings.dockerNetwork));
  } catch {
    return false;
  }
}

/**
 * Print `text` and append the same text to `logs/compose.log`.
 * Stdout is the event stream a person watches; the file is what lnav reads later.
 */
async function writeBoth(ctx: CommandContext, logsDir: string, text: string): Promise<void> {
  ctx.io.write(text);
  await appendFile(join(logsDir, 'compose.log'), text);
}

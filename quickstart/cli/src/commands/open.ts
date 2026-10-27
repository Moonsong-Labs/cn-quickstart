// Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: 0BSD

import type { CommandContext } from '../lib/context.ts';
import { definedEnv, loggedRun } from '../lib/exec.ts';
import { step } from '../lib/step.ts';
import { aside, paint } from '../lib/style.ts';

/** Browser targets, in the same order as the Makefile. The key is the `qs open` argument. */
export const OPEN_TARGETS = [
  ['app', 'http://app-provider.localhost:3000'],
  ['app-user-wallet', 'http://wallet.localhost:2000'],
  ['sv-wallet', 'http://wallet.localhost:4000'],
  ['sv', 'http://sv.localhost:4000'],
  ['scan', 'http://scan.localhost:4000'],
  ['swagger', 'http://localhost:9090'],
] as const;

/** Names accepted by `qs open`. An unknown name is a usage error, the same as `qs build`. */
export const OPEN_NAMES = OPEN_TARGETS.map(([name]) => name);

/** One `qs open` name. */
export type OpenName = (typeof OPEN_TARGETS)[number][0];

/**
 * Narrow a command argument to an `OpenName`.
 * Throws when Commander did not already reject the name.
 */
function knownOpenName(name: string): OpenName {
  /** Match from the fixed list. A miss means the choice check was bypassed. */
  const found = OPEN_NAMES.find((item) => item === name);
  if (found === undefined) throw new Error(`Unknown UI: ${name}. Run qs open to list them.`);
  return found;
}

/**
 * URL for a known UI name.
 * Throws when `name` is not in `OPEN_TARGETS`. The command rejects those names before this runs.
 */
export function openTargetUrl(name: OpenName): string {
  /** Pair for `name`. The type makes a miss a programming error. */
  const found = OPEN_TARGETS.find(([key]) => key === name);
  if (found === undefined) throw new Error(`Unknown UI: ${name}. Run qs open to list them.`);
  return found[1];
}

/**
 * Open `name` in the browser, or list every target when `name` is omitted.
 * macOS uses `open`. Linux uses `xdg-open`. Anything else prints the URL.
 * A missing opener also prints the URL instead of failing.
 */
export async function runOpen(ctx: CommandContext, name?: string): Promise<number> {
  if (name === undefined) {
    ctx.io.note(`${paint('bold', 'Quickstart UIs')}\n\n`);
    for (const [key, url] of OPEN_TARGETS) {
      ctx.io.note(`${aside(`${key.padEnd(16)} ${url}`)}\n`);
    }
    return 0;
  }
  /** URL for `name`. Commander has already limited `name` to `OPEN_NAMES`. */
  const url = openTargetUrl(knownOpenName(name));
  /** Browser command for this platform. Null means the URL is printed instead. */
  const opener =
    process.platform === 'darwin' ? 'open' : process.platform === 'linux' ? 'xdg-open' : null;
  if (opener === null) {
    ctx.io.note(`${url}\n`);
    return 0;
  }
  return step(ctx.io, `Opening ${name}`, `Opened ${name}`, async () => {
    /** Opener status. A missing command falls back to printing the URL. */
    const status = await loggedRun(ctx.io, ctx.runner, [opener, url], {
      cwd: ctx.cwd,
      env: definedEnv(ctx.env),
    });
    if (status === 127) {
      ctx.io.note(`${url}\n`);
      return 0;
    }
    return status;
  });
}

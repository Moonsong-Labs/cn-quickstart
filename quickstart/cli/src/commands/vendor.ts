// Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: 0BSD

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Command } from 'commander';
import type { CommandContext } from '../lib/context.ts';
import { fetchVendorRow, parseLinks, type VendorRow } from '../lib/localnet.ts';
import { projectFromContext } from '../lib/project.ts';
import type { CommandDeps } from '../lib/register.ts';

export { parseLinks, type VendorRow };

/**
 * Fetch vendored directories listed in `links.csv` into their commit-keyed cache directories
 * and apply any override patches.
 * `name` selects one row; omitting it fetches every row. An unknown name lists the names that exist.
 * A failed fetch removes its temporary directory. `--dry-run` prints the row and does not fetch.
 */
export async function runVendor(ctx: CommandContext, name?: string): Promise<number> {
  /** Checkout that contains `links.csv` and the cache directories. */
  const project = projectFromContext(ctx);
  /** Parsed rows. A missing file throws from `readFile`. */
  const rows = parseLinks(await readFile(join(project.dir, 'links.csv'), 'utf8'));
  /** Rows this invocation will fetch. */
  const chosen = name === undefined ? rows : rows.filter((row) => row.name === name);
  if (name !== undefined && chosen.length === 0) {
    /** Names a person can pass, in file order and without duplicates. */
    const known = [...new Set(rows.map((row) => row.name))].join(', ') || '(none)';
    throw new Error(`Unknown vendor '${name}'. Known names: ${known}.`);
  }
  for (const row of chosen) {
    /** Status of this row. A failure stops before the next row. */
    const status = await fetchVendorRow(ctx, project.dir, row, project.settings.modulesDir);
    if (status !== 0) return status;
  }
  return 0;
}

/**
 * Register `qs vendor`.
 * With no name, every row of `links.csv` is fetched into the cache.
 */
export function registerVendor(program: Command, deps: CommandDeps): void {
  deps
    .addSharedOptions(program.command('vendor'))
    .description('Fetch a directory listed in links.csv into the cache')
    .argument('[name]', 'Row to fetch. Omit to fetch every row')
    .action(async (name: string | undefined, _local: unknown, command: Command) => {
      await deps.run(command, (ctx) => runVendor(ctx, name));
    });
}

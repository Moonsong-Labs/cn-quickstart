// Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: 0BSD

import { access, mkdir, mkdtemp, readFile, rename, rm } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import type { Command } from 'commander';
import type { CommandContext } from '../lib/context.ts';
import { definedEnv, loggedRun } from '../lib/exec.ts';
import { projectFromContext } from '../lib/project.ts';
import type { CommandDeps } from '../lib/register.ts';

/** One row of `links.csv` after trimming and dropping comments. */
export type VendorRow = {
  /** Git remote, as written. SSH URLs need a key the user already has. */
  repo: string;
  /** Commit to check out. Fetched with depth 1. */
  sha: string;
  /** Path inside the remote repository, without a trailing slash. */
  source: string;
  /** Directory that will contain `name`. */
  destDir: string;
  /** Last component of `source`. This is the name `qs vendor` selects on. */
  name: string;
};

/**
 * Parse `links.csv`. Blank lines and lines whose trim starts with `#` are skipped.
 * Each field is trimmed, a trailing `\r` is removed, and a trailing `/` is removed from the paths.
 * A row without four fields is skipped.
 */
export function parseLinks(text: string): VendorRow[] {
  /** Rows in file order. */
  const rows: VendorRow[] = [];
  for (const raw of text.split(/\r?\n/)) {
    /** Trimmed line. A comment or blank line is not a row. */
    const line = raw.trim();
    if (line.length === 0 || line.startsWith('#')) continue;
    /** Four fields. Extra commas are not expected; a short row is skipped. */
    const fields = line.split(',').map((field) => field.trim().replace(/\r$/, ''));
    const repo = fields[0];
    const sha = fields[1];
    const source = fields[2]?.replace(/\/+$/, '');
    const destDir = fields[3]?.replace(/\/+$/, '');
    if (!repo || !sha || !source || !destDir) continue;
    /** Last path component, which is the directory name at the destination. */
    const name = source.split('/').pop() ?? source;
    rows.push({ repo, sha, source, destDir, name });
  }
  return rows;
}

/**
 * Replace vendored directories listed in `links.csv`.
 * `name` selects one row; omitting it fetches every row. An unknown name lists the names that exist.
 * A failed fetch removes its temporary directory. `--dry-run` prints the row and does not fetch.
 */
export async function runVendor(ctx: CommandContext, name?: string): Promise<number> {
  /** Checkout that contains `links.csv` and the destination directories. */
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
    const status = await vendorRow(ctx, project.dir, row);
    if (status !== 0) return status;
  }
  return 0;
}

/**
 * Commit column. A full SHA-1 (40) or SHA-256 (64) object id.
 * `git fetch` does not expand a short hash, so anything shorter is refused before git runs.
 * A leading `-` never matches.
 */
const SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

/**
 * Refuse a commit that git could parse as an option, or that `git fetch` cannot resolve.
 * Throws when `sha` is not a full SHA-1 or SHA-256 object id.
 */
function assertSha(sha: string): void {
  if (SHA.test(sha)) return;
  throw new Error(`Vendor commit '${sha}' is not a full hex sha.`);
}

/**
 * Refuse a path git or `rm` could treat as an option or as a traversal.
 * `value` must be relative, with no `..` segment and no leading `-`.
 */
function assertRepoPath(label: string, value: string): void {
  if (value.startsWith('-') || value.startsWith('/') || value.split('/').includes('..')) {
    throw new Error(`Vendor ${label} '${value}' must be a relative path inside the repository.`);
  }
}

/**
 * Throw when `target` is not `root` and not a path inside it.
 * Comparison is on resolved paths, so `..` and absolute joins cannot slip past.
 */
function assertInside(root: string, target: string): void {
  /** Resolved checkout. A trailing slash is added so a sibling prefix does not count. */
  const base = resolve(root);
  /** Resolved target. */
  const dest = resolve(target);
  if (dest === base || dest.startsWith(base + sep)) return;
  throw new Error(`Vendor path '${target}' escapes the checkout.`);
}

/** True when `error` is a missing path. Other failures propagate. */
function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

/**
 * Replace `dest` with `source` on the same filesystem.
 * The old directory is moved aside first and put back when the new name cannot be moved in.
 * `source` is left in place when the replacement fails.
 */
async function replaceDest(
  dest: string,
  source: string,
  destParent: string,
  name: string,
): Promise<void> {
  /** Directory holding the previous `dest`, when one existed. Removed after a successful move. */
  let aside: string | undefined;
  /** True when `dest` is already there and has to be moved aside before the new tree takes its name. */
  let hadDest = false;
  try {
    await access(dest);
    hadDest = true;
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
  if (hadDest) {
    aside = await mkdtemp(join(destParent, '.qs-vendor-old-'));
    try {
      await rename(dest, join(aside, name));
    } catch (error) {
      await rm(aside, { recursive: true, force: true });
      throw error;
    }
  }
  try {
    await rename(source, dest);
  } catch (error) {
    if (aside !== undefined) {
      await rm(dest, { recursive: true, force: true });
      await rename(join(aside, name), dest);
      await rm(aside, { recursive: true, force: true });
    }
    throw error;
  }
  if (aside !== undefined) await rm(aside, { recursive: true, force: true });
}

/**
 * Fetch one row and replace its destination directory.
 * Returns the git status that failed, or 0 when the directory was replaced.
 * A bad sha or a path that leaves the checkout throws before git runs.
 * The temporary checkout sits next to the destination, so the final `rename` stays on one filesystem.
 * The old destination is removed only after the new tree is known to exist, and restored if that move fails.
 */
async function vendorRow(ctx: CommandContext, projectDir: string, row: VendorRow): Promise<number> {
  assertSha(row.sha);
  if (row.repo.startsWith('-')) {
    throw new Error(`Vendor repo '${row.repo}' must not be a git option.`);
  }
  assertRepoPath('source', row.source);
  assertRepoPath('destination', row.destDir);
  /** Parent of the destination. Created before the temporary checkout, which has to live beside it. */
  const destParent = join(projectDir, row.destDir);
  /** Destination directory, `destDir` plus the source's last component. */
  const dest = join(destParent, row.name);
  assertInside(projectDir, dest);
  ctx.io.note(`Copying ${row.source} from ${row.repo} at ${row.sha} to ${dest}\n`);
  if (ctx.dryRun) return 0;
  await mkdir(destParent, { recursive: true });
  /** Sparse checkout beside `dest`. Removed in `finally`, including when a git command fails. */
  const tmp = await mkdtemp(join(destParent, '.qs-vendor-'));
  try {
    /** Git commands in the order `copy_external_dirs.sh` ran them. */
    const steps: string[][] = [
      ['git', 'init', '--quiet', tmp],
      ['git', '-C', tmp, 'remote', 'add', 'origin', row.repo],
      ['git', '-C', tmp, 'sparse-checkout', 'set', '--cone', row.source],
      ['git', '-C', tmp, 'fetch', '--depth', '1', '--filter=blob:none', 'origin', row.sha],
      ['git', '-C', tmp, 'checkout', '--quiet', '--detach', 'FETCH_HEAD'],
    ];
    for (const cmd of steps) {
      /** Status of this git command. Later commands are skipped after a failure. */
      const status = await loggedRun(ctx.io, ctx.runner, cmd, {
        cwd: projectDir,
        env: definedEnv(ctx.env),
      });
      if (status !== 0) return status;
    }
    /** Checked-out tree. It has to stay inside the temporary directory. */
    const source = join(tmp, row.source);
    assertInside(tmp, source);
    try {
      await access(source);
    } catch (error) {
      if (!isMissing(error)) throw error;
      throw new Error(`Checkout has no '${row.source}' at ${row.sha}. Left ${dest} in place.`);
    }
    await replaceDest(dest, source, destParent, row.name);
    ctx.io.note(`Replaced ${dest}\n`);
    return 0;
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

/**
 * Register `qs vendor`.
 * With no name, every row of `links.csv` is fetched.
 */
export function registerVendor(program: Command, deps: CommandDeps): void {
  deps
    .addSharedOptions(program.command('vendor'))
    .description('Replace a directory listed in links.csv')
    .argument('[name]', 'Row to fetch. Omit to fetch every row')
    .action(async (name: string | undefined, _local: unknown, command: Command) => {
      await deps.run(command, (ctx) => runVendor(ctx, name));
    });
}

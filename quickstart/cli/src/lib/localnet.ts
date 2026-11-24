// Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: 0BSD

import { readFileSync } from 'node:fs';
import { access, mkdir, mkdtemp, readdir, rename, rm } from 'node:fs/promises';
import { basename, join, resolve, sep } from 'node:path';
import type { CommandContext } from './context.ts';
import { definedEnv, loggedRun } from './exec.ts';
import type { Project } from './project.ts';

/** One row of `links.csv` after trimming and dropping comments. */
export type VendorRow = {
  /** Git remote, as written. HTTPS URLs work without a GitHub SSH key. */
  repo: string;
  /** Commit to check out. Fetched with depth 1. */
  sha: string;
  /** Path inside the remote repository, without a trailing slash. */
  source: string;
  /** Directory under the checkout that contains `<name>/<sha>`. */
  destDir: string;
  /** Last component of `source`. This is the name `qs vendor` selects on. */
  name: string;
};

/**
 * Commit column. A full SHA-1 (40) or SHA-256 (64) object id.
 * `git fetch` does not expand a short hash, so anything shorter is refused before git runs.
 * A leading `-` never matches.
 */
const SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

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
    /** Git remote URL. */
    const repo = fields[0];
    /** Full commit SHA to check out. */
    const sha = fields[1];
    /** Path inside the remote repository, without trailing slashes. */
    const source = fields[2]?.replace(/\/+$/, '');
    /** Relative destination parent inside the quickstart checkout, without trailing slashes. */
    const destDir = fields[3]?.replace(/\/+$/, '');
    if (!repo || !sha || !source || !destDir) continue;
    /** Last path component, which is the directory name at the destination. */
    const name = source.split('/').pop() ?? source;
    rows.push({ repo, sha, source, destDir, name });
  }
  return rows;
}

/**
 * Replace the commit SHA of the `links.csv` row named `name`, keeping comments,
 * blank lines, line endings, and every other row unchanged.
 * Throws when `name` is not found or `newSha` is not a full hex SHA.
 */
export function rewriteLinksSha(text: string, name: string, newSha: string): string {
  assertSha(newSha);
  /** Line ending to write back. Mixed files follow the first break that appears. */
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  /** True when `text` already ends with a newline, which the result keeps. */
  const trailing = /\r?\n$/.test(text);
  /** Lines without the terminator the split turned into a final empty element. */
  let lines = text.length === 0 ? [] : text.split(/\r?\n/);
  if (trailing && lines.at(-1) === '') lines = lines.slice(0, -1);
  /** True once at least one matching row has been rewritten. */
  let found = false;
  lines = lines.map((line) => {
    /** Trimmed line used to skip comments and blanks without altering formatting. */
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) return line;
    /** Raw comma-separated columns, keeping surrounding spaces for other columns. */
    const parts = line.split(',');
    if (parts.length < 4) return line;
    /** Normalized source path to check whether this row matches `name`. */
    const source = parts[2]?.trim().replace(/\/+$/, '') ?? '';
    /** Last path segment of `source`, matching `parseLinks`. */
    const rowName = source.split('/').pop() ?? source;
    if (rowName !== name) return line;
    found = true;
    /** Leading whitespace preserved before the SHA column. */
    const leading = /^\s*/.exec(parts[1] ?? '')?.[0] ?? '';
    /** Trailing whitespace preserved after the SHA column. */
    const trailingSpace = /\s*$/.exec(parts[1] ?? '')?.[0] ?? '';
    parts[1] = `${leading}${newSha}${trailingSpace}`;
    return parts.join(',');
  });
  if (!found) throw new Error(`No '${name}' row found in links.csv.`);
  /** Body without a trailing break. The original terminator is added back below. */
  const body = lines.join(newline);
  return trailing ? `${body}${newline}` : body;
}

/**
 * Refuse a commit that git could parse as an option, or that `git fetch` cannot resolve.
 * Throws when `sha` is not a full SHA-1 or SHA-256 object id.
 */
export function assertSha(sha: string): void {
  if (SHA.test(sha)) return;
  throw new Error(`Vendor commit '${sha}' is not a full hex sha.`);
}

/**
 * Refuse a path git or `rm` could treat as an option or as a traversal.
 * `value` must be relative, with no `..` segment and no leading `-`.
 */
export function assertRepoPath(label: string, value: string): void {
  if (value.startsWith('-') || value.startsWith('/') || value.split('/').includes('..')) {
    throw new Error(`Vendor ${label} '${value}' must be a relative path inside the repository.`);
  }
}

/**
 * Throw when `target` is not `root` and not a path inside it.
 * Comparison is on resolved paths, so `..` and absolute joins cannot slip past.
 */
export function assertInside(root: string, target: string): void {
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
 * Validate `row` and compute its cache directory `<project>/<destDir>/<name>/<sha>`.
 * Throws when the SHA, remote URL, or paths are unsafe or leave `projectDir`.
 */
export function vendorDest(
  projectDir: string,
  row: VendorRow,
): { destParent: string; dest: string } {
  assertSha(row.sha);
  if (row.repo.startsWith('-')) {
    throw new Error(`Vendor repo '${row.repo}' must not be a git option.`);
  }
  assertRepoPath('source', row.source);
  assertRepoPath('destination', row.destDir);
  /** Parent directory holding per-commit checkouts for `row.name`. */
  const destParent = resolve(projectDir, row.destDir, row.name);
  /** Cache directory for this exact commit SHA. */
  const dest = join(destParent, row.sha);
  assertInside(projectDir, dest);
  return { destParent, dest };
}

/**
 * Read the `localnet` row from `<projectDir>/links.csv`, or null when the file or row is absent.
 * Any filesystem error other than ENOENT is rethrown.
 */
export function readLocalnetRow(projectDir: string): VendorRow | null {
  /** Raw contents of `links.csv`, or null when the checkout does not ship one. */
  let text: string;
  try {
    text = readFileSync(join(projectDir, 'links.csv'), 'utf8');
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
  return parseLinks(text).find((row) => row.name === 'localnet') ?? null;
}

/**
 * Cache directory for the pinned `localnet` commit in `<projectDir>/links.csv`,
 * or null when `links.csv` is absent or has no `localnet` row.
 */
export function localnetCacheDir(projectDir: string): string | null {
  /** Pinned LocalNet entry from `links.csv`. */
  const row = readLocalnetRow(projectDir);
  if (row === null) return null;
  return vendorDest(projectDir, row).dest;
}

/**
 * Git commands that perform a shallow sparse checkout of one `links.csv` row into `tmp`.
 * Checked against `quickstart/Makefile` in `makefile.test.ts` so both paths stay aligned.
 */
export function vendorGitSteps(tmp: string, repo: string, source: string, sha: string): string[][] {
  return [
    ['git', 'init', '--quiet', tmp],
    ['git', '-C', tmp, 'remote', 'add', 'origin', repo],
    ['git', '-C', tmp, 'sparse-checkout', 'set', '--cone', source],
    ['git', '-C', tmp, 'fetch', '--depth', '1', '--filter=blob:none', 'origin', sha],
    ['git', '-C', tmp, 'checkout', '--quiet', '--detach', 'FETCH_HEAD'],
  ];
}

/**
 * Git command that applies one patch file to the checked-out `source` tree inside `tmp`.
 * Checked against `quickstart/Makefile` in `makefile.test.ts` so both paths stay aligned.
 */
export function vendorPatchCmd(tmp: string, source: string, patchFile: string): string[] {
  return ['git', '-C', tmp, 'apply', `--directory=${source}`, patchFile];
}

/**
 * List `*.patch` files in `patchesDir` in deterministic lexicographical order.
 * Returns an empty array when `patchesDir` does not exist.
 */
async function listPatchFiles(patchesDir: string): Promise<string[]> {
  /** Directory entries, or empty when no patches directory exists yet. */
  let entries: Array<{ name: string; isFile(): boolean }>;
  try {
    entries = await readdir(patchesDir, { withFileTypes: true });
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.patch'))
    .map((entry) => entry.name)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((name) => join(patchesDir, name));
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
  leafName: string,
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
      await rename(dest, join(aside, leafName));
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
      await rename(join(aside, leafName), dest);
      await rm(aside, { recursive: true, force: true });
    }
    throw error;
  }
  if (aside !== undefined) await rm(aside, { recursive: true, force: true });
}

/**
 * Fetch one `links.csv` row into its commit-keyed cache directory and apply any patches
 * from `<modulesDir>/<name>-overrides/patches/*.patch`.
 * Returns the failing git exit status, or 0 when the cache directory was populated.
 * A failed patch throws loudly and leaves any existing cache directory untouched.
 */
export async function fetchVendorRow(
  ctx: CommandContext,
  projectDir: string,
  row: VendorRow,
  modulesDir?: string,
): Promise<number> {
  /** Validated cache parent and commit-keyed destination directory. */
  const { destParent, dest } = vendorDest(projectDir, row);
  /** Directory holding optional escape-hatch patches applied after checkout. */
  const patchesDir = join(
    modulesDir ?? join(projectDir, 'docker', 'modules'),
    `${row.name}-overrides`,
    'patches',
  );
  ctx.io.note(`Fetching ${row.source} from ${row.repo} at ${row.sha} to ${dest}\n`);
  if (ctx.dryRun) return 0;
  await mkdir(destParent, { recursive: true });
  /** Sparse checkout beside `dest`. Removed in `finally`, including when git or patching fails. */
  const tmp = await mkdtemp(join(destParent, '.qs-vendor-'));
  try {
    /** Git commands that sparsely fetch the pinned commit into `tmp`. */
    const steps = vendorGitSteps(tmp, row.repo, row.source, row.sha);
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
    /** Patches to apply in order before moving the tree into the cache. */
    const patches = await listPatchFiles(patchesDir);
    for (const patchFile of patches) {
      /** Status of `git apply`. Any failure aborts before touching `dest`. */
      const status = await loggedRun(
        ctx.io,
        ctx.runner,
        vendorPatchCmd(tmp, row.source, patchFile),
        {
          cwd: projectDir,
          env: definedEnv(ctx.env),
        },
      );
      if (status !== 0) {
        throw new Error(
          `Patch '${basename(patchFile)}' failed to apply to ${row.name} at ${row.sha}.`,
        );
      }
    }
    await replaceDest(dest, source, destParent, row.sha);
    ctx.io.note(`Cached ${dest}\n`);
    return 0;
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

/**
 * Ensure the cached LocalNet directory exists before Compose runs.
 * Does nothing when `LOCALNET_DIR` was explicitly overridden, when the cache directory
 * already exists, or when `links.csv` has no `localnet` entry.
 */
export async function ensureLocalnet(ctx: CommandContext, project: Project): Promise<number> {
  if (project.settings.localnetDirExplicit) return 0;
  try {
    await access(project.settings.localnetDir);
    return 0;
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
  /** LocalNet row from `links.csv`. Absent in checkouts that bundle LocalNet without `links.csv`. */
  const row = readLocalnetRow(project.dir);
  if (row === null) return 0;
  return fetchVendorRow(ctx, project.dir, row, project.settings.modulesDir);
}

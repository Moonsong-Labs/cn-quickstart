// Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: 0BSD

import type { Dirent } from 'node:fs';
import { access, cp, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Command } from 'commander';
import type { CommandContext } from '../lib/context.ts';
import { definedEnv, loggedRun } from '../lib/exec.ts';
import { projectFromContext } from '../lib/project.ts';
import type { CommandDeps } from '../lib/register.ts';

/** What `qs versions sync` should do beyond printing the versions. */
export type SyncOptions = {
  /** Network name used in `docs.<network>.global.canton.network`. Defaults to `dev` at the command. */
  network: string;
  /** Create the git tag `splice-<version>` when true. */
  tag: boolean;
  /** Replace an existing tag of that name. Without this, an existing tag is an error. */
  force: boolean;
  /** Copy DARs and the token-standard tests from a sibling `splice` checkout. */
  copy: boolean;
};

/**
 * Read `sdk-version` from a `daml.yaml` body.
 * Comments are stripped and the first matching line wins, as `damlSdkVersion` does.
 * Returns undefined when the key is absent.
 */
export function readSdkLine(text: string): string | undefined {
  for (const raw of text.split(/\r?\n/)) {
    /** Line with an inline comment removed. */
    const line = raw.split('#')[0]?.trim() ?? '';
    if (line.startsWith('sdk-version:')) return line.slice('sdk-version:'.length).trim();
  }
  return undefined;
}

/**
 * Replace every `sdk-version:` line and leave the rest of the file untouched.
 * A file that uses CRLF keeps CRLF, including a trailing newline.
 */
export function rewriteSdkVersion(text: string, version: string): string {
  /** Line ending to write back. Mixed files follow the first break that appears. */
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^(\s*sdk-version:\s*).*$/, `$1${version}`))
    .join(newline);
}

/**
 * Version written into `.env`, `daml.yaml`, and a git tag.
 * A pre-release or build suffix is allowed. Anything else, including a newline, is refused.
 */
const PUBLISHED_VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

/**
 * Throw when `value` is not a version this command will write.
 * `kind` is the label in the error, such as `Splice version`.
 */
function requireVersion(kind: string, value: string): void {
  if (PUBLISHED_VERSION.test(value)) return;
  throw new Error(`Refusing ${kind} ${JSON.stringify(value)}. Expected a version like 0.5.0.`);
}

/** Tag name for a published Splice version. */
function spliceTag(version: string): string {
  return `splice-${version}`;
}

/** Message stored on `splice-<version>`. */
function spliceTagMessage(version: string): string {
  return `Works against Canton Network version running ${version}`;
}

/**
 * Replace `KEY=` lines and keep the file's own newline style.
 * A trailing newline stays. CRLF stays CRLF. A missing key is appended.
 * A file with no trailing newline is still written without one.
 */
export function rewriteEnvAssignment(text: string, key: string, value: string): string {
  /** Line ending to write back. Mixed files follow the first break that appears. */
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  /** True when `text` already ends with a newline, which the result keeps. */
  const trailing = /\r?\n$/.test(text);
  /** Lines without the terminator the split turned into a final empty element. */
  let lines = text.length === 0 ? [] : text.split(/\r?\n/);
  if (trailing && lines.at(-1) === '') lines = lines.slice(0, -1);
  /** True once a `KEY=` line has been replaced, so the key is not also appended. */
  let found = false;
  lines = lines.map((line) => {
    if (!line.startsWith(`${key}=`)) return line;
    found = true;
    return `${key}=${value}`;
  });
  if (!found) lines.push(`${key}=${value}`);
  /** Body without a trailing break. The original terminator is added back below. */
  const body = lines.join(newline);
  return trailing ? `${body}${newline}` : body;
}

/**
 * Point the checkout at the Splice version published for `network`.
 * Writes `sdk-version` in every `daml.yaml` under `daml/` and `SPLICE_VERSION` in `.env`.
 * `DAML_RUNTIME_VERSION` is left as it is, because it is the ledger API proto version.
 * `--dry-run` prints the same lines and writes nothing.
 */
export async function runVersionsSync(ctx: CommandContext, options: SyncOptions): Promise<number> {
  /** Checkout whose manifests and `.env` are updated. */
  const project = projectFromContext(ctx);
  /** Published synchronizer version, and the migration id printed alongside it. */
  const published = await publishedVersion(ctx, options.network);
  requireVersion('Splice version', published.version);
  /** SDK version that release line was built with. */
  const sdk = await publishedSdk(ctx, published.version);
  requireVersion('SDK version', sdk);
  ctx.io.note(`Splice ${published.version} (migration ${published.migration})\n`);
  ctx.io.note(`SDK ${sdk}\n`);
  /** Previous Splice pin, so the summary can say whether it moved. */
  const previousSplice = project.settings.splice;
  /**
   * True when the tag is already present.
   * Checked before any write, and only on a real run. `--force` is what allows it to stay.
   */
  let tagExists = false;
  if (options.tag && !ctx.dryRun) {
    tagExists = await tagExistsAt(ctx, project.dir, published.version);
    if (tagExists && !options.force) {
      throw new Error(
        `Tag ${spliceTag(published.version)} already exists. Pass --force to replace it.`,
      );
    }
  }
  if (options.copy && !ctx.dryRun) await assertSiblingSplice(project.dir);
  await rewriteManifests(ctx, project.dir, sdk);
  await rewriteSpliceVersion(ctx, project.dir, published.version);
  /** Proto pin. Reported so a person can decide whether it should move too. */
  const runtime = project.fileEnv.get('DAML_RUNTIME_VERSION');
  if (runtime !== undefined) ctx.io.note(`DAML_RUNTIME_VERSION stays ${runtime}\n`);
  if (options.copy) {
    /** Copy status. The sibling was checked above, before the manifests were written. */
    const copied = await copyFromSplice(ctx, project.dir);
    if (copied !== 0) return copied;
  }
  if (options.tag) {
    /** Tag status. A dirty tree is refused so the tag is not attached to the previous pins. */
    const tagged = await tagSplice(ctx, project.dir, published.version, tagExists);
    if (tagged !== 0) return tagged;
  }
  if (previousSplice !== published.version) {
    ctx.io.note('Run qs vendor localnet after updating links.csv.\n');
  }
  return 0;
}

/** Version and migration id from a network's `/info` document. */
type Published = {
  /** `synchronizer.current.version`. */
  version: string;
  /** `sv.migration_id` printed as text, or `unknown` when the field is absent. */
  migration: string;
};

/**
 * Fetch the network info document and read the current synchronizer version.
 * Throws when the request fails or the version is not a string. The old `synchronizer.active` shape throws too.
 */
async function publishedVersion(ctx: CommandContext, network: string): Promise<Published> {
  /** Info URL. `dev`, `test`, and `main` are the networks the endpoint publishes. */
  const url = `https://docs.${network}.global.canton.network.sync.global/info`;
  /** Response. A non-200 is the same failure as a missing version. */
  const response = await (ctx.fetch ?? fetch)(url);
  if (!response.ok) throw new Error(`Could not read the Splice version for '${network}'.`);
  /** Parsed body. Only two fields are read. */
  const body = (await response.json()) as {
    synchronizer?: { current?: { version?: unknown } };
    sv?: { migration_id?: unknown };
  };
  /** Published version. Anything other than a non-empty string is a refusal. */
  const version = body.synchronizer?.current?.version;
  if (typeof version !== 'string' || version.length === 0) {
    throw new Error(`Could not read the Splice version for '${network}'.`);
  }
  /** Migration id, when the document has one. */
  const migration = body.sv?.migration_id;
  return {
    version,
    migration: migration === undefined || migration === null ? 'unknown' : String(migration),
  };
}

/**
 * Read `sdk-version` from the Splice release line's `daml.yaml`.
 * Throws when the file cannot be fetched or has no such line.
 */
async function publishedSdk(ctx: CommandContext, version: string): Promise<string> {
  /** Raw manifest for that release line. `canton-network/splice` is the repository `links.csv` uses. */
  const url = `https://raw.githubusercontent.com/canton-network/splice/refs/heads/release-line-${version}/daml.yaml`;
  /** Response. A missing branch is reported as a missing SDK version. */
  const response = await (ctx.fetch ?? fetch)(url);
  if (!response.ok) throw new Error(`Could not read the SDK version for Splice ${version}.`);
  /** SDK version. Undefined means the manifest did not contain the key. */
  const sdk = readSdkLine(await response.text());
  if (sdk === undefined || sdk.length === 0) {
    throw new Error(`Could not read the SDK version for Splice ${version}.`);
  }
  return sdk;
}

/**
 * Rewrite `sdk-version` in every `daml.yaml` under `daml/`.
 * Directories named `.daml` or `node_modules` are not walked. `--dry-run` prints the change only.
 */
async function rewriteManifests(
  ctx: CommandContext,
  projectDir: string,
  sdk: string,
): Promise<void> {
  /** Manifests in walk order. */
  const files = await damlYamlFiles(join(projectDir, 'daml'));
  for (const file of files) {
    /** Current text, including its line ending style. */
    const text = await readFile(file, 'utf8');
    /** Version already in the file, printed so a no-op is visible. */
    const current = readSdkLine(text) ?? '(none)';
    ctx.io.note(`${file}: sdk-version ${current} -> ${sdk}\n`);
    if (!ctx.dryRun) await writeFile(file, rewriteSdkVersion(text, sdk));
  }
}

/**
 * Set `SPLICE_VERSION` in `.env`, keeping every other line.
 * `--dry-run` prints the change and does not write.
 */
async function rewriteSpliceVersion(
  ctx: CommandContext,
  projectDir: string,
  version: string,
): Promise<void> {
  /** Path of the project env file. It is a project marker, so it exists. */
  const path = join(projectDir, '.env');
  /** Current text. */
  const text = await readFile(path, 'utf8');
  ctx.io.note(`.env: SPLICE_VERSION -> ${version}\n`);
  if (!ctx.dryRun) {
    await writeFile(path, rewriteEnvAssignment(text, 'SPLICE_VERSION', version));
  }
}

/** Sibling Splice checkout, two directories above `quickstart/`. The path `sync-network.sh` used. */
function siblingSpliceDir(projectDir: string): string {
  return join(projectDir, '..', '..', 'splice');
}

/**
 * Throw when the sibling Splice checkout cannot supply a copy.
 * Requires the checkout itself, `daml/dars`, and `token-standard/splice-token-standard-test`.
 * Called before `versions sync` writes, so a missing path does not leave a half-updated tree.
 */
async function assertSiblingSplice(projectDir: string): Promise<void> {
  /** Checkout two directories above `quickstart/`. */
  const sibling = siblingSpliceDir(projectDir);
  /** Paths `copyFromSplice` reads. The first missing one is the error. */
  const required = [
    sibling,
    join(sibling, 'daml', 'dars'),
    join(sibling, 'token-standard', 'splice-token-standard-test'),
  ];
  for (const path of required) {
    try {
      await access(path);
    } catch {
      throw new Error(`No sibling Splice checkout at ${sibling}. Missing ${path}.`);
    }
  }
}

/**
 * True when `refs/tags/splice-<version>` already resolves.
 * A non-zero exit from `git rev-parse` means the tag is not there. The caller decides whether that is an error.
 */
async function tagExistsAt(
  ctx: CommandContext,
  projectDir: string,
  version: string,
): Promise<boolean> {
  /** Lookup. Status 0 means the tag is already there. */
  const existing = await ctx.runner.capture(
    ['git', 'rev-parse', '--verify', '--quiet', `refs/tags/${spliceTag(version)}`],
    { cwd: projectDir, env: definedEnv(ctx.env) },
  );
  return existing.code === 0;
}

/**
 * True when git reports any staged, unstaged, or untracked change.
 * Throws when `git status` itself fails, because a tag must not be guessed.
 */
async function workingTreeDirty(ctx: CommandContext, projectDir: string): Promise<boolean> {
  /** Porcelain status. Empty output is a clean tree. */
  const result = await ctx.runner.capture(['git', 'status', '--porcelain'], {
    cwd: projectDir,
    env: definedEnv(ctx.env),
  });
  if (result.code !== 0) throw new Error('Could not read git status before tagging.');
  return result.stdout.trim().length > 0;
}

/**
 * Create `splice-<version>` on the current commit when the working tree is clean.
 * `exists` was decided before the rewrite. A dirty tree throws with the tag command to run
 * after committing, and does not create the tag. `--dry-run` prints the tag and does not run git.
 */
async function tagSplice(
  ctx: CommandContext,
  projectDir: string,
  version: string,
  exists: boolean,
): Promise<number> {
  /** Tag name the old script used. */
  const tag = spliceTag(version);
  if (ctx.dryRun) {
    ctx.io.note(`Would tag ${tag}\n`);
    return 0;
  }
  if (await workingTreeDirty(ctx, projectDir)) {
    /** Delete line, included only when `--force` is about to replace a tag that is already there. */
    const drop = exists ? `git tag -d ${tag}\n` : '';
    throw new Error(
      `Commit the version update before tagging ${tag}. Then run:\n${drop}git tag ${tag} -m "${spliceTagMessage(version)}"`,
    );
  }
  if (exists) {
    /** Delete status. A failure is returned; the new tag is not created. */
    const removed = await loggedRun(ctx.io, ctx.runner, ['git', 'tag', '-d', tag], {
      cwd: projectDir,
      env: definedEnv(ctx.env),
    });
    if (removed !== 0) return removed;
  }
  return loggedRun(ctx.io, ctx.runner, ['git', 'tag', tag, '-m', spliceTagMessage(version)], {
    cwd: projectDir,
    env: definedEnv(ctx.env),
  });
}

/**
 * Copy DARs that already exist in `daml/dars` from the sibling checkout, then copy the token-standard tests.
 * `assertSiblingSplice` has already required those paths. `--dry-run` prints them and copies nothing.
 */
async function copyFromSplice(ctx: CommandContext, projectDir: string): Promise<number> {
  /** Sibling Splice checkout, two directories above `quickstart/`. */
  const sibling = siblingSpliceDir(projectDir);
  /** DAR directory and the token-standard tests. Printed on a dry run before any copy. */
  const dars = join(sibling, 'daml', 'dars');
  /** Token-standard tests copied into `daml/external-test-sources`. */
  const tests = join(sibling, 'token-standard', 'splice-token-standard-test');
  if (ctx.dryRun) {
    ctx.io.note(`Would copy DARs from ${dars}\n`);
    ctx.io.note(`Would copy ${tests}\n`);
    return 0;
  }
  await copyExistingDars(dars, join(projectDir, 'daml', 'dars'));
  await cp(tests, join(projectDir, 'daml', 'external-test-sources', 'splice-token-standard-test'), {
    recursive: true,
    force: true,
  });
  ctx.io.note('Copied DARs and splice-token-standard-test.\n');
  return 0;
}

/**
 * Copy `.dar` files from `source` over the same names in `dest`.
 * A DAR that is not already in `dest` is skipped, matching `rsync --existing`. `daml.yaml` is not a DAR.
 */
async function copyExistingDars(source: string, dest: string): Promise<void> {
  /** Names in the source directory. A missing directory throws from `readdir`. */
  const names = await readdir(source);
  for (const name of names) {
    if (!name.endsWith('.dar')) continue;
    /** Destination file. Absence means this DAR is not one the checkout already vendors. */
    const target = join(dest, name);
    try {
      await access(target);
    } catch {
      continue;
    }
    await cp(join(source, name), target);
  }
}

/**
 * Paths of `daml.yaml` files under `dir`.
 * `.daml` and `node_modules` are not entered. A missing `dir` returns an empty list.
 */
async function damlYamlFiles(dir: string): Promise<string[]> {
  /** Collected paths. */
  const found: string[] = [];
  /**
   * Walk `current`. Files named `daml.yaml` are recorded; the two skipped directories are not entered.
   */
  async function walk(current: string): Promise<void> {
    /** Entries. A missing directory ends this branch. */
    let entries: Dirent[];
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === '.daml' || entry.name === 'node_modules') continue;
      /** Full path of this entry. */
      const path = join(current, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.name === 'daml.yaml') found.push(path);
    }
  }
  await walk(dir);
  return found;
}

/**
 * Register `qs versions sync`.
 * The network defaults to `dev`. `--dry-run` fetches and writes nothing.
 */
export function registerVersions(program: Command, deps: CommandDeps): void {
  /** Version group. Sync is the only versions command. */
  const versions = deps
    .addSharedOptions(program.command('versions'))
    .description('Update the Splice and SDK pins');
  deps
    .addSharedOptions(versions.command('sync'))
    .description('Point daml.yaml and SPLICE_VERSION at a Canton Network')
    .argument('[network]', 'Network name: dev, test, or main', 'dev')
    .option('--tag', 'Tag splice-<version> when the working tree is clean after the update')
    .option('--force', 'Replace an existing splice-<version> tag')
    .option('--copy', 'Copy DARs and token-standard tests from a sibling splice checkout')
    .action(async (network: string, _local: unknown, command: Command) => {
      /** Flags that change what sync writes. Absent flags stay false. */
      const opts = command.opts<{ tag?: boolean; force?: boolean; copy?: boolean }>();
      await deps.run(command, (ctx) =>
        runVersionsSync(ctx, {
          network,
          tag: opts.tag === true,
          force: opts.force === true,
          copy: opts.copy === true,
        }),
      );
    });
}

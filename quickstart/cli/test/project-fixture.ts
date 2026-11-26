// Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: 0BSD

import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Directories `afterEach` should delete. Each test file keeps its own list. */
export function projectCleaner(): { dirs: string[]; cleanup(): Promise<void> } {
  /** Temp directories created by `tempProject`. */
  const dirs: string[] = [];
  return {
    dirs,
    /** Delete every recorded directory and clear the list. */
    async cleanup() {
      await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
    },
  };
}

/**
 * Create a throwaway quickstart checkout with `.env`, `docker/modules`, and a Daml manifest.
 * `envLocal` is written as `.env.local` when given. The Daml manifest exists so `dpmBuild` can read it.
 * When `nested` is true, the checkout is `repo/quickstart` under the temp root, so a path two
 * directories above it (the sibling Splice checkout) stays inside that root.
 */
export async function tempProject(
  dirs: string[],
  envLocal?: string,
  nested = false,
): Promise<string> {
  /** Temp root `cleanup` deletes. With `nested`, the checkout's parent is `repo/` under this root. */
  const root = join(tmpdir(), `qs-project-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  /** The checkout itself. This is what `--project` points at. */
  const dir = nested ? join(root, 'repo', 'quickstart') : join(root, 'quickstart');
  await mkdir(join(dir, 'docker', 'modules'), { recursive: true });
  await mkdir(join(dir, 'daml', 'licensing'), { recursive: true });
  await writeFile(join(dir, '.env'), 'SPLICE_VERSION=0.10.2\nDOCKER_NETWORK=quickstart\n');
  await writeFile(join(dir, 'daml', 'licensing', 'daml.yaml'), 'sdk-version: 3.7.1\n');
  if (envLocal !== undefined) await writeFile(join(dir, '.env.local'), envLocal);
  dirs.push(root);
  return dir;
}

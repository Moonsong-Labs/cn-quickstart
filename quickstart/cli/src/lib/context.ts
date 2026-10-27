// Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: 0BSD

import type { Runner } from './exec.ts';
import type { PromptIo } from './prompts.ts';

/**
 * Everything a lifecycle command needs from the process and the parser.
 * `runner` is real, dry-run, or a fake supplied by tests.
 */
export type CommandContext = {
  /** Stdout for prompts and stderr for progress. */
  io: PromptIo;
  /** Environment used for defaults and passed to children. Defaults to `process.env`. */
  env: Record<string, string | undefined>;
  /** Working directory the project search starts from. */
  cwd: string;
  /** CLI source directory, used when the working directory is not a project. */
  cliDir: string;
  /** True when `--dry-run` was set. Compose and builds print commands and do not spawn them. */
  dryRun: boolean;
  /** `--project`, when the user passed one. Relative paths are resolved against `cwd`. */
  project?: string;
  /** How host commands are spawned. */
  runner: Runner;
};

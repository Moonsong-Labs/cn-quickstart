// Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: 0BSD

import type { Command } from 'commander';
import type { CommandContext } from './context.ts';

/**
 * What a command module needs to attach itself to `qs`.
 * `run` builds the context, including `--dry-run` and `--project` from every parent command.
 */
export type CommandDeps = {
  /** Add `--dry-run` and `--project`. The root and every command get both. */
  addSharedOptions(command: Command): Command;
  /**
   * Run `fn` and turn a non-zero status into an `ExitError`.
   * The context uses the flags parsed for `command`.
   */
  run(command: Command, fn: (ctx: CommandContext) => Promise<number>): Promise<void>;
  /**
   * Resolve the project and run setup.
   * Setup does not use `run`, because it prompts before a Compose context exists.
   */
  executeSetup(command: Command): Promise<void>;
};

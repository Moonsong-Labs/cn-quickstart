// Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: 0BSD

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command, CommanderError } from 'commander';
import { registerBuild } from './commands/build.ts';
import { registerConsole } from './commands/console.ts';
import { registerDemo } from './commands/demo.ts';
import { registerDev } from './commands/dev.ts';
import { registerDoctor } from './commands/doctor.ts';
import { registerOpen } from './commands/open.ts';
import { registerSetup, runSetup } from './commands/setup.ts';
import { registerStack } from './commands/stack.ts';
import { registerTest } from './commands/testing.ts';
import { registerVendor } from './commands/vendor.ts';
import { registerVersions } from './commands/versions.ts';
import type { CommandContext, FetchLike } from './lib/context.ts';
import { type Runner, selectRunner } from './lib/exec.ts';
import { ExitError, exitUnless } from './lib/exit.ts';
import { resolveProjectRoot } from './lib/paths.ts';
import { createStdioPrompt, type PromptIo } from './lib/prompts.ts';
import type { CommandDeps } from './lib/register.ts';
import { bad, paint } from './lib/style.ts';

/** Directory of this source file. Project discovery walks up from here when the working directory is not a project. */
const cliDir = dirname(fileURLToPath(import.meta.url));

/**
 * Flags that belong to `setup`. Using one of them with no command is a usage error,
 * so a typo does not fall through to top-level help and exit 0.
 */
const SETUP_ONLY = new Set(['auth-mode', 'party-hint', 'test-mode', 'yes']);

/** Flags shared by every command. Accepted before the command name and after it. */
type SharedFlags = {
  /** True when `--dry-run` was set. Commands must not write files. */
  dryRun?: boolean;
  /** `--project` path, relative to the working directory when not absolute. */
  project?: string;
};

/** `setup` flags. A missing string means the command should prompt, unless `--yes` accepts the default. */
type SetupFlags = SharedFlags & {
  authMode?: string;
  partyHint?: string;
  testMode?: string;
  /** True when `--yes` was set. False when the flag was absent. */
  yes?: boolean;
};

/** Overrides tests pass into `runCli`. Omitted fields use the real process. */
type RunOptions = {
  /** Working directory for relative `--project` and for the upward search. Defaults to `process.cwd()`. */
  cwd?: string;
  /** Environment for defaults and `QS_DEBUG`. Defaults to `process.env`. */
  env?: Record<string, string | undefined>;
  /** Start of the fallback project search. Defaults to this source file's directory. */
  cliDir?: string;
  /** Host-command runner. Tests inject one. Otherwise `--dry-run` selects a runner that does not spawn. */
  runner?: Runner;
  /** Fetch used by `versions sync`. Tests pass a stub. Defaults to `globalThis.fetch`. */
  fetch?: FetchLike;
};

/**
 * Parse `argv` and run one command. Returns a process status: 0 success, 1 command failure, 2 usage error.
 * `--help` and `--version` are handled before the project directory is resolved.
 * An unknown flag or command exits 2. A thrown command error exits 1 with the message on stderr,
 * unless `QS_DEBUG=1`, which also prints the stack. This function does not call `process.exit`.
 */
export async function runCli(argv: string[], io: PromptIo, options?: RunOptions): Promise<number> {
  /** Fresh program for this invocation, so one call cannot leak flags into the next. */
  const program = createProgram(io, options);
  try {
    await program.parseAsync(argv, { from: 'user' });
    return 0;
  } catch (error) {
    if (error instanceof ExitError) {
      if (error.message.length > 0) io.note(`${bad(error.message)}\n`);
      return error.status;
    }
    if (error instanceof CommanderError) return writeUsageError(program, error, io);
    /** Message shown to the user. The stack is added only when `QS_DEBUG=1`. */
    const message = error instanceof Error ? error.message : String(error);
    io.note(`${bad(message)}\n`);
    if ((options?.env ?? process.env).QS_DEBUG === '1' && error instanceof Error) {
      io.note(`${paint('dim', error.stack ?? '')}\n`);
    }
    return 1;
  }
}

/**
 * Build the program. `exitOverride` and `configureOutput` are set before subcommands are added
 * so each subcommand inherits them and `parseAsync` throws instead of calling `process.exit`.
 * Positional options are on so `compose` can pass unknown flags through after its arguments.
 * Each command module registers itself. The helpers it calls are defined below.
 */
function createProgram(io: PromptIo, options?: RunOptions): Command {
  /** Root command. The name is `qs` even when the file is launched through `bun`. */
  const program = new Command();
  program
    .name('qs')
    .description('Run a local Canton Network quickstart.')
    .helpOption('-h, --help', 'Show help')
    .addHelpText('beforeAll', () => `${paint('bold', 'Canton Network Quickstart')}\n`)
    .configureHelp({
      styleTitle: (text: string) => paint('bold', text),
      styleCommandText: (text: string) => paint(['bold', 'cyan'], text),
      styleSubcommandText: (text: string) => paint('cyan', text),
      styleOptionText: (text: string) => paint('green', text),
      styleArgumentText: (text: string) => paint('yellow', text),
      styleDescriptionText: (text: string) => paint('dim', text),
    })
    .configureOutput({
      writeOut(text: string) {
        io.write(text);
      },
      writeErr(text: string) {
        io.note(text);
      },
      outputError(_text: string, _write: (text: string) => void) {
        // runCli writes the message, so usage errors share one exit code.
      },
    })
    .exitOverride()
    .enablePositionalOptions()
    .version(readVersion(), '-v, --version', 'Show version')
    .helpCommand('help [command]', 'Show help for a command');
  addSharedOptions(program);

  /**
   * Hooks the command modules use. `run` is declared below and hoisted,
   * so it is available when a command action later calls it.
   */
  const deps: CommandDeps = {
    addSharedOptions,
    run,
    executeSetup: (command) => executeSetup(command, io, options),
  };
  registerSetup(program, deps);
  registerDoctor(program, deps);
  registerBuild(program, deps);
  registerStack(program, deps);
  registerOpen(program, deps);
  registerConsole(program, deps);
  registerDemo(program, deps);
  registerTest(program, deps);
  registerDev(program, deps);
  registerVersions(program, deps);
  registerVendor(program, deps);

  return program;

  /**
   * Build the context for `command` and run `fn`.
   * A non-zero status becomes an `ExitError`, so `runCli` does not report success.
   */
  async function run(
    command: Command,
    fn: (ctx: CommandContext) => Promise<number>,
  ): Promise<void> {
    exitUnless(await fn(commandContext(command)));
  }

  /**
   * Context for one action. `--dry-run` and `--project` are read from both sides of the command name.
   */
  function commandContext(command: Command): CommandContext {
    /** Shared flags, with the subcommand winning when both sides set one. */
    const flags = mergedFlags(command);
    /** True when this invocation must not spawn builds or Compose. */
    const dryRun = flags.dryRun === true;
    return {
      io,
      env: options?.env ?? process.env,
      cwd: options?.cwd ?? process.cwd(),
      cliDir: options?.cliDir ?? cliDir,
      dryRun,
      ...(flags.project !== undefined ? { project: flags.project } : {}),
      runner: selectRunner(dryRun, options?.runner),
      ...(options?.fetch !== undefined ? { fetch: options.fetch } : {}),
    };
  }
}

/**
 * Version string from this package's `package.json`, read from disk so it stays aligned with the package.
 */
function readVersion(): string {
  /** Path to `quickstart/cli/package.json`, one directory above this source file. */
  const path = join(cliDir, '..', 'package.json');
  /** Parsed package manifest. Only `version` is used. */
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as { version: string };
  return parsed.version;
}

/**
 * Add `--dry-run` and `--project` to a command.
 * The root command and each subcommand both get them, so the flags work on either side of the command name.
 */
function addSharedOptions(command: Command): Command {
  return command
    .option('--dry-run', 'Print what would change, without writing files')
    .option(
      '--project <dir>',
      'Quickstart directory. Default: search upwards from the current directory',
    );
}

/**
 * Combine parent and subcommand copies of the shared flags.
 * A value on the subcommand wins. An unset subcommand flag keeps the parent value.
 */
function mergedFlags(command: Command): SetupFlags {
  /** Flags parsed on this command. */
  const local = command.opts<SetupFlags>();
  /**
   * Flags from every ancestor, nearest first.
   * A nested command such as `test integration` has the group and the root above it.
   */
  const ancestors: SharedFlags[] = [];
  /** Next ancestor. Null when this command is the root. */
  let parent = command.parent;
  while (parent) {
    ancestors.push(parent.opts<SharedFlags>());
    parent = parent.parent;
  }
  return {
    authMode: local.authMode,
    partyHint: local.partyHint,
    testMode: local.testMode,
    yes: local.yes === true,
    dryRun: local.dryRun === true || ancestors.some((flags) => flags.dryRun === true),
    project: local.project ?? ancestors.find((flags) => flags.project !== undefined)?.project,
  };
}

/**
 * Resolve the project directory and run setup.
 * Throws when the directory cannot be found or a flag value is rejected. Help does not reach here.
 */
async function executeSetup(command: Command, io: PromptIo, options?: RunOptions): Promise<void> {
  /** Flags from both sides of the command name. */
  const flags = mergedFlags(command);
  /** Directory the project search starts from. */
  const cwd = options?.cwd ?? process.cwd();
  /** Quickstart directory, or a thrown error when it cannot be found. */
  const projectDir = resolveProjectRoot(cwd, options?.cliDir ?? cliDir, flags.project);
  await runSetup({
    projectDir,
    io,
    env: options?.env ?? process.env,
    dryRun: flags.dryRun === true,
    yes: flags.yes === true,
    ...(flags.authMode !== undefined ? { authMode: flags.authMode } : {}),
    ...(flags.partyHint !== undefined ? { partyHint: flags.partyHint } : {}),
    ...(flags.testMode !== undefined ? { testMode: flags.testMode } : {}),
  });
}

/**
 * Write a Commander usage error and return 2.
 * Help and version have already been written by Commander and return 0.
 * A setup-only flag with no command keeps the message from the previous parser.
 */
function writeUsageError(program: Command, error: CommanderError, io: PromptIo): number {
  if (
    error.code === 'commander.version' ||
    error.code === 'commander.helpDisplayed' ||
    error.code === 'commander.help'
  ) {
    return 0;
  }
  if (error.code === 'commander.unknownCommand') {
    /** Command name taken from Commander's message `unknown command 'name'`. */
    const name = /unknown command '([^']+)'/.exec(error.message)?.[1] ?? 'unknown';
    io.note(`${bad(`Unknown command: ${name}`)}\n\n`);
    program.outputHelp();
    return 2;
  }
  if (error.code === 'commander.unknownOption') {
    /** Long flag name without the leading dashes, when the message names one. */
    const flag = /unknown option '--([^']+)'/.exec(error.message)?.[1];
    if (flag !== undefined && SETUP_ONLY.has(flag)) {
      const message =
        flag === 'yes'
          ? '--yes needs a command (setup or clean).'
          : `--${flag} is only valid with setup.`;
      io.note(`${bad(message)}\n`);
      return 2;
    }
  }
  io.note(`${bad(error.message)}\n`);
  return 2;
}

if (import.meta.main) {
  /** Real terminal. Closed in `finally` so a prompt error still releases stdin. */
  const io = createStdioPrompt();
  try {
    process.exitCode = await runCli(process.argv.slice(2), io);
  } finally {
    io.close();
  }
}

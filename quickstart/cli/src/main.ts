// Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: 0BSD

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command, CommanderError, Option } from 'commander';
import { runSetup } from './commands/setup.ts';
import { resolveProjectRoot } from './lib/paths.ts';
import { createStdioPrompt, type PromptIo } from './lib/prompts.ts';
import { aside, bad, paint } from './lib/style.ts';

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
};

/**
 * Parse `argv` and run one command. Returns a process status: 0 success, 1 command failure, 2 usage error.
 * `--help` and `--version` are handled before the project directory is resolved.
 * An unknown flag or command exits 2. A thrown command error exits 1 with the message only,
 * unless `QS_DEBUG=1`, which also prints the stack. This function does not call `process.exit`.
 */
export async function runCli(argv: string[], io: PromptIo, options?: RunOptions): Promise<number> {
  /** Fresh program for this invocation, so one call cannot leak flags into the next. */
  const program = createProgram(io, options);
  try {
    await program.parseAsync(argv, { from: 'user' });
    return 0;
  } catch (error) {
    if (error instanceof CommanderError) return writeUsageError(program, error, io);
    /** Message shown to the user. The stack is added only when `QS_DEBUG=1`. */
    const message = error instanceof Error ? error.message : String(error);
    io.write(`${bad(message)}\n`);
    if ((options?.env ?? process.env).QS_DEBUG === '1' && error instanceof Error) {
      io.write(`${paint('dim', error.stack ?? '')}\n`);
    }
    return 1;
  }
}

/**
 * Build the program. `exitOverride` and `configureOutput` are set before subcommands are added
 * so each subcommand inherits them and `parseAsync` throws instead of calling `process.exit`.
 * Add a command here. The helpers it calls are defined below.
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
        io.write(text);
      },
      outputError(_text: string, _write: (text: string) => void) {
        // runCli writes the message, so usage errors share one exit code.
      },
    })
    .exitOverride()
    .version(readVersion(), '-v, --version', 'Show version')
    .helpCommand('help [command]', 'Show help for a command');
  addSharedOptions(program);

  /** `setup` subcommand. Shared flags are registered here too, so they work after the command name. */
  const setup = program
    .command('setup')
    .description('Configure auth, party hint, and test mode')
    .addHelpText('after', () =>
      [
        '',
        aside('Writes AUTH_MODE, PARTY_HINT and TEST_MODE to .env.local.'),
        aside('Prompts for any value you do not pass as a flag.'),
      ].join('\n'),
    )
    .addOption(
      new Option('--auth-mode <mode>', 'oauth2, or shared-secret').choices([
        'oauth2',
        'shared-secret',
      ]),
    )
    .option('--party-hint <hint>', 'organisation-function-number')
    .addOption(new Option('--test-mode <mode>', 'on, or off').choices(['on', 'off']))
    .option('--yes', 'Accept the default for every prompt you omit');
  addSharedOptions(setup);
  setup.action(async (_local: SetupFlags, command: Command) => {
    await executeSetup(command, io, options);
  });

  return program;
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
  /** Flags parsed after the command name. */
  const local = command.opts<SetupFlags>();
  /** Flags parsed before the command name. Absent when this is the root command. */
  const parent = command.parent?.opts<SharedFlags>() ?? {};
  return {
    authMode: local.authMode,
    partyHint: local.partyHint,
    testMode: local.testMode,
    yes: local.yes === true,
    dryRun: local.dryRun === true || parent.dryRun === true,
    project: local.project ?? parent.project,
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
    io.write(`${bad(`Unknown command: ${name}`)}\n\n`);
    program.outputHelp();
    return 2;
  }
  if (error.code === 'commander.unknownOption') {
    /** Long flag name without the leading dashes, when the message names one. */
    const flag = /unknown option '--([^']+)'/.exec(error.message)?.[1];
    if (flag !== undefined && SETUP_ONLY.has(flag)) {
      io.write(`${bad(`--${flag} is only valid with setup.`)}\n`);
      return 2;
    }
  }
  io.write(`${bad(error.message)}\n`);
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

// Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: 0BSD

/**
 * Stops a command with a process status and no extra message.
 * `runCli` turns it into the status code. An empty message is not written,
 * because the command has already explained the failure on stderr.
 */
export class ExitError extends Error {
  /** Process status. 1 is a failed command. 2 is a usage error. */
  readonly status: number;

  /** Stores `status` and an optional message. The name stays `ExitError`. */
  constructor(status: number, message = '') {
    super(message);
    this.name = 'ExitError';
    this.status = status;
  }
}

/**
 * Continue when `status` is 0. Otherwise stop the command with that status.
 * Use this at the end of a Commander action so a failed step is not reported as success.
 */
export function exitUnless(status: number): void {
  if (status !== 0) throw new ExitError(status);
}

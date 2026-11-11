/** Preserves an integration failure cause and any available command or confirmation context. */
export class LedgerApiError extends Error {
  /** Identifies the submitted command when the failure occurs during submission or decoding. */
  readonly commandId?: string;
  /** Identifies a confirmed transaction when its response supplied an ID before decoding failed. */
  readonly updateId?: string;

  /** Retains the original cause and correlation IDs without adding them to the public message. */
  constructor(message: string, options: ErrorOptions & { commandId?: string; updateId?: string }) {
    super(message, options);
    this.name = 'LedgerApiError';
    this.commandId = options.commandId;
    this.updateId = options.updateId;
  }
}

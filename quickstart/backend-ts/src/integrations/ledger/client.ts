import { LedgerClient } from '@canton-network/core-ledger-client';
import { LedgerApiError } from './error';

/** Reuses the SDK constructor contract for endpoint, token provider, and optional API version. */
type LedgerClientOptions = ConstructorParameters<typeof LedgerClient>[0];

/**
 * Constructs the SDK client and calls init() to discover the Ledger API version.
 * Wraps initialization failures in LedgerApiError; identity is verified during app bootstrap.
 */
export async function createLedgerClient(options: LedgerClientOptions): Promise<LedgerClient> {
  const client = new LedgerClient(options);

  try {
    await client.init();
  } catch (cause) {
    throw new LedgerApiError('Failed to initialize Ledger API client', { cause });
  }

  return client;
}

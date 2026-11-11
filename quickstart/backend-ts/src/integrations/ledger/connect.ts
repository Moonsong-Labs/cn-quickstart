import { readLedgerAuthConfig, readLedgerConfig } from '../../config/ledger';
import { createLedgerClient } from './client';
import { LedgerApiError } from './error';
import { createOAuthTokenProvider } from './oauth-token-provider';
import { createStaticTokenProvider } from './token-provider';

/**
 * Selects the static or OAuth token provider, initializes the SDK client, and returns
 * client and ledgerUserId. Configuration validation errors propagate unchanged. Failures
 * inside setup are wrapped in LedgerApiError, preserving existing LedgerApiError instances.
 */
export async function connectLedger(
  env: Readonly<Record<string, string | undefined>> = process.env,
) {
  const config = readLedgerConfig(env);
  const auth = readLedgerAuthConfig(env);
  try {
    const accessTokenProvider =
      auth.method === 'static'
        ? createStaticTokenProvider({ token: auth.token, ledgerUserId: config.ledgerUserId })
        : await createOAuthTokenProvider({ ...auth, ledgerUserId: config.ledgerUserId });
    const client = await createLedgerClient({ baseUrl: config.baseUrl, accessTokenProvider });

    return { client, ledgerUserId: config.ledgerUserId };
  } catch (cause) {
    if (cause instanceof LedgerApiError) throw cause;
    throw new LedgerApiError('Failed to configure Ledger API authentication', { cause });
  }
}

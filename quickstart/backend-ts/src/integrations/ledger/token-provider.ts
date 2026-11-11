import type { LedgerClient } from '@canton-network/core-ledger-client';

/** Supplies access tokens and their user context through the SDK authentication contract. */
export type LedgerTokenProvider = ConstructorParameters<
  typeof LedgerClient
>[0]['accessTokenProvider'];

/** Returns the configured token unchanged with its user ID, without decoding or renewal. */
export function createStaticTokenProvider({
  token,
  ledgerUserId,
}: {
  token: string;
  ledgerUserId: string;
}): LedgerTokenProvider {
  return {
    getAccessToken: async () => token,
    getAuthContext: async () => ({ userId: ledgerUserId, accessToken: token }),
  };
}

import * as oidc from 'openid-client';
import type { ClientCredentialsConfig } from '../../config/ledger';
import type { LedgerTokenProvider } from './token-provider';

/** Limits how long discovery and token requests may wait for the identity provider. */
const OAUTH_REQUEST_TIMEOUT_SECONDS = 10;
/** Converts OAuth expires_in seconds to the cache clock milliseconds. */
const MILLISECONDS_PER_SECOND = 1000;
/** Reserves 10% of the token lifetime for requests made before expiry. */
const RENEWAL_MARGIN_RATIO = 0.1;
/** Caps early renewal at 30 seconds to avoid refreshing long-lived tokens too soon. */
const MAX_RENEWAL_MARGIN_MS = 30_000;

/**
 * Performs OIDC discovery once and caches service tokens until their early renewal time.
 * Concurrent callers share one in-flight request. The injected clock controls expiry in tests;
 * tokens without expires_in are acquired again on the next request.
 */
export async function createOAuthTokenProvider(
  options: ClientCredentialsConfig & { ledgerUserId: string },
  now: () => number = Date.now,
): Promise<LedgerTokenProvider> {
  const configuration = await oidc.discovery(
    options.issuer,
    options.clientId,
    undefined,
    oidc.ClientSecretBasic(options.clientSecret),
    {
      timeout: OAUTH_REQUEST_TIMEOUT_SECONDS,
      execute: options.allowHttp ? [oidc.allowInsecureRequests] : undefined,
    },
  );

  let cached: { token: string; renewAt: number } | undefined;
  let pending: Promise<string> | undefined;

  /** Acquires a service token, validates its lifetime, and caches it when expiry is known. */
  async function requestToken(): Promise<string> {
    const requestedAt = now();
    const response = await oidc.clientCredentialsGrant(configuration);
    const lifetime = response.expires_in;

    if (lifetime !== undefined) {
      if (!Number.isFinite(lifetime) || lifetime <= 0) {
        throw new Error('OAuth token response must have a positive expires_in');
      }
      const lifetimeMs = lifetime * MILLISECONDS_PER_SECOND;
      if (now() >= requestedAt + lifetimeMs)
        throw new Error('OAuth token expired during acquisition');
      const margin = Math.min(MAX_RENEWAL_MARGIN_MS, lifetimeMs * RENEWAL_MARGIN_RATIO);
      cached = { token: response.access_token, renewAt: requestedAt + lifetimeMs - margin };
    }
    // Without expires_in, fetch a new token on the next request rather than caching indefinitely.
    return response.access_token;
  }

  /** Reuses an unexpired cached token or shares acquisition with concurrent callers. */
  async function getAccessToken(): Promise<string> {
    if (cached && now() < cached.renewAt) return cached.token;
    pending ??= requestToken().finally(() => {
      pending = undefined;
    });
    return pending;
  }

  return {
    getAccessToken,
    getAuthContext: async () => ({
      userId: options.ledgerUserId,
      accessToken: await getAccessToken(),
    }),
  };
}

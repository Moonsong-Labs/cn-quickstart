import { AuthMode } from './auth-mode';

/** Bounds each Ledger HTTP request; canceling the request does not roll back a submitted command. */
export const LEDGER_REQUEST_TIMEOUT_MS = 10_000;

/** Provides the participant HTTP endpoint and user ID submitted with Ledger commands. */
export interface LedgerConfig {
  baseUrl: URL;
  ledgerUserId: string;
}

/** Accepts environment values without requiring or modifying the process environment. */
type Environment = Readonly<Record<string, string | undefined>>;

/** Trims a required setting and throws a named configuration error when it is blank. */
function required(env: Environment, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required for Ledger API access`);
  return value;
}

/**
 * Reads the required endpoint and user ID. Rejects non-HTTP(S) URLs and URLs
 * containing credentials, a query, or a fragment before constructing a client.
 * HTTP requires explicit permission through LEDGER_API_ALLOW_HTTP=true.
 */
export function readLedgerConfig(env: Environment = process.env): LedgerConfig {
  const endpoint = required(env, 'LEDGER_API_URL');
  let baseUrl: URL;
  try {
    baseUrl = new URL(endpoint);
  } catch {
    throw new Error('LEDGER_API_URL must be an absolute HTTP or HTTPS URL');
  }

  if (baseUrl.protocol !== 'http:' && baseUrl.protocol !== 'https:') {
    throw new Error('LEDGER_API_URL must be an absolute HTTP or HTTPS URL');
  }
  if (baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash) {
    throw new Error('LEDGER_API_URL must not contain credentials, a query, or a fragment');
  }

  /** Requires an explicit boolean setting before sending tokens over HTTP. */
  const allowHttpValue = env.LEDGER_API_ALLOW_HTTP ?? 'false';
  if (allowHttpValue !== 'true' && allowHttpValue !== 'false') {
    throw new Error('LEDGER_API_ALLOW_HTTP must be true or false');
  }
  if (baseUrl.protocol === 'http:' && allowHttpValue !== 'true') {
    throw new Error('LEDGER_API_URL must use HTTPS, or HTTP with LEDGER_API_ALLOW_HTTP=true');
  }

  return {
    baseUrl,
    ledgerUserId: required(env, 'LEDGER_API_USER_ID'),
  };
}

/** Supplies OAuth2 service credentials and explicit permission to use an HTTP issuer. */
export interface ClientCredentialsConfig {
  method: 'client_credentials';
  issuer: URL;
  clientId: string;
  clientSecret: string;
  allowHttp: boolean;
}

/** Selects either an unchanged onboarding token or credentials for fetching service tokens. */
export type LedgerAuthConfig = { method: 'static'; token: string } | ClientCredentialsConfig;

/**
 * Defaults to shared-secret and validates settings for the selected authentication mode.
 * OAuth2 requires an HTTPS issuer unless LEDGER_OAUTH_ALLOW_HTTP=true; issuer credentials,
 * queries, and fragments are rejected. Invalid or missing settings throw before connection.
 */
export function readLedgerAuthConfig(env: Environment = process.env): LedgerAuthConfig {
  const mode = env.AUTH_MODE ?? AuthMode.SharedSecret;
  if (mode === AuthMode.SharedSecret) {
    return { method: 'static', token: required(env, 'APP_PROVIDER_BACKEND_USER_TOKEN') };
  }
  if (mode !== AuthMode.OAuth2) {
    throw new Error(`AUTH_MODE must be ${AuthMode.SharedSecret} or ${AuthMode.OAuth2}`);
  }

  const allowHttpValue = env.LEDGER_OAUTH_ALLOW_HTTP ?? 'false';
  if (allowHttpValue !== 'true' && allowHttpValue !== 'false') {
    throw new Error('LEDGER_OAUTH_ALLOW_HTTP must be true or false');
  }
  const allowHttp = allowHttpValue === 'true';
  let issuer: URL;
  try {
    issuer = new URL(required(env, 'AUTH_APP_PROVIDER_ISSUER_URL'));
  } catch {
    throw new Error('AUTH_APP_PROVIDER_ISSUER_URL must be an absolute HTTP or HTTPS URL');
  }
  if (
    (issuer.protocol !== 'https:' && !(allowHttp && issuer.protocol === 'http:')) ||
    issuer.username ||
    issuer.password ||
    issuer.search ||
    issuer.hash
  ) {
    throw new Error(
      'OAuth issuer must use HTTPS, or HTTP with LEDGER_OAUTH_ALLOW_HTTP=true, without credentials, query, or fragment',
    );
  }

  const clientSecret = env.AUTH_APP_PROVIDER_BACKEND_SECRET;
  if (!clientSecret?.trim())
    throw new Error('AUTH_APP_PROVIDER_BACKEND_SECRET is required for Ledger API access');
  return {
    method: 'client_credentials',
    issuer,
    clientId: required(env, 'AUTH_APP_PROVIDER_BACKEND_CLIENT_ID'),
    clientSecret,
    allowHttp,
  };
}

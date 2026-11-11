import { afterEach, expect, test } from 'bun:test';
import { AuthMode } from '../src/config/auth-mode';
import { createLedgerClient } from '../src/integrations/ledger/client';
import { connectLedger } from '../src/integrations/ledger/connect';
import { createOAuthTokenProvider } from '../src/integrations/ledger/oauth-token-provider';
import { createAppInstallRequest } from '../src/modules/app-installations';

// Simulated identity provider and Ledger API exercise the real OAuth and SDK clients.
const servers: ReturnType<typeof Bun.serve>[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.stop(true)));
});

function setup() {
  const state = {
    now: 0,
    requests: 0,
    discoveryRequests: 0,
    expiresIn: 100 as number | undefined,
    failToken: false,
    authorizations: [] as (string | null)[],
    tokenForms: [] as URLSearchParams[],
    submissions: [] as unknown[],
  };
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      const path = new URL(request.url).pathname;
      const origin = new URL(request.url).origin;
      if (path === '/issuer/.well-known/openid-configuration') {
        state.discoveryRequests += 1;
        return Response.json({
          issuer: `${origin}/issuer`,
          token_endpoint: `${origin}/token`,
          jwks_uri: `${origin}/jwks`,
          token_endpoint_auth_methods_supported: ['client_secret_basic'],
        });
      }
      if (path === '/token') {
        state.requests += 1;
        state.authorizations.push(request.headers.get('authorization'));
        state.tokenForms.push(new URLSearchParams(await request.text()));
        if (state.failToken) return Response.json({ error: 'invalid_client' }, { status: 401 });
        return Response.json({
          access_token: `token-${state.requests}`,
          token_type: 'Bearer',
          ...(state.expiresIn !== undefined ? { expires_in: state.expiresIn } : {}),
        });
      }
      if (path === '/v2/version') {
        state.authorizations.push(request.headers.get('authorization'));
        return Response.json({ version: '3.5.2' });
      }
      if (path === '/v2/commands/submit-and-wait' && request.method === 'POST') {
        state.authorizations.push(request.headers.get('authorization'));
        state.submissions.push(await request.json());
        return Response.json({
          updateId: `update-${state.submissions.length}`,
          completionOffset: state.submissions.length,
        });
      }
      return new Response(null, { status: 404 });
    },
  });
  servers.push(server);
  const options = {
    method: 'client_credentials' as const,
    issuer: new URL('issuer', server.url),
    clientId: 'service-client',
    clientSecret: 'service-secret',
    ledgerUserId: 'ledger-user',
    allowHttp: true,
  };
  return { state, options, server };
}

test('Obtains and reuses a client credentials token with the configured service identity', async () => {
  const { state, options } = setup();
  const provider = await createOAuthTokenProvider(options, () => state.now);

  expect(await provider.getAccessToken()).toBe('token-1');
  expect(await provider.getAuthContext()).toEqual({
    userId: 'ledger-user',
    accessToken: 'token-1',
  });
  expect(state.requests).toBe(1);
  expect(state.discoveryRequests).toBe(1);
  expect(state.authorizations[0]).toStartWith('Basic ');
  const credentials = atob(state.authorizations[0]?.slice(6) ?? '')
    .split(':')
    .map(decodeURIComponent);
  expect(credentials).toEqual(['service-client', 'service-secret']);
  expect(state.tokenForms[0].get('grant_type')).toBe('client_credentials');
});

test('Renews before expiry and shares token acquisition between concurrent requests', async () => {
  const { state, options } = setup();
  const provider = await createOAuthTokenProvider(options, () => state.now);

  expect(await Promise.all([provider.getAccessToken(), provider.getAccessToken()])).toEqual([
    'token-1',
    'token-1',
  ]);
  state.now = 89_000;
  expect(await provider.getAccessToken()).toBe('token-1');
  state.now = 90_000;
  expect(await Promise.all([provider.getAccessToken(), provider.getAuthContext()])).toEqual([
    'token-2',
    { userId: 'ledger-user', accessToken: 'token-2' },
  ]);
  expect(state.requests).toBe(2);
  expect(state.discoveryRequests).toBe(1);
});

test('A failed renewal rejects and can recover on a subsequent request', async () => {
  const { state, options } = setup();
  const provider = await createOAuthTokenProvider(options, () => state.now);
  await provider.getAccessToken();
  state.now = 100_000;
  state.failToken = true;
  await expect(provider.getAccessToken()).rejects.toThrow();
  state.failToken = false;
  expect(await provider.getAccessToken()).toBe('token-3');
});

test('Does not cache tokens indefinitely when expires_in is absent', async () => {
  const { state, options } = setup();
  state.expiresIn = undefined;
  const provider = await createOAuthTokenProvider(options, () => state.now);
  expect(await provider.getAccessToken()).toBe('token-1');
  expect(await provider.getAccessToken()).toBe('token-2');
});

test('Rejects a token that is already expired', async () => {
  const { state, options } = setup();
  state.expiresIn = 0;
  const provider = await createOAuthTokenProvider(options, () => state.now);
  await expect(provider.getAccessToken()).rejects.toThrow();
});

test('Connects to Ledger API with an OAuth service token without requiring a static token', async () => {
  const { server, state, options } = setup();
  const connection = await connectLedger({
    AUTH_MODE: AuthMode.OAuth2,
    LEDGER_API_URL: server.url.href,
    LEDGER_API_ALLOW_HTTP: 'true',
    LEDGER_API_USER_ID: options.ledgerUserId,
    AUTH_APP_PROVIDER_ISSUER_URL: options.issuer.href,
    AUTH_APP_PROVIDER_BACKEND_CLIENT_ID: options.clientId,
    AUTH_APP_PROVIDER_BACKEND_SECRET: options.clientSecret,
    LEDGER_OAUTH_ALLOW_HTTP: 'true',
  });

  expect(connection.ledgerUserId).toBe('ledger-user');
  expect(state.authorizations.at(-1)).toBe('Bearer token-1');
});

test('Submits commands with the renewed OAuth token after the cached token reaches its renewal time', async () => {
  const { server, state, options } = setup();
  const provider = await createOAuthTokenProvider(options, () => state.now);
  const client = await createLedgerClient({ baseUrl: server.url, accessTokenProvider: provider });
  const connection = { client, ledgerUserId: options.ledgerUserId };
  const payload = { provider: 'provider::test', user: 'user::test', meta: { values: {} } };

  expect(await createAppInstallRequest(connection, payload, 'first-command')).toEqual({
    updateId: 'update-1',
    completionOffset: 1,
  });
  state.now = 90_000;
  expect(await createAppInstallRequest(connection, payload, 'second-command')).toEqual({
    updateId: 'update-2',
    completionOffset: 2,
  });

  expect(state.requests).toBe(2);
  expect(state.authorizations.filter((value) => value?.startsWith('Bearer '))).toEqual([
    'Bearer token-1',
    'Bearer token-1',
    'Bearer token-2',
  ]);
  expect(state.submissions).toEqual([
    expect.objectContaining({ commandId: 'first-command', userId: options.ledgerUserId }),
    expect.objectContaining({ commandId: 'second-command', userId: options.ledgerUserId }),
  ]);
});

test('Exposes identity-provider discovery failures as Ledger API errors with the original cause', async () => {
  const { server, options } = setup();
  await expect(
    connectLedger({
      AUTH_MODE: AuthMode.OAuth2,
      LEDGER_API_URL: server.url.href,
      LEDGER_API_ALLOW_HTTP: 'true',
      LEDGER_API_USER_ID: options.ledgerUserId,
      AUTH_APP_PROVIDER_ISSUER_URL: new URL('missing-issuer', server.url).href,
      AUTH_APP_PROVIDER_BACKEND_CLIENT_ID: options.clientId,
      AUTH_APP_PROVIDER_BACKEND_SECRET: options.clientSecret,
      LEDGER_OAUTH_ALLOW_HTTP: 'true',
    }),
  ).rejects.toMatchObject({
    name: 'LedgerApiError',
    message: 'Failed to configure Ledger API authentication',
    cause: expect.any(Error),
  });
});

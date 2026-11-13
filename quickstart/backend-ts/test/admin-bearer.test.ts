import { expect, test } from 'bun:test';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { createApp } from '../src/app';
import { createAdminBearerVerifier } from '../src/auth/admin-bearer';
import { readApplicationConfig } from '../src/config/application';
import { appDependencies } from './fixtures/dependencies';

test('An administrative bearer must be signed by the configured issuer and valid at request time', async () => {
  const trusted = await generateKeyPair('RS256');
  const other = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(trusted.publicKey)), kid: 'active', alg: 'RS256' };
  let requests = 0;
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    /** Publishes only the trusted signing key at the discovered JWKS endpoint. */
    fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === '/issuer/.well-known/openid-configuration')
        return Response.json({ issuer: `${url.origin}/issuer`, jwks_uri: `${url.origin}/keys` });
      if (url.pathname !== '/keys') return new Response(null, { status: 404 });
      requests++;
      return Response.json({ keys: [jwk] });
    },
  });
  try {
    const issuer = `${server.url.origin}/issuer`;
    const { appProvider } = readApplicationConfig({ APP_PROVIDER_PARTY: 'provider::test' });
    const verify = createAdminBearerVerifier(
      { issuer, jwks_uri: `${server.url.origin}/keys` },
      appProvider,
    );
    const now = Math.floor(Date.now() / 1000);
    /** Signs a short-lived access token; identity always comes from backend configuration. */
    const bearer = async (claims = {}, key = trusted.privateKey) =>
      `Bearer ${await new SignJWT({ iss: issuer, exp: now + 300, party_id: 'ignored', ...claims }).setProtectedHeader({ alg: 'RS256', kid: 'active' }).sign(key)}`;
    for (const header of [null, 'Basic abc', 'Bearer malformed'])
      expect(await verify(header)).toBeNull();
    expect(requests).toBe(0);
    expect(await verify(await bearer())).toEqual({
      tenantId: 'AppProvider',
      partyId: 'provider::test',
      isAdmin: true,
    });
    for (const token of [
      await bearer({ iss: `${issuer}/other` }),
      await bearer({ exp: now - 120 }),
      await bearer({ nbf: now + 120 }),
      await bearer({}, other.privateKey),
    ]) {
      expect(await verify(token)).toBeNull();
    }
    expect(requests).toBe(1);

    // The onboarding client can list registrations before any browser has logged in.
    const application = readApplicationConfig({
      AUTH_MODE: 'oauth2',
      APP_PROVIDER_PARTY: 'provider::test',
      AUTH_APP_PROVIDER_BACKEND_OIDC_CLIENT_ID: 'web',
      AUTH_APP_PROVIDER_ISSUER_URL: issuer,
      LEDGER_OAUTH_ALLOW_HTTP: 'true',
    });
    const app = createApp({ ...appDependencies, application });
    /** Calls the administrative endpoint without a browser session. */
    const list = (headers: Record<string, string>) =>
      app.handle(new Request('http://localhost/admin/tenant-registrations', { headers }));
    expect((await list({})).status).toBe(401);
    expect((await list({ authorization: await bearer({}, other.privateKey) })).status).toBe(401);
    const registered = await list({ authorization: await bearer() });
    expect(registered.status).toBe(200);
    expect(await registered.json()).toEqual([
      {
        tenantId: 'AppProvider',
        partyId: 'provider::test',
        internal: true,
        walletUrl: null,
        users: null,
        clientId: 'web',
        issuerUrl: issuer,
      },
    ]);
  } finally {
    server.stop(true);
  }
});

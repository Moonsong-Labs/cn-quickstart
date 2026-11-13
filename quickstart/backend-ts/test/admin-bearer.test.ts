import { expect, test } from 'bun:test';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { createAdminBearerVerifier } from '../src/auth/admin-bearer';
import { readApplicationConfig } from '../src/config/application';

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
      if (new URL(request.url).pathname !== '/keys') return new Response(null, { status: 404 });
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
  } finally {
    server.stop(true);
  }
});

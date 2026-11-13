import { expect, test } from 'bun:test';
import { createApp } from '../src/app';
import { readApplicationConfig } from '../src/config/application';
import { appDependencies } from './fixtures/dependencies';

test('The provider login link starts a fresh public-client PKCE request after discovery', async () => {
  let available = false;
  let discoveries = 0;
  const provider = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      if (url.pathname !== '/tenant/.well-known/openid-configuration')
        return new Response(null, { status: 404 });
      discoveries++;
      if (!available) return new Response(null, { status: 503 });
      return Response.json({
        issuer: `${url.origin}/tenant`,
        authorization_endpoint: `${url.origin}/custom/authorize`,
        jwks_uri: `${url.origin}/keys`,
        token_endpoint: `${url.origin}/token`,
      });
    },
  });
  try {
    const application = readApplicationConfig({
      AUTH_MODE: 'oauth2',
      APP_PROVIDER_PARTY: 'provider',
      AUTH_APP_PROVIDER_ISSUER_URL: `${provider.url.origin}/tenant`,
      AUTH_APP_PROVIDER_BACKEND_OIDC_CLIENT_ID: 'browser-client',
      LEDGER_OAUTH_ALLOW_HTTP: 'true',
      OIDC_PUBLIC_ORIGIN: 'https://quickstart.example',
    });
    const app = createApp({ ...appDependencies, application });
    const get = (path: string) => app.handle(new Request(`http://backend.internal${path}`));
    const path = '/oauth2/authorization/AppProvider';
    const links = await get('/login-links');
    expect(await links.json()).toEqual([{ name: 'AppProvider', url: path }]);
    expect(discoveries).toBe(0);

    // A failed discovery leaves the browser free to retry once the provider recovers.
    const failed = await get(path);
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({ message: 'Internal Server Error' });
    expect(failed.headers.has('set-cookie')).toBe(false);
    available = true;
    const first = await get(path);
    expect(first.status).toBe(302);
    const url = new URL(first.headers.get('location') ?? '');
    expect(url.origin + url.pathname).toBe(`${provider.url.origin}/custom/authorize`);
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: 'browser-client',
      scope: 'openid',
      response_type: 'code',
      redirect_uri: 'https://quickstart.example/login/oauth2/code/AppProvider',
      code_challenge_method: 'S256',
    });
    expect(url.searchParams.get('code_challenge')).toMatch(/^[\w-]{43}$/);
    expect(url.searchParams.has('code_verifier')).toBe(false);
    const cookie = first.headers.get('set-cookie') ?? '';
    for (const attr of [
      'OIDC_LOGIN=',
      'HttpOnly',
      'Secure',
      'SameSite=Lax',
      'Path=/login/oauth2/code',
    ])
      expect(cookie).toContain(attr);

    // Browsers share discovery metadata, but each login gets its own secrets.
    const second = await get(path);
    const next = new URL(second.headers.get('location') ?? '');
    for (const key of ['state', 'nonce', 'code_challenge']) {
      expect(url.searchParams.get(key)).toBeTruthy();
      expect(next.searchParams.get(key)).toBeTruthy();
      expect(next.searchParams.get(key)).not.toBe(url.searchParams.get(key));
    }
    expect(discoveries).toBe(2);
    expect((await get('/oauth2/authorization/AppProviderBackend')).status).toBe(404);
    expect(
      (await createApp(appDependencies).handle(new Request('http://localhost/login-links'))).status,
    ).toBe(404);
  } finally {
    provider.stop(true);
  }
});

import { Elysia, t } from 'elysia';
import * as oidc from 'openid-client';
import type { ApplicationConfig } from '../../config/application';

const loginLifetimeSeconds = 300;

export function oidcRoutes(
  registrationId: string,
  options: NonNullable<ApplicationConfig['oidc']>,
) {
  const loginPath = `/oauth2/authorization/${registrationId}`;
  const redirectUri = new URL(`/login/oauth2/code/${registrationId}`, options.publicOrigin).href;
  const attempts = new Map<
    string,
    { state: string; nonce: string; verifier: string; redirectUri: string }
  >();
  let configuration: Promise<oidc.Configuration> | undefined;

  return new Elysia({ name: 'oidc' })
    .get('/login-links', () => [{ name: registrationId, url: loginPath }], {
      response: t.Array(t.Object({ name: t.String(), url: t.String() })),
      detail: { operationId: 'listLinks', tags: ['Auth'] },
    })
    .get(loginPath, async ({ cookie: { OIDC_LOGIN }, redirect, set, status }) => {
      try {
        // Concurrent logins share discovery. A failed request can be retried on the next login.
        configuration ??= oidc
          .discovery(
            options.issuer,
            options.clientId,
            { token_endpoint_auth_method: 'none' },
            oidc.None(),
            {
              timeout: 10,
              execute:
                options.issuer.protocol === 'http:' ? [oidc.allowInsecureRequests] : undefined,
            },
          )
          .catch((error) => {
            configuration = undefined;
            throw error;
          });
        const config = await configuration;
        // Only the PKCE challenge travels in the redirect. The verifier stays here for the code exchange.
        const verifier = oidc.randomPKCECodeVerifier();
        const state = oidc.randomState();
        const nonce = oidc.randomNonce();
        const url = oidc.buildAuthorizationUrl(config, {
          response_type: 'code',
          scope: 'openid',
          redirect_uri: redirectUri,
          state,
          nonce,
          code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
          code_challenge_method: 'S256',
        });
        // The callback cookie holds an opaque ID for this pending attempt, which expires after five minutes.
        const id = crypto.randomUUID();
        attempts.set(id, { state, nonce, verifier, redirectUri });
        setTimeout(() => attempts.delete(id), loginLifetimeSeconds * 1000).unref();
        OIDC_LOGIN.set({
          value: id,
          httpOnly: true,
          secure: options.publicOrigin.startsWith('https:'),
          sameSite: 'lax',
          path: '/login/oauth2/code',
          maxAge: loginLifetimeSeconds,
        });
        set.headers['cache-control'] = 'no-store';
        return redirect(url.href, 302);
      } catch (error) {
        console.error(
          'OIDC authorization could not start',
          error instanceof Error ? error.name : 'unknown error',
        );
        return status(500, { message: 'Internal Server Error' });
      }
    });
}

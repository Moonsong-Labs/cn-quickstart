import { Elysia, t } from 'elysia';
import * as oidc from 'openid-client';
import { Sessions } from '../../auth/sessions';
import type { ApplicationConfig } from '../../config/application';

const loginLifetimeSeconds = 300;

/** Registers the AppProvider login, callback, and session-backed user endpoints. */
export function oidcRoutes(
  provider: ApplicationConfig['appProvider'],
  options: NonNullable<ApplicationConfig['oidc']>,
) {
  const registrationId = provider.tenantId;
  const sessions = new Sessions<{ name: string | null; party: string }>();
  const callbackPath = `/login/oauth2/code/${registrationId}`;
  const loginPath = `/oauth2/authorization/${registrationId}`;
  const redirectUri = new URL(callbackPath, options.publicOrigin).href;
  const attempts = new Map<
    string,
    { state: string; nonce: string; verifier: string; expires: number }
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
              execute: [
                oidc.enableNonRepudiationChecks,
                ...(options.issuer.protocol === 'http:' ? [oidc.allowInsecureRequests] : []),
              ],
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
        attempts.set(id, {
          state,
          nonce,
          verifier,
          expires: Date.now() + loginLifetimeSeconds * 1000,
        });
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
    })
    .get(callbackPath, async ({ request, cookie: { OIDC_LOGIN, JSESSIONID }, redirect }) => {
      const id = OIDC_LOGIN.value;
      const attempt = typeof id === 'string' ? attempts.get(id) : undefined;
      if (typeof id === 'string') attempts.delete(id);
      OIDC_LOGIN.set({
        value: '',
        path: '/login/oauth2/code',
        httpOnly: true,
        maxAge: 0,
        sameSite: 'lax',
        secure: options.publicOrigin.startsWith('https:'),
      });
      if (!attempt || attempt.expires <= Date.now() || !configuration)
        return redirect('/login?error', 302);

      // Consume the attempt before the exchange so concurrent callbacks cannot reuse it.
      const url = new URL(redirectUri);
      url.search = new URL(request.url).search;
      try {
        const tokens = await oidc.authorizationCodeGrant(await configuration, url, {
          expectedState: attempt.state,
          expectedNonce: attempt.nonce,
          pkceCodeVerifier: attempt.verifier,
          idTokenExpected: true,
        });
        const claims = tokens.claims();
        if (!claims) return redirect('/login?error', 302);
        const party =
          options.testProfile && typeof claims.party_id === 'string'
            ? claims.party_id
            : provider.partyId;
        const session = sessions.open(
          { name: typeof claims.name === 'string' ? claims.name : null, party },
          JSESSIONID.value,
        );
        JSESSIONID.set({
          value: session,
          path: '/',
          httpOnly: true,
          sameSite: 'lax',
          secure: options.publicOrigin.startsWith('https:'),
        });
        return redirect('/', 302);
      } catch (error) {
        console.warn(
          'OIDC callback rejected',
          error instanceof Error ? error.name : 'unknown error',
        );
        return redirect('/login?error', 302);
      }
    })
    .get(
      '/user',
      ({ cookie: { JSESSIONID }, status }) => {
        const user = sessions.read(JSESSIONID.value);
        if (!user) return status(401, null);
        return {
          ...user,
          roles: ['ROLE_ADMIN', registrationId, user.party],
          isAdmin: true,
          walletUrl: null,
        };
      },
      { detail: { operationId: 'getAuthenticatedUser', tags: ['Auth'] } },
    );
}

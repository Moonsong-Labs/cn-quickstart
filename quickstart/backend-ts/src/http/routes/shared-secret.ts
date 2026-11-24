import { Elysia } from 'elysia';
import type { Pool } from 'pg';
import { Sessions } from '../../auth/sessions';
import { resolveSharedSecretUser, type Tenant } from '../../auth/shared-secret-user';
import type { LedgerConnection } from '../../integrations/ledger/connect';

import { appInstallationRoutes } from './app-installations';
import { tenantRegistrationRoutes } from './tenant-registration';

/** Registers shared-secret login, session, and tenant administration endpoints. */
export function sharedSecretRoutes(provider: Tenant, pqs: Pool, ledger: LedgerConnection) {
  /** Holds the provider and the tenants registered through the admin API. */
  const tenants = [provider];
  const sessions = new Sessions<string>();

  /** Matches login names case-insensitively and preserves the registered spelling in the session. */
  function registeredUsername(input: string) {
    const normalized = input.trim().toLowerCase();
    for (const tenant of tenants) {
      const match = tenant.users.find((name) => name.toLowerCase() === normalized);
      if (match !== undefined) return match;
    }
  }

  /** Ends every session belonging to a user of the removed tenant. */
  function revokeTenantSessions(tenant: Tenant) {
    sessions.revokeWhere((username) => tenant.users.includes(username));
  }

  /** Resolves an active session to its user and current tenant permissions. */
  function sessionUser(id: unknown) {
    const username = sessions.read(id);
    return username === null ? null : resolveSharedSecretUser(username, tenants);
  }

  return new Elysia({ name: 'shared-secret' })
    .onTransform(({ set }) => {
      set.headers['cache-control'] = 'no-store';
    })
    .post(
      '/login',
      ({ body, cookie: { JSESSIONID }, redirect, request }) => {
        const form = body as Record<string, unknown> | undefined;
        const username =
          typeof form?.username === 'string' ? registeredUsername(form.username) : undefined;
        if (form?.password || !username) {
          return redirect('/login?error', 302);
        }
        const id = sessions.open(username, JSESSIONID.value);
        JSESSIONID.set({
          value: id,
          path: '/',
          httpOnly: true,
          sameSite: 'lax',
          secure: new URL(request.url).protocol === 'https:',
        });
        return redirect('/', 302);
      },
      { parse: 'urlencoded' },
    )
    .get(
      '/user',
      ({ cookie: { JSESSIONID }, status }) => {
        const user = sessionUser(JSESSIONID.value);
        if (!user) return status(401, null);
        return {
          name: user.username,
          party: user.partyId,
          roles: user.roles,
          isAdmin: user.isAdmin,
          walletUrl: user.walletUrl,
        };
      },
      { detail: { operationId: 'getAuthenticatedUser', tags: ['Auth'] } },
    )
    .use(
      appInstallationRoutes(
        pqs,
        ledger,
        provider.partyId,
        (_request, sessionId) => sessionUser(sessionId)?.partyId ?? null,
        (_request, sessionId) => {
          /** Only the internal provider's current session can mutate installation requests. */
          const user = sessionUser(sessionId);
          if (!user) return 401;
          return user.isAdmin && user.partyId === provider.partyId ? 200 : 403;
        },
      ),
    )
    .use(tenantRegistrationRoutes(tenants, sessionUser, revokeTenantSessions))
    .post('/logout', ({ cookie: { JSESSIONID }, redirect }) => {
      sessions.invalidate(JSESSIONID.value);
      JSESSIONID.set({ value: '', path: '/', httpOnly: true, maxAge: 0 });
      return redirect('/', 302);
    });
}

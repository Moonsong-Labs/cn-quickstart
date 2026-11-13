import { Elysia } from 'elysia';
import { resolveSharedSecretUser, type Tenant } from '../../auth/shared-secret-user';

import { tenantRegistrationRoutes } from './tenant-registration';

const idleTimeout = 30 * 60 * 1000;

export function sharedSecretRoutes(tenants: Tenant[]) {
  const sessions = new Map<string, { username: string; expires: number; timer: NodeJS.Timeout }>();

  function invalidate(id: string) {
    const session = sessions.get(id);
    if (session) clearTimeout(session.timer);
    sessions.delete(id);
  }

  function sessionUser(id: unknown) {
    const session = typeof id === 'string' ? sessions.get(id) : undefined;
    if (!session || session.expires <= Date.now()) return null;
    session.expires = Date.now() + idleTimeout;
    session.timer.refresh();
    return resolveSharedSecretUser(session.username, tenants);
  }

  return new Elysia({ name: 'shared-secret' })
    .post(
      '/login',
      ({ body, cookie: { JSESSIONID }, redirect, request }) => {
        const form = body as Record<string, unknown> | undefined;
        const username = typeof form?.username === 'string' ? form.username.trim() : '';
        if (form?.password || !resolveSharedSecretUser(username, tenants)) {
          return redirect('/login?error', 302);
        }
        if (typeof JSESSIONID.value === 'string') invalidate(JSESSIONID.value);
        const id = crypto.randomUUID();
        const timer = setTimeout(() => sessions.delete(id), idleTimeout).unref();
        sessions.set(id, { username, expires: Date.now() + idleTimeout, timer });
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
    .use(tenantRegistrationRoutes(tenants, sessionUser))
    .post('/logout', ({ cookie: { JSESSIONID }, redirect }) => {
      if (typeof JSESSIONID.value === 'string') invalidate(JSESSIONID.value);
      JSESSIONID.set({ value: '', path: '/', httpOnly: true, maxAge: 0 });
      return redirect('/', 302);
    });
}

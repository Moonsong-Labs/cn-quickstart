import { expect, test } from 'bun:test';
import { createApp } from '../src/app';
import { appDependencies } from './fixtures/dependencies';

test('Only admins can onboard a tenant and failed registration reserves no users or tenant ID', async () => {
  const app = createApp(appDependencies);
  const login = async (username: string) => {
    const response = await app.handle(
      new Request('http://localhost/login', {
        method: 'POST',
        body: new URLSearchParams({ username }),
      }),
    );
    return response.headers.get('set-cookie')?.split(';')[0] ?? '';
  };
  const register = (cookie: string, data: object) =>
    app.handle(
      new Request('http://localhost/admin/tenant-registrations', {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json', authorization: 'Custom' },
        body: JSON.stringify(data),
      }),
    );
  const tenant = {
    tenantId: 'AppUser',
    partyId: 'customer::123',
    walletUrl: 'http://wallet.localhost:2000',
    issuerUrl: '',
    clientId: '',
    internal: true,
    users: ['alice'],
  };

  // The onboarding script sends Authorization: Custom, but it needs an admin session cookie.
  expect((await register('', tenant)).status).toBe(401);
  const admin = await login('app-provider');
  const missing = await register(admin, { ...tenant, users: [] });
  expect(missing.status).toBe(400);
  expect(await missing.json()).toEqual({
    message: 'At least one User is required in shared-secret mode',
  });

  // The second username collides with app-provider. Both alice and the tenant ID must remain available for retry.
  expect((await register(admin, { ...tenant, users: ['alice', 'APP-PROVIDER'] })).status).toBe(500);
  expect(await login('alice')).toBe('');
  const created = await register(admin, tenant);
  expect(created.status).toBe(201);
  expect(await created.json()).toEqual({ ...tenant, internal: false, issuerUrl: null });
  expect((await register(admin, tenant)).status).toBe(409);

  // Even though the request asked for internal: true, alice should only have regular user access.
  const cookie = await login('alice');
  const user = await app.handle(new Request('http://localhost/user', { headers: { cookie } }));
  expect(await user.json()).toEqual({
    name: 'alice the user',
    party: tenant.partyId,
    walletUrl: tenant.walletUrl,
    roles: ['ROLE_USER'],
    isAdmin: false,
  });
  expect((await register(cookie, { ...tenant, tenantId: 'other' })).status).toBe(403);
});

import { expect, test } from 'bun:test';
import { resolveSharedSecretUser } from '../src/auth/shared-secret-user';
import { readApplicationConfig } from '../src/config/application';

test('Resolves shared-secret identities using the tenant that owns the username', () => {
  const { appProvider } = readApplicationConfig({ APP_PROVIDER_PARTY: 'provider::123' });
  if (!('users' in appProvider)) throw new Error('Expected shared-secret provider');
  const tenants = [
    appProvider,
    {
      tenantId: 'AppUser',
      partyId: 'customer::456',
      internal: false,
      users: ['alice'],
      walletUrl: 'https://wallet.example/customer',
    },
  ];

  expect(resolveSharedSecretUser('app-provider', tenants)).toEqual({
    username: 'app-provider the provider',
    tenantId: 'AppProvider',
    partyId: 'provider::123',
    walletUrl: null,
    roles: ['ROLE_ADMIN'],
    isAdmin: true,
  });
  expect(resolveSharedSecretUser('alice', tenants)).toEqual({
    username: 'alice the user',
    tenantId: 'AppUser',
    partyId: 'customer::456',
    walletUrl: 'https://wallet.example/customer',
    roles: ['ROLE_USER'],
    isAdmin: false,
  });
  expect(resolveSharedSecretUser('AppProvider', tenants)).toBeNull();
});

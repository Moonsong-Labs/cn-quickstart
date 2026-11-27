import type { SharedSecretTenant } from '../modules/tenants';

/** Maps a registered username to its tenant's party, roles, and wallet URL, or returns null. */
export function resolveSharedSecretUser(username: string, tenants: Iterable<SharedSecretTenant>) {
  for (const tenant of tenants) {
    if (!tenant.users.includes(username)) continue;
    return {
      username: username + (tenant.internal ? ' the provider' : ' the user'),
      tenantId: tenant.tenantId,
      partyId: tenant.partyId,
      walletUrl: tenant.walletUrl ?? null,
      roles: [tenant.internal ? 'ROLE_ADMIN' : 'ROLE_USER'],
      isAdmin: tenant.internal,
    };
  }
  return null;
}

type Tenant = {
  tenantId: string;
  partyId: string;
  internal: boolean;
  users: readonly string[];
  walletUrl?: string;
};

export function resolveSharedSecretUser(username: string, tenants: Iterable<Tenant>) {
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

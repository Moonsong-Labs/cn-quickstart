/** Fields that identify tenants and control their registration in either authentication mode. */
type TenantIdentity = {
  tenantId: string;
  partyId: string;
  internal: boolean;
  walletUrl?: string | null;
};

/** A shared-secret tenant authenticates locally registered usernames. */
export type SharedSecretTenant = TenantIdentity & { users: readonly string[] };

/** An OIDC tenant authenticates through its registered issuer and client. */
export type OidcTenant = TenantIdentity & {
  walletUrl: string | null;
  clientId: string;
  issuerUrl: string;
};

/** Reports registration input the administrator can correct, including a conflict with saved data. */
export class TenantRegistrationError extends Error {
  constructor(
    readonly status: 400 | 409,
    message: string,
  ) {
    super(message);
  }
}

/** Normalizes blank URLs to null and requires wallet URLs to be absolute HTTP(S) URLs. */
export function optionalTenantUrl(value: string | null | undefined, field: 'issuer' | 'wallet') {
  if (!value?.trim()) return null;
  if (
    /\s|[<>"{}|\\^`]|%(?![0-9a-f]{2})/i.test(value) ||
    !URL.canParse(value, 'https://localhost') ||
    (field === 'wallet' && !/^https?:\/\//i.test(value))
  ) {
    throw new TenantRegistrationError(400, `Invalid ${field} URL`);
  }
  return value;
}

/** Validates fields shared by both modes and marks registrations created by the API as external. */
export function externalTenantFields({
  tenantId,
  partyId,
  walletUrl,
}: {
  tenantId?: string;
  partyId?: string;
  walletUrl?: string | null;
}) {
  if (!tenantId?.trim()) throw new TenantRegistrationError(400, 'Tenant Id is required');
  if (!partyId?.trim()) throw new TenantRegistrationError(400, 'Party Id is required');
  return { tenantId, partyId, walletUrl: optionalTenantUrl(walletUrl, 'wallet'), internal: false };
}

/** Keeps tenant IDs unique across the registrations for the active authentication mode. */
export function assertTenantIdAvailable(tenantId: string, tenants: readonly TenantIdentity[]) {
  if (tenants.some((tenant) => tenant.tenantId === tenantId)) {
    throw new TenantRegistrationError(409, 'TenantId already exists');
  }
}

/** Validates local usernames with the same case-insensitive matching that login uses. */
export function validateSharedSecretUsers(
  users: string[] | undefined,
  tenants: readonly SharedSecretTenant[],
): string[] {
  if (!users?.length) {
    throw new TenantRegistrationError(400, 'At least one User is required in shared-secret mode');
  }
  const names = new Set(
    tenants.flatMap((tenant) => tenant.users.map((name) => name.toLowerCase())),
  );
  for (const user of users) {
    if (user !== user.trim()) {
      throw new TenantRegistrationError(
        400,
        'Usernames must not have leading or trailing whitespace',
      );
    }
    if (!user) throw new TenantRegistrationError(400, 'Username must not be empty');
    const name = user.toLowerCase();
    if (names.has(name)) throw new TenantRegistrationError(409, 'Username already exists');
    names.add(name);
  }
  return users;
}

/** Validates the OIDC client and issuer before an external tenant can trigger provider discovery. */
export function validateOidcTenant(
  { clientId, issuerUrl }: { clientId?: string | null; issuerUrl?: string | null },
  allowHttp: boolean,
) {
  if (!clientId?.trim())
    throw new TenantRegistrationError(400, 'Client Id is required in OAuth2 mode');
  if (!issuerUrl?.trim())
    throw new TenantRegistrationError(400, 'Issuer Url is required in OAuth2 mode');
  const issuer = URL.parse(issuerUrl);
  if (
    !issuer ||
    issuer.username ||
    issuer.password ||
    issuer.search ||
    issuer.hash ||
    !(issuer.protocol === 'https:' || (allowHttp && issuer.protocol === 'http:'))
  ) {
    throw new TenantRegistrationError(400, 'Invalid issuer URL');
  }
  return { clientId, issuer };
}

/** Rejects repeated tenant IDs, issuer/client pairs, and generated browser registration IDs. */
export function assertOidcTenantAvailable(
  candidate: OidcTenant,
  registrationId: string,
  registrations: ReadonlyMap<string, { tenant: OidcTenant }>,
) {
  const tenants = Array.from(registrations.values(), ({ tenant }) => tenant);
  assertTenantIdAvailable(candidate.tenantId, tenants);
  if (
    tenants.some(
      ({ clientId, issuerUrl }) =>
        clientId === candidate.clientId && issuerUrl === candidate.issuerUrl,
    )
  ) {
    throw new TenantRegistrationError(409, 'ClientId-IssuerUrl combination already exists');
  }
  if (registrations.has(registrationId)) {
    throw new TenantRegistrationError(409, 'RegistrationId already exists');
  }
}

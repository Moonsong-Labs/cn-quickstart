import { AuthMode, readAuthMode, readProviderIssuer } from './auth-mode';

export type ApplicationConfig = ReturnType<typeof readApplicationConfig>;

/** Trims APP_PROVIDER_PARTY and throws when it is missing or blank. */
export function readApplicationConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
) {
  const appProviderParty = env.APP_PROVIDER_PARTY?.trim();
  if (!appProviderParty) {
    throw new Error('APP_PROVIDER_PARTY is required for the Quickstart application');
  }

  const appProvider = {
    tenantId: 'AppProvider',
    internal: true,
    partyId: appProviderParty,
  } as const;
  const authMode = readAuthMode(env);
  if (authMode === AuthMode.SharedSecret) {
    return { appProvider: { ...appProvider, users: ['app-provider'] }, authMode };
  }

  const { issuer } = readProviderIssuer(env);
  const clientId = env.AUTH_APP_PROVIDER_BACKEND_OIDC_CLIENT_ID?.trim();
  if (!clientId)
    throw new Error('AUTH_APP_PROVIDER_BACKEND_OIDC_CLIENT_ID is required for web login');
  return { appProvider, authMode, oidc: { issuer, clientId } };
}

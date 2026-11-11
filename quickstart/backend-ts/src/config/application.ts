/** Identifies the App Provider party used by Quickstart application workflows. */
export interface ApplicationConfig {
  appProviderParty: string;
}

/** Trims APP_PROVIDER_PARTY and throws when it is missing or blank. */
export function readApplicationConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): ApplicationConfig {
  const appProviderParty = env.APP_PROVIDER_PARTY?.trim();
  if (!appProviderParty) {
    throw new Error('APP_PROVIDER_PARTY is required for the Quickstart application');
  }

  return { appProviderParty };
}

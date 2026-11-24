import { Elysia } from 'elysia';
import type { Pool } from 'pg';
import type { ApplicationConfig } from './config/application';
import { AuthMode } from './config/auth-mode';
import { type Config, loadConfig } from './config/env';
import { createApiDocumentation } from './http/plugins/openapi';
import { featureFlagRoutes } from './http/routes/feature-flags';
import { healthRoutes } from './http/routes/health';
import { oidcRoutes } from './http/routes/oidc';
import { sharedSecretRoutes } from './http/routes/shared-secret';
import type { LedgerConnection } from './integrations/ledger/connect';

/** Supplies the initialized Ledger connection and Quickstart party settings to HTTP handlers. */
export interface AppDependencies {
  ledger: LedgerConnection;
  application: ApplicationConfig;
  pqs: Pool;
}

/**
 * Accepts dependencies first and decorates the app with ledger and application settings.
 * Registers HTTP routes and includes API documentation when configuration enables it.
 */
export function createApp(dependencies: AppDependencies, config: Config = loadConfig()) {
  const app = new Elysia()
    .decorate('ledger', dependencies.ledger)
    .decorate('application', dependencies.application)
    .decorate('pqs', dependencies.pqs);
  if (config.apiDocsEnabled) app.use(createApiDocumentation());
  const { application, pqs, ledger } = dependencies;
  if (application.authMode === AuthMode.SharedSecret) {
    app.use(sharedSecretRoutes(application.appProvider, pqs, ledger));
  } else {
    app.use(oidcRoutes(application.appProvider, application.oidc, pqs, ledger));
  }
  return app.use(healthRoutes).use(featureFlagRoutes(dependencies.application.authMode));
}

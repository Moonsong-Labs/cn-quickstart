import { Elysia } from 'elysia';
import type { Pool } from 'pg';
import type { ApplicationConfig } from './config/application';
import { type Config, loadConfig } from './config/env';
import { createApiDocumentation } from './http/plugins/openapi';
import { healthRoutes } from './http/routes/health';
import type { connectLedger } from './integrations/ledger/connect';

/** Supplies the initialized Ledger connection and Quickstart party settings to HTTP handlers. */
export interface AppDependencies {
  ledger: Awaited<ReturnType<typeof connectLedger>>;
  application: ApplicationConfig;
  pqs: Pool;
}

/**
 * Accepts dependencies first and decorates the app with ledger and application settings.
 * Registers health routes and includes API documentation when configuration enables it.
 */
export function createApp(dependencies: AppDependencies, config: Config = loadConfig()) {
  const app = new Elysia()
    .decorate('ledger', dependencies.ledger)
    .decorate('application', dependencies.application)
    .decorate('pqs', dependencies.pqs);
  if (config.apiDocsEnabled) app.use(createApiDocumentation());
  return app.use(healthRoutes);
}

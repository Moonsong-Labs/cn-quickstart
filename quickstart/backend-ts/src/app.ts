import { Elysia } from 'elysia';
import { type Config, loadConfig } from './config/env';
import { createApiDocumentation } from './http/plugins/openapi';
import { healthRoutes } from './http/routes/health';

/**
 * Builds the HTTP application.
 * Mounts the OpenAPI plugin only when `config.apiDocsEnabled` is true.
 * When `config` is omitted, reads the process environment at call time.
 */
export function createApp(config: Config = loadConfig()) {
  const app = new Elysia();
  if (config.apiDocsEnabled) app.use(createApiDocumentation());
  return app.use(healthRoutes);
}

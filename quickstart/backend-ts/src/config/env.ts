/** Port used when `PORT` is unset. */
const DEFAULT_PORT = 8081;

/**
 * Values the server reads from its environment.
 * `loadConfig` builds one, and `createApp` and `server` share that object.
 */
export type Config = {
  /** TCP port to listen on. An integer from 1 to 65535. */
  port: number;
  /**
   * Serves `/openapi` and `/openapi/json` when true.
   * When false, those routes are not registered.
   */
  apiDocsEnabled: boolean;
};

/**
 * Reads `PORT`, `NODE_ENV`, and `API_DOCS_ENABLED` from `env`.
 * `PORT` defaults to 8081 when unset. An empty string, a non-integer, or a value
 * outside 1 to 65535 throws. Docs are on unless `NODE_ENV` is `production`.
 * `API_DOCS_ENABLED=true` forces them on, and any other set value forces them off.
 * `env` defaults to `process.env`. The parameter keeps the read off
 * `process.env.NODE_ENV`, which `bun build` replaces at build time.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const port = Number(env.PORT ?? DEFAULT_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }

  const flag = env.API_DOCS_ENABLED;
  return {
    port,
    apiDocsEnabled: flag === undefined ? env.NODE_ENV !== 'production' : flag === 'true',
  };
}

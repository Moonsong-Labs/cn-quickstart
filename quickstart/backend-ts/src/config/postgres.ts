import type { PoolConfig } from 'pg';

type Environment = Readonly<Record<string, string | undefined>>;

export function readPostgresConfig(env: Environment = process.env): PoolConfig {
  function required(name: string): string {
    const value = env[name]?.trim();
    if (!value) throw new Error(`${name} is required for PQS database access`);
    return value;
  }

  function integer(name: string, fallback: number, maximum: number): number {
    const value = env[name] ?? String(fallback);
    const parsed = Number(value);
    if (!/^\d+$/.test(value) || !Number.isInteger(parsed) || parsed < 1 || parsed > maximum)
      throw new Error(`${name} must be an integer between 1 and ${maximum}`);
    return parsed;
  }

  const host = required('POSTGRES_HOST');
  const database = required('POSTGRES_DATABASE');
  const user = required('POSTGRES_USERNAME');
  const password = env.POSTGRES_PASSWORD;
  if (!password) throw new Error('POSTGRES_PASSWORD is required for PQS database access');

  return {
    host,
    database,
    user,
    password,
    port: integer('POSTGRES_PORT', 5432, 65535),
    max: integer('POSTGRES_POOL_MAX', 10, 2147483647),
    statement_timeout: integer('POSTGRES_STATEMENT_TIMEOUT_MS', 30000, 2147483647),
    connectionTimeoutMillis: integer('POSTGRES_CONNECTION_TIMEOUT_MS', 5000, 2147483647),
  };
}

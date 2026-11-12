import { expect, test } from 'bun:test';
import { readPostgresConfig } from '../src/config/postgres';

const validEnvironment = {
  POSTGRES_HOST: 'localhost',
  POSTGRES_DATABASE: 'pqs-app-provider',
  POSTGRES_USERNAME: 'cnadmin',
  POSTGRES_PASSWORD: 'secret',
};

test('reads required connection settings and PostgreSQL defaults', () => {
  expect(readPostgresConfig(validEnvironment)).toEqual({
    host: 'localhost',
    database: 'pqs-app-provider',
    user: 'cnadmin',
    password: 'secret',
    port: 5432,
    max: 10,
    connectionTimeoutMillis: 5000,
    statement_timeout: 30000,
  });
});

test('trims identifiers while preserving the configured password', () => {
  expect(
    readPostgresConfig({
      ...validEnvironment,
      POSTGRES_HOST: ' db.internal ',
      POSTGRES_DATABASE: ' pqs ',
      POSTGRES_USERNAME: ' cnadmin ',
      POSTGRES_PASSWORD: ' secret with spaces ',
      POSTGRES_PORT: '6543',
      POSTGRES_POOL_MAX: '4',
      POSTGRES_CONNECTION_TIMEOUT_MS: '1200',
      POSTGRES_STATEMENT_TIMEOUT_MS: '8000',
    }),
  ).toMatchObject({
    host: 'db.internal',
    database: 'pqs',
    user: 'cnadmin',
    password: ' secret with spaces ',
    port: 6543,
    max: 4,
    connectionTimeoutMillis: 1200,
    statement_timeout: 8000,
  });
});

test.each([
  'POSTGRES_HOST',
  'POSTGRES_DATABASE',
  'POSTGRES_USERNAME',
  'POSTGRES_PASSWORD',
] as const)('requires %s', (name) => {
  const env = { ...validEnvironment, [name]: undefined };
  expect(() => readPostgresConfig(env)).toThrow(`${name} is required for PQS database access`);
});

test.each([
  ['POSTGRES_PORT', '0'],
  ['POSTGRES_PORT', '65536'],
  ['POSTGRES_PORT', '1.2'],
  ['POSTGRES_PORT', ' 5432 '],
  ['POSTGRES_POOL_MAX', '0'],
  ['POSTGRES_POOL_MAX', '-1'],
  ['POSTGRES_POOL_MAX', '1.5'],
  ['POSTGRES_STATEMENT_TIMEOUT_MS', '0'],
  ['POSTGRES_CONNECTION_TIMEOUT_MS', '0'],
  ['POSTGRES_CONNECTION_TIMEOUT_MS', '-1'],
  ['POSTGRES_CONNECTION_TIMEOUT_MS', '1.5'],
] as const)('rejects invalid %s value %s', (name, value) => {
  expect(() => readPostgresConfig({ ...validEnvironment, [name]: value })).toThrow(
    `${name} must be an integer between 1 and`,
  );
});

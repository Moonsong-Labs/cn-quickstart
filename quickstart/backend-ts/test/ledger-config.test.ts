import { expect, test } from 'bun:test';
import { readLedgerConfig } from '../src/config/ledger';

const environment = {
  LEDGER_API_URL: 'http://localhost:3975',
  LEDGER_API_ALLOW_HTTP: 'true',
  LEDGER_API_USER_ID: 'app-provider-backend',
};

test('Reads ledger settings without requiring Quickstart application configuration', () => {
  const config = readLedgerConfig(environment);

  expect(config.baseUrl.href).toBe('http://localhost:3975/');
  expect(config.ledgerUserId).toBe('app-provider-backend');
});

test('Supports HTTPS endpoints with a reverse-proxy path', () => {
  const config = readLedgerConfig({
    ...environment,
    LEDGER_API_URL: 'https://ledger.example.com/api/',
    LEDGER_API_ALLOW_HTTP: undefined,
  });

  expect(config.baseUrl.href).toBe('https://ledger.example.com/api/');
});

test.each(['LEDGER_API_URL', 'LEDGER_API_USER_ID'])('Rejects missing or blank %s', (name) => {
  for (const value of [undefined, '', '   ']) {
    expect(() => readLedgerConfig({ ...environment, [name]: value })).toThrow(
      `${name} is required for Ledger API access`,
    );
  }
});

test.each([
  'localhost:3975',
  '/ledger',
  'ftp://ledger.example.com',
  'http://user:secret@ledger.example.com',
  'https://ledger.example.com?token=secret',
  'https://ledger.example.com#fragment',
])('Rejects an invalid ledger endpoint', (endpoint) => {
  expect(() => readLedgerConfig({ ...environment, LEDGER_API_URL: endpoint })).toThrow(
    'LEDGER_API_URL',
  );
});

test('Configuration errors do not include endpoint credentials', () => {
  expect.assertions(2);
  try {
    readLedgerConfig({
      ...environment,
      LEDGER_API_URL: 'https://user:private-value@ledger.example.com',
    });
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain('private-value');
  }
});

test.each([undefined, 'false'])('Rejects HTTP without explicit permission: %j', (allowHttp) => {
  expect(() => readLedgerConfig({ ...environment, LEDGER_API_ALLOW_HTTP: allowHttp })).toThrow(
    'LEDGER_API_URL must use HTTPS, or HTTP with LEDGER_API_ALLOW_HTTP=true',
  );
});

test.each(['yes', '', 'TRUE'])('Rejects invalid Ledger HTTP permission: %j', (allowHttp) => {
  expect(() => readLedgerConfig({ ...environment, LEDGER_API_ALLOW_HTTP: allowHttp })).toThrow(
    'LEDGER_API_ALLOW_HTTP must be true or false',
  );
});

test('OAuth HTTP permission does not authorize Ledger HTTP access', () => {
  expect(() =>
    readLedgerConfig({
      ...environment,
      LEDGER_API_ALLOW_HTTP: undefined,
      LEDGER_OAUTH_ALLOW_HTTP: 'true',
    }),
  ).toThrow('LEDGER_API_ALLOW_HTTP=true');
});

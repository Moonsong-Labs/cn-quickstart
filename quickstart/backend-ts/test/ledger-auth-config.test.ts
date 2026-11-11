import { expect, test } from 'bun:test';
import { AuthMode } from '../src/config/auth-mode';
import { readLedgerAuthConfig } from '../src/config/ledger';

const oauth = {
  AUTH_MODE: AuthMode.OAuth2,
  AUTH_APP_PROVIDER_ISSUER_URL: 'https://idp.example.com/realm',
  AUTH_APP_PROVIDER_BACKEND_CLIENT_ID: 'service-client',
  AUTH_APP_PROVIDER_BACKEND_SECRET: 'service-secret',
};

test('Defaults to the existing static onboarding token mode', () => {
  expect(readLedgerAuthConfig({ APP_PROVIDER_BACKEND_USER_TOKEN: 'static-token' })).toEqual({
    method: 'static',
    token: 'static-token',
  });
});

test('Reads OAuth credentials independently of the static token', () => {
  expect(readLedgerAuthConfig(oauth)).toMatchObject({
    method: 'client_credentials',
    clientId: 'service-client',
    clientSecret: 'service-secret',
    allowHttp: false,
  });
});

test.each([
  'AUTH_APP_PROVIDER_ISSUER_URL',
  'AUTH_APP_PROVIDER_BACKEND_CLIENT_ID',
  'AUTH_APP_PROVIDER_BACKEND_SECRET',
])('Requires OAuth setting %s', (name) => {
  expect(() => readLedgerAuthConfig({ ...oauth, [name]: undefined })).toThrow(name);
});

test('Requires explicit permission for a local HTTP identity provider', () => {
  const env = { ...oauth, AUTH_APP_PROVIDER_ISSUER_URL: 'http://localhost:8082/realm' };
  expect(() => readLedgerAuthConfig(env)).toThrow('HTTPS');
  expect(readLedgerAuthConfig({ ...env, LEDGER_OAUTH_ALLOW_HTTP: 'true' })).toMatchObject({
    allowHttp: true,
  });
});

test('Rejects unknown authentication modes and invalid HTTP flags', () => {
  expect(() => readLedgerAuthConfig({ AUTH_MODE: 'unknown' })).toThrow('AUTH_MODE');
  expect(() => readLedgerAuthConfig({ ...oauth, LEDGER_OAUTH_ALLOW_HTTP: 'yes' })).toThrow(
    'LEDGER_OAUTH_ALLOW_HTTP',
  );
});

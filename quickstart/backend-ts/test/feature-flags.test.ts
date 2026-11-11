import { expect, test } from 'bun:test';
import { createApp } from '../src/app';
import { readApplicationConfig } from '../src/config/application';
import { appDependencies } from './fixtures/dependencies';

test.each(['oauth2', 'shared-secret'])(
  'Public feature flags expose only the %s mode',
  async (mode) => {
    const application = readApplicationConfig({
      AUTH_MODE: mode,
      APP_PROVIDER_PARTY: 'provider',
      AUTH_APP_PROVIDER_ISSUER_URL: 'https://issuer.example',
      AUTH_APP_PROVIDER_BACKEND_OIDC_CLIENT_ID: 'browser',
    });
    const app = createApp({ ...appDependencies, application });
    const response = await app.handle(new Request('http://localhost/feature-flags'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ authMode: mode });
  },
);

test('Ledger client ID cannot replace a missing browser client ID', () => {
  expect(() =>
    readApplicationConfig({
      AUTH_MODE: 'oauth2',
      APP_PROVIDER_PARTY: 'provider',
      AUTH_APP_PROVIDER_ISSUER_URL: 'https://issuer.example',
      AUTH_APP_PROVIDER_BACKEND_CLIENT_ID: 'service',
    }),
  ).toThrow('AUTH_APP_PROVIDER_BACKEND_OIDC_CLIENT_ID');
});

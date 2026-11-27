import { expect, test } from 'bun:test';
import { readApplicationConfig } from '../src/config/application';
import { AuthMode } from '../src/config/auth-mode';

test('Reads and trims the App Provider party independently of Ledger API settings', () => {
  expect(readApplicationConfig({ APP_PROVIDER_PARTY: ' provider::test ' })).toEqual({
    authMode: AuthMode.SharedSecret,
    appProvider: {
      tenantId: 'AppProvider',
      internal: true,
      partyId: 'provider::test',
      users: ['app-provider'],
    },
  });
});

test('Requires an App Provider party when loading Quickstart application settings', () => {
  for (const party of [undefined, '', '   ']) {
    expect(() => readApplicationConfig({ APP_PROVIDER_PARTY: party })).toThrow(
      'APP_PROVIDER_PARTY is required for the Quickstart application',
    );
  }
});

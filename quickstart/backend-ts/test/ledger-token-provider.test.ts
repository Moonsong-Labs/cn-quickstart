import { expect, test } from 'bun:test';
import { createStaticTokenProvider } from '../src/integrations/ledger/token-provider';

test('Provides the configured token and service identity without decoding the token', async () => {
  const provider = createStaticTokenProvider({
    token: 'configured-token',
    ledgerUserId: 'backend-service',
  });

  expect(await provider.getAccessToken()).toBe('configured-token');
  expect(await provider.getAuthContext()).toEqual({
    userId: 'backend-service',
    accessToken: 'configured-token',
  });
});

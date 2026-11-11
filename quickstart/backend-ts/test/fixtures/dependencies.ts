import { LedgerClient } from '@canton-network/core-ledger-client';
import type { AppDependencies } from '../../src/app';
import { createStaticTokenProvider } from '../../src/integrations/ledger/token-provider';

const ledgerUserId = 'test-backend';

// Health and documentation tests need dependencies without a participant connection.
export const appDependencies: AppDependencies = {
  ledger: {
    client: new LedgerClient({
      baseUrl: new URL('http://ledger.invalid'),
      accessTokenProvider: createStaticTokenProvider({ ledgerUserId, token: 'test-token' }),
    }),
    ledgerUserId,
  },
  application: { appProviderParty: 'test-provider' },
};

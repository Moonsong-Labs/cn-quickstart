import { LedgerClient } from '@canton-network/core-ledger-client';
import { Pool } from 'pg';
import type { AppDependencies } from '../../src/app';
import { readApplicationConfig } from '../../src/config/application';
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
  application: readApplicationConfig({ APP_PROVIDER_PARTY: 'test-provider' }),
  pqs: new Pool({ host: 'postgres.invalid', ssl: false }),
};

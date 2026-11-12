import { Pool } from 'pg';
import { createApp } from './app';
import { readApplicationConfig } from './config/application';
import { loadConfig } from './config/env';
import { readPostgresConfig } from './config/postgres';
import { connectLedger } from './integrations/ledger/connect';
import { LedgerApiError } from './integrations/ledger/error';

/**
 * Loads configuration, connects to the Ledger, and verifies that the authenticated user
 * matches LEDGER_API_USER_ID and is active before building the app. Any failure rejects.
 */
export async function createApplication(env: NodeJS.ProcessEnv = process.env) {
  const config = loadConfig(env);
  const application = readApplicationConfig(env);
  const postgres = readPostgresConfig(env);
  const ledger = await connectLedger(env);
  const { user } = await ledger.client.get('/v2/authenticated-user').catch((cause: unknown) => {
    throw new LedgerApiError('Failed to verify Ledger API identity', { cause });
  });
  if (!user) throw new Error('Ledger API response is missing the authenticated user');
  if (user.id !== ledger.ledgerUserId)
    throw new Error('Authenticated Ledger API user does not match LEDGER_API_USER_ID');
  if (user.isDeactivated) throw new Error('Authenticated Ledger API user is deactivated');

  const pqs = new Pool(postgres);
  pqs.on('error', () => console.error('PQS database connection failed'));
  try {
    // Validate the PQS schema even when no contracts have been ingested.
    await pqs
      .query('SELECT contract_id, payload, contract_key FROM active() LIMIT 0')
      .catch((cause: unknown) => {
        throw new Error('Failed to verify PQS database', { cause });
      });
    return { app: createApp({ ledger, application, pqs }, config), config, pqs };
  } catch (error) {
    await pqs.end();
    throw error;
  }
}

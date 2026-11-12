import { beforeAll, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { createApplication } from '../src/bootstrap';
import { readApplicationConfig } from '../src/config/application';
import { AppInstallRequest } from '../src/daml/licensing';
import { createLedgerClient } from '../src/integrations/ledger/client';
import { connectLedger } from '../src/integrations/ledger/connect';
import { createStaticTokenProvider } from '../src/integrations/ledger/token-provider';
import { createAppInstallRequest } from '../src/modules/app-installations';

const INTEGRATION_TIMEOUT_MS = 30_000;
let connection: Awaited<ReturnType<typeof connectLedger>>;
let application: ReturnType<typeof readApplicationConfig>;

// These tests contact the configured participant directly and require a provisioned LocalNet.
// The integration runner owns this disposable LocalNet and removes its contracts afterward.
beforeAll(async () => {
  application = readApplicationConfig();
  connection = await connectLedger();
}, INTEGRATION_TIMEOUT_MS);

test(
  'Authenticates as the configured Ledger API service user',
  async () => {
    const { user } = await connection.client.get('/v2/authenticated-user');

    expect(user.id).toBe(connection.ledgerUserId);
    expect(user.isDeactivated ?? false).toBe(false);
  },
  INTEGRATION_TIMEOUT_MS,
);

test(
  'Has ActAs and ReadAs rights for the configured App Provider party',
  async () => {
    const { rights = [] } = await connection.client.get('/v2/users/{user-id}/rights', {
      path: { 'user-id': connection.ledgerUserId },
    });

    const canActAs = rights.some(
      ({ kind }) =>
        kind && 'CanActAs' in kind && kind.CanActAs.value.party === application.appProviderParty,
    );
    const canReadAs = rights.some(
      ({ kind }) =>
        kind && 'CanReadAs' in kind && kind.CanReadAs.value.party === application.appProviderParty,
    );

    expect(canActAs).toBe(true);
    expect(canReadAs).toBe(true);
  },
  INTEGRATION_TIMEOUT_MS,
);

test(
  'Reads an active-contract snapshot visible to the App Provider',
  async () => {
    const { offset = 0 } = await connection.client.get('/v2/state/ledger-end');
    expect(offset).toBeGreaterThanOrEqual(0);

    const contracts = await connection.client.post(
      '/v2/state/active-contracts',
      {
        activeAtOffset: offset,
        eventFormat: {
          filtersByParty: { [application.appProviderParty]: {} },
          verbose: false,
        },
      },
      { query: { limit: '1' } },
    );

    // An empty snapshot is valid; successful retrieval is what verifies party-scoped read access.
    expect(Array.isArray(contracts)).toBe(true);
  },
  INTEGRATION_TIMEOUT_MS,
);

test(
  'Creates an installation request as the App User and reads the committed contract',
  async () => {
    const {
      APP_USER_LEDGER_API_URL: url,
      APP_USER_PARTY: user,
      APP_USER_TOKEN: token,
      APP_USER_LEDGER_USER_ID: ledgerUserId,
    } = process.env;
    if (!url || !user || !token || !ledgerUserId)
      throw new Error('Missing integration App User identity');
    const baseUrl = new URL(url);
    // The token comes from Keycloak via Quickstart's demo wallet onboarding.
    const client = await createLedgerClient({
      baseUrl,
      accessTokenProvider: createStaticTokenProvider({ token, ledgerUserId }),
    });
    const { user: ledgerUser } = await client.get('/v2/authenticated-user');
    expect(ledgerUser.id).toBe(ledgerUserId);
    const { rights = [] } = await client.get('/v2/users/{user-id}/rights', {
      path: { 'user-id': ledgerUserId },
    });
    expect(
      rights.some(({ kind }) => kind && 'CanActAs' in kind && kind.CanActAs.value.party === user),
    ).toBe(true);

    const request = {
      provider: application.appProviderParty,
      user,
      meta: { values: { integrationTest: randomUUID() } },
    } satisfies AppInstallRequest;
    const result = await createAppInstallRequest({ client, ledgerUserId }, request, randomUUID());
    expect(result.updateId).not.toBe('');
    expect(result.completionOffset).toBeGreaterThan(0);

    const contracts = await client.post('/v2/state/active-contracts', {
      activeAtOffset: result.completionOffset,
      eventFormat: { filtersByParty: { [user]: {} }, verbose: false },
    });
    const created = contracts
      .flatMap(({ contractEntry }) =>
        contractEntry && 'JsActiveContract' in contractEntry
          ? [contractEntry.JsActiveContract.createdEvent]
          : [],
      )
      // Events identify packages by hash; generated bindings address them by package name.
      .filter(
        (event) =>
          `#${event.packageName}:${event.templateId.split(':').slice(1).join(':')}` ===
          AppInstallRequest.templateId,
      );
    const matching = created.filter(
      (event) =>
        AppInstallRequest.decoder.runWithException(event.createArgument).meta.values
          .integrationTest === request.meta.values.integrationTest,
    );
    expect(matching).toHaveLength(1);
    expect(matching[0].contractId).not.toBe('');
    expect(AppInstallRequest.decoder.runWithException(matching[0].createArgument)).toEqual(request);
    expect(matching[0].signatories).toEqual([user]);
    expect(matching[0].observers).toContain(application.appProviderParty);
  },
  INTEGRATION_TIMEOUT_MS,
);

test(
  'Initializes the application with its LocalNet service connection',
  async () => {
    const { app, pqs } = await createApplication();
    try {
      expect(app.decorator.application.appProviderParty).toBe(application.appProviderParty);
      expect(app.decorator.ledger.ledgerUserId).toBe(connection.ledgerUserId);
      const health = await app.handle(new Request('http://localhost/health'));
      expect(health.status).toBe(200);
      expect((await pqs.query('SELECT current_database() AS name')).rows[0].name).toBe(
        process.env.POSTGRES_DATABASE,
      );
    } finally {
      await pqs.end();
    }
  },
  INTEGRATION_TIMEOUT_MS,
);

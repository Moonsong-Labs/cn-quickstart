import { afterEach, expect, spyOn, test } from 'bun:test';
import type { LedgerCommonSchemas } from '@canton-network/core-ledger-client-types';
import { ContractId } from '@daml/types';
import { Pool } from 'pg';
import { createApp } from '../src/app';
import { readApplicationConfig } from '../src/config/application';
import { AppInstall } from '../src/daml/licensing';
import { appDependencies } from './fixtures/dependencies';

const pools: Pool[] = [];
const providerParty = 'provider-party';
const customerParty = 'customer-party';
const contractId = 'installation-contract';
const commandId = 'cancel-command';
const operationMeta = { data: { reason: 'Customer cancelled' } };

/** Builds a typed active installation row in the shape returned by PQS. */
function installRow(id: string, provider: string, user: string) {
  const payload: AppInstall = {
    provider,
    user,
    meta: { values: { source: 'customer-request' } },
    numLicensesCreated: '0',
  };
  return { contract_id: id, payload };
}

/** Confirms a consuming cancellation choice with Daml Unit as its result. */
function cancelResponse(id = contractId) {
  const event: LedgerCommonSchemas['Event'] = {
    ExercisedEvent: {
      offset: 42,
      nodeId: 0,
      contractId: ContractId(AppInstall).decoder.runWithException(id),
      templateId: AppInstall.templateId,
      choice: AppInstall.AppInstall_Cancel.choiceName,
      choiceArgument: { actor: providerParty, meta: { values: operationMeta.data } },
      actingParties: [providerParty],
      consuming: true,
      witnessParties: [providerParty],
      lastDescendantNodeId: 0,
      exerciseResult: {},
      packageName: 'quickstart-licensing',
      acsDelta: true,
    },
  };
  return {
    transaction: {
      updateId: 'installation-cancel-update',
      offset: 42,
      events: [event],
      effectiveAt: '2026-11-24T12:00:00Z',
      recordTime: '2026-11-24T12:00:00Z',
      synchronizerId: 'synchronizer::test',
    },
  };
}

/** Creates the app with shared-secret sessions and observable PQS and ledger boundaries. */
function setup(rows: object[], ledgerResponse: unknown = cancelResponse()) {
  const pqs = new Pool();
  pools.push(pqs);
  const query = spyOn(pqs, 'query').mockResolvedValue({ rows } as never);
  const submissions: { path: string; body: unknown }[] = [];
  const client = {
    async post(path: string, body: unknown) {
      submissions.push({ path, body });
      if (ledgerResponse instanceof Error) throw ledgerResponse;
      return ledgerResponse;
    },
  };
  const application = readApplicationConfig({
    AUTH_MODE: 'shared-secret',
    APP_PROVIDER_PARTY: providerParty,
  });
  const app = createApp({
    ...appDependencies,
    ledger: { client, ledgerUserId: 'backend-service' } as never,
    application,
    pqs,
  });

  async function login(username: string) {
    const response = await app.handle(
      new Request('http://localhost/login', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ username }),
      }),
    );
    expect(response.status).toBe(302);
    const cookie = response.headers.get('set-cookie')?.split(';')[0] ?? '';
    expect(cookie).toStartWith('JSESSIONID=');
    return cookie;
  }

  async function registerUser(cookie: string, username: string, partyId: string) {
    const response = await app.handle(
      new Request('http://localhost/admin/tenant-registrations', {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ tenantId: username, partyId, users: [username] }),
      }),
    );
    expect(response.status).toBe(201);
  }

  return { app, login, registerUser, query, submissions };
}

/** Sends a cancellation request using the public command ID and metadata shape. */
function cancel(
  app: ReturnType<typeof createApp>,
  cookie: string,
  id = contractId,
  body: unknown = { meta: operationMeta },
  queryCommandId: string | null = commandId,
) {
  const search = queryCommandId === null ? '' : `?commandId=${encodeURIComponent(queryCommandId)}`;
  return app.handle(
    new Request(`http://localhost/app-installs/${encodeURIComponent(id)}:cancel${search}`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.end()));
});

test.each(['customer', 'app-provider'])(
  'Cancels an installation for the %s session as AppProvider',
  async (username) => {
    const { app, login, registerUser, query, submissions } = setup([
      installRow(contractId, providerParty, customerParty),
    ]);
    const provider = await login('app-provider');
    await registerUser(provider, 'customer', customerParty);
    const cookie = username === 'customer' ? await login('customer') : provider;

    const response = await cancel(app, cookie);

    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(
      'SELECT contract_id, payload FROM active($1) WHERE contract_id = $2',
      ['quickstart-licensing:Licensing.AppInstall:AppInstall', contractId],
    );
    expect(submissions).toHaveLength(1);
    expect(submissions[0]?.path).toBe('/v2/commands/submit-and-wait-for-transaction');
    expect(submissions[0]?.body).toEqual({
      commands: {
        userId: 'backend-service',
        commandId,
        actAs: [providerParty],
        readAs: [providerParty],
        commands: [
          {
            ExerciseCommand: {
              templateId: AppInstall.templateId,
              contractId,
              choice: AppInstall.AppInstall_Cancel.choiceName,
              choiceArgument: {
                actor: providerParty,
                meta: { values: operationMeta.data },
              },
            },
          },
        ],
      },
      transactionFormat: {
        transactionShape: 'TRANSACTION_SHAPE_LEDGER_EFFECTS',
        eventFormat: { filtersByParty: { [providerParty]: {} }, verbose: false },
      },
    });
  },
);

test('Forbids an unrelated party after checking the installation and without submitting', async () => {
  const { app, login, registerUser, query, submissions } = setup([
    installRow(contractId, providerParty, customerParty),
  ]);
  const provider = await login('app-provider');
  await registerUser(provider, 'customer', customerParty);
  await registerUser(provider, 'unrelated', 'unrelated-party');
  const unrelated = await login('unrelated');

  expect((await cancel(app, unrelated)).status).toBe(403);
  expect(query).toHaveBeenCalledTimes(1);
  expect(submissions).toEqual([]);
});

test('Returns not found for an absent installation without submitting', async () => {
  const { app, login, submissions } = setup([]);
  expect((await cancel(app, await login('app-provider'))).status).toBe(404);
  expect(submissions).toEqual([]);
});

test('Requires authentication before querying PQS', async () => {
  const { app, query, submissions } = setup([installRow(contractId, providerParty, customerParty)]);
  const response = await app.handle(
    new Request(`http://localhost/app-installs/${contractId}:cancel?commandId=${commandId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ meta: operationMeta }),
    }),
  );
  expect(response.status).toBe(401);
  expect(query).not.toHaveBeenCalled();
  expect(submissions).toEqual([]);
});

test.each([
  ['missing command ID', null, { meta: operationMeta }],
  ['blank command ID', '   ', { meta: operationMeta }],
  ['missing metadata', commandId, {}],
  ['null metadata', commandId, { meta: null }],
  ['non-object metadata data', commandId, { meta: { data: 7 } }],
  ['non-string metadata value', commandId, { meta: { data: { reason: 7 } } }],
])('Rejects cancellation with %s before reading PQS', async (_label, queryCommandId, body) => {
  const { app, login, query, submissions } = setup([
    installRow(contractId, providerParty, customerParty),
  ]);
  const response = await cancel(app, await login('app-provider'), contractId, body, queryCommandId);
  expect(response.status).toBe(400);
  expect(response.headers.get('content-type')).toContain('application/problem+json');
  expect(query).not.toHaveBeenCalled();
  expect(submissions).toEqual([]);
});

test('Returns a sanitized error when the ledger rejects cancellation', async () => {
  const { app, login, submissions } = setup(
    [installRow(contractId, providerParty, customerParty)],
    new Error('private ledger response details'),
  );
  const response = await cancel(app, await login('app-provider'));
  expect(response.status).toBe(500);
  expect(await response.text()).not.toContain('private ledger response details');
  expect(submissions).toHaveLength(1);
});

test('Forbids cancellation if the configured provider is not a signatory', async () => {
  const { app, login, registerUser, query, submissions } = setup([
    installRow(contractId, 'different-provider', customerParty),
  ]);
  const provider = await login('app-provider');
  await registerUser(provider, 'customer', customerParty);
  const response = await cancel(app, await login('customer'));
  expect(response.status).toBe(403);
  expect(query).toHaveBeenCalledTimes(1);
  expect(submissions).toEqual([]);
});

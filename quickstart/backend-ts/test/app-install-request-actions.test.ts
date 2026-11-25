import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import type { JsCantonError } from '@canton-network/core-ledger-client';
import type { LedgerCommonSchemas } from '@canton-network/core-ledger-client-types';
import { ContractId } from '@daml/types';
import { Pool } from 'pg';
import { createApp } from '../src/app';
import { readApplicationConfig } from '../src/config/application';
import { AppInstall, AppInstallRequest } from '../src/daml/licensing';
import { appDependencies } from './fixtures/dependencies';

const pools: Pool[] = [];
const providerParty = 'provider-party';
const contractId = 'request-contract';
const commandId = 'accept-command';
const installMeta = { data: { description: 'Approved installation' } };
const operationMeta = { data: { reason: 'Customer approved' } };

/** Builds a request contract with metadata in the shape returned by PQS. */
function requestRow(id: string, provider: string, user: string) {
  return {
    contract_id: id,
    payload: {
      provider,
      user,
      meta: { values: { description: 'Requested installation' } },
    },
  };
}

/** Confirms a consuming installation request exercise with the result from its choice. */
function exerciseResponse(
  choice: string,
  choiceArgument: LedgerCommonSchemas['ExercisedEvent']['choiceArgument'],
  exerciseResult: LedgerCommonSchemas['ExercisedEvent']['exerciseResult'],
  id = contractId,
) {
  /** Describes the exercised Daml choice and its contract result. */
  const event: LedgerCommonSchemas['Event'] = {
    ExercisedEvent: {
      offset: 42,
      nodeId: 0,
      contractId: ContractId(AppInstallRequest).decoder.runWithException(id),
      templateId: AppInstallRequest.templateId,
      choice,
      choiceArgument,
      actingParties: [providerParty],
      consuming: true,
      witnessParties: [providerParty],
      lastDescendantNodeId: 0,
      exerciseResult,
      packageName: 'quickstart-licensing',
      acsDelta: true,
    },
  };
  return {
    transaction: {
      updateId: 'request-action-update',
      offset: 42,
      events: [event],
      effectiveAt: '2026-11-24T12:00:00Z',
      recordTime: '2026-11-24T12:00:00Z',
      synchronizerId: 'synchronizer::test',
    },
  };
}

/** Returns the installation contract ID produced by the accept choice. */
function acceptResponse(id = contractId, installationId = 'created-installation') {
  return exerciseResponse(
    AppInstallRequest.AppInstallRequest_Accept.choiceName,
    { installMeta: { values: installMeta.data }, meta: { values: operationMeta.data } },
    ContractId(AppInstall).decoder.runWithException(installationId),
    id,
  );
}

/** Returns Daml Unit after the ledger consumes the rejected request. */
function rejectResponse() {
  return exerciseResponse(
    AppInstallRequest.AppInstallRequest_Reject.choiceName,
    { meta: { values: operationMeta.data } },
    {},
  );
}

/** Creates a real app with shared-secret sessions and observable PQS and ledger boundaries. */
function setup(rows: object[], ledgerResponse: unknown = acceptResponse()) {
  /** The query stub returns PQS contract rows without opening a connection. */
  const pqs = new Pool();
  pools.push(pqs);
  const query = spyOn(pqs, 'query').mockResolvedValue({ rows } as never);
  /** Captures Ledger API submissions made by the app provider. */
  const submissions: { path: string; body: unknown }[] = [];
  const ledgerResult = mock(async () => {
    if (ledgerResponse instanceof Error) throw ledgerResponse;
    return ledgerResponse;
  });
  const client = {
    async post(path: string, body: unknown) {
      submissions.push({ path, body });
      return ledgerResult();
    },
  };
  /** Uses the provider party configured for this test's authorization checks. */
  const application = readApplicationConfig({
    AUTH_MODE: 'shared-secret',
    APP_PROVIDER_PARTY: providerParty,
  });
  /** Connects the fake participant client and PQS pool to the real HTTP application. */
  const app = createApp({
    ...appDependencies,
    ledger: { client, ledgerUserId: 'backend-service' } as never,
    application,
    pqs,
  });

  /** Starts a normal browser session through the shared-secret login endpoint. */
  async function login(username: string) {
    /** Holds the response containing the new session cookie. */
    const response = await app.handle(
      new Request('http://localhost/login', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ username }),
      }),
    );
    expect(response.status).toBe(302);
    /** Returns the session cookie used by authenticated routes. */
    const cookie = response.headers.get('set-cookie')?.split(';')[0] ?? '';
    expect(cookie).toStartWith('JSESSIONID=');
    return cookie;
  }

  /** Registers a customer tenant through the authenticated provider endpoint. */
  async function registerCustomer(cookie: string, partyId: string) {
    /** Holds the tenant registration response. */
    const response = await app.handle(
      new Request('http://localhost/admin/tenant-registrations', {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ tenantId: 'Customer', partyId, users: ['customer'] }),
      }),
    );
    expect(response.status).toBe(201);
  }

  return { app, login, registerCustomer, query, submissions, ledgerResult };
}

/** Sends an acceptance request with the API's query command ID and metadata shape. */
function accept(
  app: ReturnType<typeof createApp>,
  cookie: string,
  id = contractId,
  acceptanceCommandId = commandId,
) {
  return app.handle(
    new Request(
      `http://localhost/app-install-requests/${encodeURIComponent(id)}:accept?commandId=${acceptanceCommandId}`,
      {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ installMeta, meta: operationMeta }),
      },
    ),
  );
}

/** Sends a rejection request with operation metadata and its command ID. */
function reject(
  app: ReturnType<typeof createApp>,
  cookie: string,
  id = contractId,
  body: { meta: { data?: Record<string, string> } } = { meta: operationMeta },
) {
  return app.handle(
    new Request(
      `http://localhost/app-install-requests/${encodeURIComponent(id)}:reject?commandId=${commandId}`,
      {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
    ),
  );
}

afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.end()));
});

test('Accepts a request as AppProvider and returns the installation from the ledger result', async () => {
  /** Supplies the active request observed by the provider. */
  const { app, login, query, submissions } = setup([
    requestRow(contractId, providerParty, 'customer-party'),
  ]);
  /** Authenticates the AppProvider through its regular shared-secret session. */
  const provider = await login('app-provider');
  /** Exercises the accept choice through the public API. */
  const response = await accept(app, provider);

  expect(response.status).toBe(201);
  expect(response.headers.get('content-type')).toContain('application/json');
  expect(await response.json()).toEqual({
    contractId: 'created-installation',
    provider: providerParty,
    user: 'customer-party',
    meta: installMeta,
    numLicensesCreated: 0,
    licenseNum: null,
  });
  expect(query).toHaveBeenCalledTimes(1);
  expect(query).toHaveBeenCalledWith(
    'SELECT contract_id, payload FROM active($1) WHERE contract_id = $2',
    ['quickstart-licensing:Licensing.AppInstall:AppInstallRequest', contractId],
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
            templateId: AppInstallRequest.templateId,
            contractId,
            choice: AppInstallRequest.AppInstallRequest_Accept.choiceName,
            choiceArgument: {
              installMeta: { values: installMeta.data },
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
});

test('Requires authentication and AppProvider authorization before reading or exercising the request', async () => {
  /** Supplies an active request for a customer and the configured provider. */
  const { app, login, registerCustomer, query, submissions } = setup([
    requestRow(contractId, providerParty, 'customer-party'),
  ]);
  /** Creates the customer login using the normal tenant registration flow. */
  const provider = await login('app-provider');
  await registerCustomer(provider, 'customer-party');
  /** Authenticates as a customer with no AppProvider role. */
  const customer = await login('customer');
  /** Sends the same acceptance request without any session. */
  const unauthenticated = await app.handle(
    new Request(
      `http://localhost/app-install-requests/${contractId}:accept?commandId=${commandId}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ installMeta, meta: operationMeta }),
      },
    ),
  );
  expect(unauthenticated.status).toBe(401);
  expect(query).not.toHaveBeenCalled();
  /** Attempts acceptance from the authenticated but non-admin customer session. */
  const forbidden = await accept(app, customer);
  expect(forbidden.status).toBe(403);
  expect(query).not.toHaveBeenCalled();
  expect(submissions).toEqual([]);
});

test('Returns not found without submitting when the request is absent or belongs to another provider', async () => {
  /** Uses an empty PQS result to model an archived or unknown request. */
  const missing = setup([]);
  /** Authenticates as AppProvider and requests the absent contract. */
  const provider = await missing.login('app-provider');
  const response = await accept(missing.app, provider);
  expect(response.status).toBe(404);
  expect(missing.submissions).toEqual([]);

  /** A live request addressed to another provider is not eligible for acceptance here. */
  const foreign = setup([requestRow(contractId, 'other-provider', 'customer-party')]);
  /** Authenticates to exercise the provider-only access check. */
  const foreignProvider = await foreign.login('app-provider');
  const denied = await accept(foreign.app, foreignProvider);
  expect(denied.status).toBe(404);
  expect(foreign.submissions).toEqual([]);
});

test('Returns 404 when PQS still lists an installation request already accepted on Canton', async () => {
  const { app, login, query, submissions, ledgerResult } = setup([
    requestRow(contractId, providerParty, 'customer-party'),
  ]);
  const provider = await login('app-provider');
  expect((await accept(app, provider)).status).toBe(201);

  // PQS keeps returning the same row while Canton has already consumed the request.
  ledgerResult.mockRejectedValueOnce({
    code: 'CONTRACT_NOT_FOUND',
    cause: `Contract could not be found with id ${contractId}`,
    context: {},
    errorCategory: 11,
    grpcCodeValue: 5,
  } satisfies JsCantonError);
  // A distinct command ID makes this a new exercise instead of a replay of the first command.
  const secondCommandId = 'second-accept-command';
  const response = await accept(app, provider, contractId, secondCommandId);

  expect(query).toHaveBeenCalledTimes(2);
  expect(submissions).toHaveLength(2);
  expect(submissions[1]?.body).toMatchObject({
    commands: {
      commandId: secondCommandId,
      commands: [
        {
          ExerciseCommand: {
            contractId,
            choice: AppInstallRequest.AppInstallRequest_Accept.choiceName,
          },
        },
      ],
    },
  });
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ message: 'Installation request not found' });
});

test('Returns a sanitized ledger error when acceptance fails', async () => {
  /** Simulates an unexpected failure from the Ledger API. */
  const { app, login, submissions } = setup(
    [requestRow(contractId, providerParty, 'customer-party')],
    new Error('private ledger response details'),
  );
  /** Exercises the route under a valid AppProvider session. */
  const response = await accept(app, await login('app-provider'));
  expect(response.status).toBe(500);
  expect(await response.text()).not.toContain('private ledger response details');
  expect(submissions).toHaveLength(1);
});

test('Logs the command and update IDs when the confirmed acceptance result cannot be decoded', async () => {
  const ledgerResponse = exerciseResponse(
    AppInstallRequest.AppInstallRequest_Accept.choiceName,
    { installMeta: { values: installMeta.data }, meta: { values: operationMeta.data } },
    {},
  );
  const { app, login } = setup(
    [requestRow(contractId, providerParty, 'customer-party')],
    ledgerResponse,
  );
  const provider = await login('app-provider');
  const log = spyOn(console, 'error').mockImplementation(() => {});
  try {
    const response = await accept(app, provider);

    expect(log).toHaveBeenCalledWith('Processing installation action failed', {
      errorName: 'LedgerApiError',
      commandId,
      updateId: ledgerResponse.transaction.updateId,
    });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ message: 'Internal Server Error' });
  } finally {
    log.mockRestore();
  }
});

test.each([
  ['missing command ID', undefined, { installMeta, meta: operationMeta }],
  ['whitespace-only command ID', '   ', { installMeta, meta: operationMeta }],
  ['missing operation metadata', commandId, { installMeta }],
  ['null installation metadata', commandId, { installMeta: null, meta: operationMeta }],
  ['numeric metadata map', commandId, { installMeta: { data: 42 }, meta: operationMeta }],
  [
    'nonstring installation metadata value',
    commandId,
    { installMeta: { data: { unexpected: 42 } }, meta: operationMeta },
  ],
  ['nonstring metadata value', commandId, { installMeta, meta: { data: { reason: 42 } } }],
])('Rejects an acceptance with %s before reading PQS', async (_case, queryCommandId, body) => {
  /** Provides an otherwise valid request so schema errors are the only failure. */
  const { app, login, query, submissions } = setup([
    requestRow(contractId, providerParty, 'customer-party'),
  ]);
  /** Authenticates as AppProvider through the ordinary browser login. */
  const cookie = await login('app-provider');
  /** Constructs the contract action URL with or without its required query command ID. */
  const search =
    queryCommandId === undefined ? '' : `?commandId=${encodeURIComponent(queryCommandId)}`;
  /** Submits the malformed acceptance payload. */
  const response = await app.handle(
    new Request(`http://localhost/app-install-requests/${contractId}:accept${search}`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
  expect(response.status).toBe(400);
  expect(response.headers.get('content-type')).toContain('application/problem+json');
  expect(query).not.toHaveBeenCalled();
  expect(submissions).toEqual([]);
});

test('Returns 404 for an unsupported request action suffix', async () => {
  /** Provides an active request that would be accepted by the supported action. */
  const { app, login, query, submissions } = setup([
    requestRow(contractId, providerParty, 'customer-party'),
  ]);
  /** Authenticates as AppProvider before trying an unsupported action. */
  const cookie = await login('app-provider');
  /** Calls a suffix that must not dispatch the accept choice. */
  const response = await app.handle(
    new Request(
      `http://localhost/app-install-requests/${contractId}:accept-extra?commandId=${commandId}`,
      {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ installMeta, meta: operationMeta }),
      },
    ),
  );
  expect(response.status).toBe(404);
  expect(query).not.toHaveBeenCalled();
  expect(submissions).toEqual([]);
});

test('Normalizes empty choice metadata to empty values', async () => {
  /** Supplies an eligible request and captures the choice sent to the ledger. */
  const { app, login, submissions } = setup([
    requestRow(contractId, providerParty, 'customer-party'),
  ]);
  /** Authenticates as AppProvider and submits empty metadata objects. */
  const cookie = await login('app-provider');
  const response = await app.handle(
    new Request(
      `http://localhost/app-install-requests/${contractId}:accept?commandId=${commandId}`,
      {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ installMeta: {}, meta: {} }),
      },
    ),
  );
  expect(response.status).toBe(201);
  expect(submissions).toHaveLength(1);
  const body = submissions[0]?.body as {
    commands: { commands: { ExerciseCommand: { choiceArgument: unknown } }[] };
  };
  expect(body.commands.commands[0]?.ExerciseCommand.choiceArgument).toEqual({
    installMeta: { values: {} },
    meta: { values: {} },
  });
});

test('Rejects a request as AppProvider and returns an empty response', async () => {
  const { app, login, query, submissions } = setup(
    [requestRow(contractId, providerParty, 'customer-party')],
    rejectResponse(),
  );
  const response = await reject(app, await login('app-provider'));

  expect(response.status).toBe(204);
  expect(await response.text()).toBe('');
  expect(query).toHaveBeenCalledTimes(1);
  expect(submissions).toHaveLength(1);
  expect(submissions[0]?.body).toMatchObject({
    commands: {
      commandId,
      actAs: [providerParty],
      readAs: [providerParty],
      commands: [
        {
          ExerciseCommand: {
            templateId: AppInstallRequest.templateId,
            contractId,
            choice: AppInstallRequest.AppInstallRequest_Reject.choiceName,
            choiceArgument: { meta: { values: operationMeta.data } },
          },
        },
      ],
    },
  });
});

test('Rejects a request even when the unused installMeta field is malformed', async () => {
  const { app, login, submissions } = setup(
    [requestRow(contractId, providerParty, 'customer-party')],
    rejectResponse(),
  );
  const provider = await login('app-provider');
  const body = { meta: operationMeta, installMeta: { data: { unexpected: 42 } } };

  const response = await reject(app, provider, contractId, body);

  expect(response.status).toBe(204);
  expect(submissions).toHaveLength(1);
  expect(submissions[0]?.body).toMatchObject({
    commands: {
      commands: [
        {
          ExerciseCommand: {
            contractId,
            choice: AppInstallRequest.AppInstallRequest_Reject.choiceName,
          },
        },
      ],
    },
  });
});

test('Allows an empty rejection metadata object and sends an empty map', async () => {
  const { app, login, submissions } = setup(
    [requestRow(contractId, providerParty, 'customer-party')],
    rejectResponse(),
  );
  const response = await reject(app, await login('app-provider'), contractId, { meta: {} });

  expect(response.status).toBe(204);
  const body = submissions[0]?.body as {
    commands: { commands: { ExerciseCommand: { choiceArgument: unknown } }[] };
  };
  expect(body.commands.commands[0]?.ExerciseCommand.choiceArgument).toEqual({
    meta: { values: {} },
  });
});

test.each([
  ['missing command ID', undefined, { meta: operationMeta }],
  ['missing operation metadata object', commandId, {}],
  ['null operation metadata', commandId, { meta: null }],
  ['numeric metadata map', commandId, { meta: { data: 42 } }],
  ['nonstring metadata value', commandId, { meta: { data: { reason: 42 } } }],
])(
  'Returns 400 for a rejection with %s before reading PQS',
  async (_case, queryCommandId, body) => {
    const { app, login, query, submissions } = setup([
      requestRow(contractId, providerParty, 'customer-party'),
    ]);
    const cookie = await login('app-provider');
    const search =
      queryCommandId === undefined ? '' : `?commandId=${encodeURIComponent(queryCommandId)}`;
    const response = await app.handle(
      new Request(`http://localhost/app-install-requests/${contractId}:reject${search}`, {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );

    expect(response.status).toBe(400);
    expect(response.headers.get('content-type')).toContain('application/problem+json');
    expect(query).not.toHaveBeenCalled();
    expect(submissions).toEqual([]);
  },
);

test('Does not query PQS for a customer rejection and returns not found for absent or foreign requests', async () => {
  const unauthorized = setup([requestRow(contractId, providerParty, 'customer-party')]);
  const provider = await unauthorized.login('app-provider');
  await unauthorized.registerCustomer(provider, 'customer-party');
  const customer = await unauthorized.login('customer');
  expect((await reject(unauthorized.app, customer)).status).toBe(403);
  expect(unauthorized.query).not.toHaveBeenCalled();
  expect(unauthorized.submissions).toEqual([]);

  const missing = setup([]);
  expect((await reject(missing.app, await missing.login('app-provider'))).status).toBe(404);
  expect(missing.submissions).toEqual([]);

  const foreign = setup([requestRow(contractId, 'other-provider', 'customer-party')]);
  expect((await reject(foreign.app, await foreign.login('app-provider'))).status).toBe(404);
  expect(foreign.submissions).toEqual([]);
});

test('Returns a sanitized ledger error when rejection fails', async () => {
  const { app, login, submissions } = setup(
    [requestRow(contractId, providerParty, 'customer-party')],
    new Error('private ledger response details'),
  );
  const response = await reject(app, await login('app-provider'));
  expect(response.status).toBe(500);
  expect(await response.text()).not.toContain('private ledger response details');
  expect(submissions).toHaveLength(1);
});

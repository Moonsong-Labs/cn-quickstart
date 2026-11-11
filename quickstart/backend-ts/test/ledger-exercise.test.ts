import { afterEach, expect, spyOn, test } from 'bun:test';
import type { LedgerCommonSchemas } from '@canton-network/core-ledger-client-types';
import { ContractId } from '@daml/types';
import { LEDGER_REQUEST_TIMEOUT_MS } from '../src/config/ledger';
import { AppInstall, AppInstallRequest } from '../src/daml/licensing';
import { createLedgerClient } from '../src/integrations/ledger/client';
import { LedgerApiError } from '../src/integrations/ledger/error';
import { exerciseChoice } from '../src/integrations/ledger/exercise';
import { createStaticTokenProvider } from '../src/integrations/ledger/token-provider';

// Real SDK and generated bindings, with simulated participant HTTP responses.
const servers: ReturnType<typeof Bun.serve>[] = [];
const accept = AppInstallRequest.AppInstallRequest_Accept;
/** Default generated accept-choice input exercised by the tests. */
const options = {
  contractId: ContractId(AppInstallRequest).decoder.runWithException('request-contract'),
  choice: accept,
  argument: { installMeta: { values: { description: 'Install' } }, meta: { values: {} } },
  commandId: 'accept-command',
  actAs: ['provider::test'],
};

/** Builds the expected ExercisedEvent with optional overrides for response edge cases. */
function exercised(overrides: Partial<LedgerCommonSchemas['ExercisedEvent']> = {}) {
  return {
    ExercisedEvent: {
      offset: 42,
      nodeId: 0,
      contractId: options.contractId,
      templateId: 'package-hash:Licensing.AppInstall:AppInstallRequest',
      choice: accept.choiceName,
      choiceArgument: options.argument,
      actingParties: options.actAs,
      consuming: true,
      witnessParties: options.actAs,
      lastDescendantNodeId: 1,
      exerciseResult: 'installation-contract',
      packageName: 'quickstart-licensing',
      acsDelta: true,
      ...overrides,
    },
  };
}

/**
 * Starts a participant stub with configurable events, status, or body and returns recorded requests.
 */
async function setup(
  events: readonly LedgerCommonSchemas['Event'][] = [exercised()],
  status = 200,
  respond?: () => Response | Promise<Response>,
) {
  const state = { requests: [] as { path: string; authorization: string | null; body: unknown }[] };
  const failure = { code: 'PERMISSION_DENIED', cause: 'Simulated missing ActAs permission' };
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      const path = new URL(request.url).pathname;
      if (path === '/v2/version') return Response.json({ version: '3.5.2' });
      state.requests.push({
        path,
        authorization: request.headers.get('authorization'),
        body: await request.json(),
      });
      if (request.method !== 'POST' || path !== '/v2/commands/submit-and-wait-for-transaction')
        return new Response(null, { status: 404 });
      if (status !== 200) return Response.json(failure, { status });
      if (respond) return respond();
      return Response.json({
        transaction: {
          updateId: 'accept-update',
          offset: 42,
          events,
          effectiveAt: '2026-10-26T12:00:00Z',
          recordTime: '2026-10-26T12:00:00Z',
          synchronizerId: 'synchronizer::test',
        },
      });
    },
  });
  servers.push(server);
  const client = await createLedgerClient({
    baseUrl: server.url,
    accessTokenProvider: createStaticTokenProvider({
      token: 'provider-token',
      ledgerUserId: 'provider-service',
    }),
  });
  return { connection: { client, ledgerUserId: 'provider-service' }, state, failure };
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.stop(true)));
});

test('Encodes the generated choice, authenticates and returns its decoded contract ID', async () => {
  const { connection, state } = await setup();
  const result = await exerciseChoice(connection, options);
  expect(result.toString()).toBe('installation-contract');
  expect(state.requests).toEqual([
    {
      path: '/v2/commands/submit-and-wait-for-transaction',
      authorization: 'Bearer provider-token',
      body: {
        commands: {
          userId: 'provider-service',
          commandId: options.commandId,
          actAs: options.actAs,
          readAs: [],
          commands: [
            {
              ExerciseCommand: {
                templateId: AppInstallRequest.templateId,
                contractId: options.contractId,
                choice: accept.choiceName,
                choiceArgument: options.argument,
              },
            },
          ],
        },
        transactionFormat: {
          transactionShape: 'TRANSACTION_SHAPE_LEDGER_EFFECTS',
          eventFormat: { filtersByParty: { 'provider::test': {} }, verbose: false },
        },
      },
    },
  ]);
});

test('Forwards disclosed contracts and readAs parties using the SDK request schema', async () => {
  const { connection, state } = await setup();
  const disclosedContracts = [
    {
      templateId: AppInstall.templateId,
      contractId: 'disclosed-contract',
      createdEventBlob: 'blob',
    },
  ];
  await exerciseChoice(connection, { ...options, readAs: ['reader::test'], disclosedContracts });
  expect(state.requests[0].body).toMatchObject({
    commands: { readAs: ['reader::test'], disclosedContracts },
    transactionFormat: {
      eventFormat: { filtersByParty: { 'provider::test': {}, 'reader::test': {} } },
    },
  });
});

test('Selects the requested root exercise despite unrelated events and recursive descendants', async () => {
  const { connection } = await setup([
    exercised({ nodeId: 2, exerciseResult: 'nested-result' }),
    exercised({ nodeId: 3, contractId: 'other-contract', exerciseResult: 'unrelated-contract' }),
    exercised({ nodeId: 4, choice: 'OtherChoice', exerciseResult: 'unrelated-choice' }),
    {
      CreatedEvent: {
        offset: 42,
        nodeId: 1,
        contractId: 'installation-contract',
        templateId: 'package-hash:Licensing.AppInstall:AppInstall',
        createArgument: {},
        witnessParties: options.actAs,
        signatories: options.actAs,
        createdAt: '2026-10-26T12:00:00Z',
        packageName: 'quickstart-licensing',
        representativePackageId: 'package-hash',
        acsDelta: true,
      },
    },
    exercised({ lastDescendantNodeId: 4 }),
  ]);
  expect((await exerciseChoice(connection, options)).toString()).toBe('installation-contract');
});

test('Decodes the unit result of a rejection choice', async () => {
  const { connection } = await setup([
    exercised({
      choice: AppInstallRequest.AppInstallRequest_Reject.choiceName,
      exerciseResult: {},
    }),
  ]);
  expect(
    await exerciseChoice(connection, {
      ...options,
      choice: AppInstallRequest.AppInstallRequest_Reject,
      argument: { meta: { values: {} } },
    }),
  ).toEqual({});
});

test('Decodes a structured result using a different generated choice', async () => {
  const result = { installId: 'new-installation', licenseId: 'new-license' };
  const { connection } = await setup([
    exercised({
      contractId: 'installation-contract',
      choice: AppInstall.AppInstall_CreateLicense.choiceName,
      exerciseResult: result,
    }),
  ]);
  const decoded = await exerciseChoice(connection, {
    ...options,
    contractId: ContractId(AppInstall).decoder.runWithException('installation-contract'),
    choice: AppInstall.AppInstall_CreateLicense,
    argument: { params: { meta: { values: {} } } },
  });
  expect(decoded.installId.toString()).toBe(result.installId);
  expect(decoded.licenseId.toString()).toBe(result.licenseId);
});

test.each([
  { name: 'empty transaction', events: [] },
  { name: 'different contract', events: [exercised({ contractId: 'other-contract' })] },
  { name: 'different choice', events: [exercised({ choice: 'OtherChoice' })] },
])('Rejects a transaction that omits the requested exercise ($name)', async ({ events }) => {
  const { connection } = await setup(events);
  await expect(exerciseChoice(connection, options)).rejects.toMatchObject({
    message: 'Failed to decode Ledger API transaction',
    commandId: options.commandId,
    updateId: 'accept-update',
    cause: expect.objectContaining({
      message: 'Ledger transaction did not include the requested exercise',
    }),
  });
});

test.each([undefined, null, 123, { unexpected: 'result' }])(
  'Rejects an invalid choice result (%j)',
  async (exerciseResult) => {
    const { connection } = await setup([exercised({ exerciseResult })]);
    await expect(exerciseChoice(connection, options)).rejects.toMatchObject({
      commandId: options.commandId,
      updateId: 'accept-update',
      cause: expect.anything(),
    });
  },
);

test('Preserves ledger rejection without retrying the exercise', async () => {
  const { connection, state, failure } = await setup([], 403);
  const error: unknown = await exerciseChoice(connection, options).catch((cause: unknown) => cause);
  expect(error).toBeInstanceOf(LedgerApiError);
  expect(error).toMatchObject({
    cause: failure,
    commandId: options.commandId,
    updateId: undefined,
  });
  expect(state.requests).toHaveLength(1);
});

test('Rejects invalid identifiers, parties and arguments before submitting', async () => {
  const { connection, state } = await setup();
  for (const invalid of [
    { ...options, commandId: ' ' },
    { ...options, contractId: ContractId(AppInstallRequest).decoder.runWithException(' ') },
    { ...options, actAs: [] },
    { ...options, actAs: [' '] },
    { ...options, readAs: [' '] },
    { ...options, argument: { ...options.argument, meta: undefined } },
  ]) {
    await expect(exerciseChoice(connection, invalid as typeof options)).rejects.toThrow();
  }
  expect(state.requests).toHaveLength(0);
});

test('Preserves command context when a successful HTTP response contains null', async () => {
  const { connection, state } = await setup([], 200, () => Response.json(null));
  const error: unknown = await exerciseChoice(connection, options).catch((cause: unknown) => cause);
  expect(error).toBeInstanceOf(LedgerApiError);
  expect(error).toMatchObject({
    commandId: options.commandId,
    updateId: undefined,
    cause: expect.any(TypeError),
  });
  expect(state.requests).toHaveLength(1);
});

test('Cancels a choice request on HTTP timeout without resubmitting', async () => {
  /** Bounds the real HTTP request quickly while checking the configured production deadline. */
  const testTimeoutMs = 50;
  /** Releases the simulated response after the timeout assertion, including on test failure. */
  const release = Promise.withResolvers<void>();
  const { connection, state } = await setup([], 200, async () => {
    await release.promise;
    return Response.json({});
  });
  /** Preserves native cancellation while shortening only the timeout created by the command. */
  const nativeTimeout = AbortSignal.timeout.bind(AbortSignal);
  /** Checks the production deadline while substituting a short native timeout for this test. */
  const timeout = spyOn(AbortSignal, 'timeout').mockImplementation(() =>
    nativeTimeout(testTimeoutMs),
  );

  try {
    await expect(exerciseChoice(connection, options)).rejects.toMatchObject({
      name: 'LedgerApiError',
      commandId: options.commandId,
      updateId: undefined,
      cause: expect.objectContaining({ name: 'TimeoutError' }),
    });
    expect(timeout).toHaveBeenCalledTimes(1);
    expect(timeout).toHaveBeenCalledWith(LEDGER_REQUEST_TIMEOUT_MS);
    expect(state.requests).toHaveLength(1);
  } finally {
    timeout.mockRestore();
    release.resolve();
  }
});

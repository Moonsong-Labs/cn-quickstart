import { beforeAll, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { awaitCompletion } from '@canton-network/core-ledger-client';
import { readApplicationConfig } from '../src/config/application';
import { AppInstallRequest } from '../src/daml/licensing';
import { createLedgerClient } from '../src/integrations/ledger/client';
import { connectLedger } from '../src/integrations/ledger/connect';
import { createStaticTokenProvider } from '../src/integrations/ledger/token-provider';

const TEST_TIMEOUT_MS = 30_000;
// The SDK waits up to one second per idle completion poll; bound the number of polls.
const MAX_COMPLETION_POLLS = 10;
let user: Awaited<ReturnType<typeof connectLedger>>;
let provider: Awaited<ReturnType<typeof connectLedger>>;
let userParty: string;
let providerParty: string;

beforeAll(async () => {
  const {
    APP_USER_LEDGER_API_URL: url,
    APP_USER_LEDGER_USER_ID: ledgerUserId,
    APP_USER_TOKEN: token,
    APP_USER_PARTY: party,
  } = process.env;
  if (!url || !ledgerUserId || !token || !party)
    throw new Error('Missing integration App User identity');
  userParty = party;
  providerParty = readApplicationConfig().appProvider.partyId;
  provider = await connectLedger();
  user = {
    ledgerUserId,
    client: await createLedgerClient({
      baseUrl: new URL(url),
      accessTokenProvider: createStaticTokenProvider({ ledgerUserId, token }),
    }),
  };
}, TEST_TIMEOUT_MS);

/** Encodes an AppInstallRequest as its typed ledger CreateCommand. */
function createCommand(request: AppInstallRequest) {
  return {
    CreateCommand: {
      templateId: AppInstallRequest.templateId,
      createArguments: AppInstallRequest.encode(request),
    },
  };
}

// These tests exercise the real SDK and participants on the runner's disposable LocalNet.
test(
  'Accepts a submission, then confirms it separately and reads the committed contract',
  async () => {
    const request = {
      provider: providerParty,
      user: userParty,
      meta: { values: { integrationTest: randomUUID() } },
    } satisfies AppInstallRequest;
    const commandId = randomUUID();
    const submissionId = randomUUID();
    // Taking this offset after submission could skip a completion that arrived immediately.
    const { offset = 0 } = await user.client.get('/v2/state/ledger-end');
    const acceptance = await user.client.post('/v2/commands/async/submit', {
      userId: user.ledgerUserId,
      commandId,
      submissionId,
      actAs: [userParty],
      readAs: [userParty],
      commands: [createCommand(request)],
    });
    expect(acceptance).toEqual({});

    const completion = await awaitCompletion(
      user.client,
      offset,
      userParty,
      user.ledgerUserId,
      submissionId,
      MAX_COMPLETION_POLLS,
    );
    expect(completion.commandId).toBe(commandId);
    expect(completion.submissionId).toBe(submissionId);
    expect(completion.updateId).toBeTruthy();
    expect(completion.offset).toBeGreaterThan(offset);

    const contracts = await user.client.post('/v2/state/active-contracts', {
      activeAtOffset: completion.offset,
      eventFormat: { filtersByParty: { [userParty]: {} }, verbose: false },
    });
    const matching = contracts.flatMap(({ contractEntry }) => {
      if (!contractEntry || !('JsActiveContract' in contractEntry)) return [];
      const event = contractEntry.JsActiveContract.createdEvent;
      if (
        `#${event.packageName}:${event.templateId.split(':').slice(1).join(':')}` !==
        AppInstallRequest.templateId
      )
        return [];
      const decoded = AppInstallRequest.decoder.runWithException(event.createArgument);
      return decoded.meta.values.integrationTest === request.meta.values.integrationTest
        ? [decoded]
        : [];
    });
    expect(matching).toEqual([request]);
  },
  TEST_TIMEOUT_MS,
);

test(
  'Reports Daml authorization failures rejected during submission',
  async () => {
    const commandId = randomUUID();
    // Interpretation happens before the acknowledgement, including Daml authorization checks.
    // The service can ActAs the provider, but this create requires the App User's signature.
    await expect(
      provider.client.post('/v2/commands/async/submit', {
        userId: provider.ledgerUserId,
        commandId,
        submissionId: randomUUID(),
        actAs: [providerParty],
        commands: [
          createCommand({ provider: providerParty, user: userParty, meta: { values: {} } }),
        ],
      }),
    ).rejects.toMatchObject({
      code: 'DAML_AUTHORIZATION_ERROR',
    });
  },
  TEST_TIMEOUT_MS,
);

import { beforeAll, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { ContractId } from '@daml/types';
import { readApplicationConfig } from '../src/config/application';
import { AppInstall, AppInstallRequest, License } from '../src/daml/licensing';
import { createLedgerClient } from '../src/integrations/ledger/client';
import { connectLedger } from '../src/integrations/ledger/connect';
import { exerciseChoice } from '../src/integrations/ledger/exercise';
import { createStaticTokenProvider } from '../src/integrations/ledger/token-provider';
import { createAppInstallRequest } from '../src/modules/app-installations';

const TEST_TIMEOUT_MS = 30_000;
// Participant ingestion can lag behind confirmation on the submitting participant.
const VISIBILITY_TIMEOUT_MS = 10_000;
const VISIBILITY_POLL_INTERVAL_MS = 100;
const GRPC_PERMISSION_DENIED = 7;
const GRPC_NOT_FOUND = 5;
let provider: Awaited<ReturnType<typeof connectLedger>>;
let user: typeof provider;
let providerParty: string;
let userParty: string;

// Every command and query uses real OAuth identities, participants and generated bindings.
beforeAll(async () => {
  providerParty = readApplicationConfig().appProviderParty;
  provider = await connectLedger();
  const {
    APP_USER_LEDGER_API_URL: url,
    APP_USER_PARTY: party,
    APP_USER_TOKEN: token,
    APP_USER_LEDGER_USER_ID: ledgerUserId,
  } = process.env;
  if (!url || !party || !token || !ledgerUserId)
    throw new Error('Missing integration App User identity');
  userParty = party;
  const client = await createLedgerClient({
    baseUrl: new URL(url),
    accessTokenProvider: createStaticTokenProvider({ token, ledgerUserId }),
  });
  user = { client, ledgerUserId };
}, TEST_TIMEOUT_MS);

/**
 * Returns active created events for a template visible to a party at the supplied
 * offset, defaulting to the current ledger end.
 */
async function snapshot(
  connection: typeof provider,
  party: string,
  templateId: string,
  atOffset?: number,
) {
  const offset = atOffset ?? (await connection.client.get('/v2/state/ledger-end')).offset;
  if (offset === undefined) throw new Error('Ledger API did not return a ledger-end offset');
  const contracts = await connection.client.post('/v2/state/active-contracts', {
    activeAtOffset: offset,
    eventFormat: {
      filtersByParty: {
        [party]: {
          cumulative: [{ identifierFilter: { TemplateFilter: { value: { templateId } } } }],
        },
      },
      verbose: false,
    },
  });
  return contracts.flatMap(({ contractEntry }) =>
    contractEntry && 'JsActiveContract' in contractEntry
      ? [contractEntry.JsActiveContract.createdEvent]
      : [],
  );
}

/** Submits an installation request as the App User and waits until the App Provider can see it. */
async function createRequest() {
  const tag = randomUUID();
  const confirmation = await createAppInstallRequest(
    user,
    {
      provider: providerParty,
      user: userParty,
      meta: { values: { integrationTest: tag } },
    },
    randomUUID(),
  );
  const contracts = await snapshot(
    user,
    userParty,
    AppInstallRequest.templateId,
    confirmation.completionOffset,
  );
  const matching = contracts.filter(
    (event) =>
      AppInstallRequest.decoder.runWithException(event.createArgument).meta.values
        .integrationTest === tag,
  );
  expect(matching).toHaveLength(1);
  const contractId = ContractId(AppInstallRequest).decoder.runWithException(matching[0].contractId);

  const deadline = Date.now() + VISIBILITY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const visible = await snapshot(provider, providerParty, AppInstallRequest.templateId);
    if (visible.some((event) => event.contractId === contractId)) return contractId;
    await Bun.sleep(VISIBILITY_POLL_INTERVAL_MS);
  }
  throw new Error('Installation request did not become visible to the App Provider');
}

test(
  'Accepts a request and creates a license with typed contract and structured results',
  async () => {
    const requestId = await createRequest();
    const installMeta = { values: { integrationTest: randomUUID() } };
    const installId = await exerciseChoice(provider, {
      contractId: requestId,
      choice: AppInstallRequest.AppInstallRequest_Accept,
      argument: { installMeta, meta: { values: {} } },
      commandId: randomUUID(),
      actAs: [providerParty],
    });
    expect(installId.toString()).not.toBe('');
    const installations = await snapshot(provider, providerParty, AppInstall.templateId);
    const installed = installations.find((event) => event.contractId === installId);
    expect(installed).toBeDefined();
    expect(AppInstall.decoder.runWithException(installed?.createArgument)).toEqual({
      provider: providerParty,
      user: userParty,
      meta: installMeta,
      numLicensesCreated: '0',
    });
    expect(installed?.signatories.slice().sort()).toEqual([providerParty, userParty].sort());
    const requests = await snapshot(provider, providerParty, AppInstallRequest.templateId);
    expect(requests.some((event) => event.contractId === requestId)).toBe(false);

    const params = { meta: { values: { description: 'Integration license' } } };
    const created = await exerciseChoice(provider, {
      contractId: installId,
      choice: AppInstall.AppInstall_CreateLicense,
      argument: { params },
      commandId: randomUUID(),
      actAs: [providerParty],
    });
    expect(created.installId).not.toBe(installId);
    expect(created.licenseId.toString()).not.toBe('');
    const updated = await snapshot(provider, providerParty, AppInstall.templateId);
    expect(updated.some((event) => event.contractId === installId)).toBe(false);
    const replacement = updated.find((event) => event.contractId === created.installId);
    expect(AppInstall.decoder.runWithException(replacement?.createArgument)).toEqual({
      provider: providerParty,
      user: userParty,
      meta: installMeta,
      numLicensesCreated: '1',
    });
    const licenses = await snapshot(provider, providerParty, License.templateId);
    const license = licenses.find((event) => event.contractId === created.licenseId);
    const payload = License.decoder.runWithException(license?.createArgument);
    expect(payload.provider).toBe(providerParty);
    expect(payload.user).toBe(userParty);
    expect(payload.params).toEqual(params);
    expect(payload.licenseNum).toBe('1');
    expect(license?.signatories.slice().sort()).toEqual([providerParty, userParty].sort());
  },
  TEST_TIMEOUT_MS,
);

test(
  'Rejects an installation request and decodes the unit result',
  async () => {
    const contractId = await createRequest();
    const result = await exerciseChoice(provider, {
      contractId,
      choice: AppInstallRequest.AppInstallRequest_Reject,
      argument: { meta: { values: {} } },
      commandId: randomUUID(),
      actAs: [providerParty],
    });
    expect(result).toEqual({});
    const remaining = await snapshot(provider, providerParty, AppInstallRequest.templateId);
    expect(remaining.some((event) => event.contractId === contractId)).toBe(false);
  },
  TEST_TIMEOUT_MS,
);

test(
  'Rejects a submission when the token cannot ActAs the App Provider',
  async () => {
    const contractId = await createRequest();
    const commandId = randomUUID();
    await expect(
      exerciseChoice(user, {
        contractId,
        choice: AppInstallRequest.AppInstallRequest_Accept,
        argument: { installMeta: { values: {} }, meta: { values: {} } },
        commandId,
        actAs: [providerParty],
      }),
    ).rejects.toMatchObject({
      name: 'LedgerApiError',
      commandId,
      updateId: undefined,
      cause: { grpcCodeValue: GRPC_PERMISSION_DENIED },
    });
    const remaining = await snapshot(provider, providerParty, AppInstallRequest.templateId);
    expect(remaining.some((event) => event.contractId === contractId)).toBe(true);
  },
  TEST_TIMEOUT_MS,
);

test(
  'Rejects exercising a request that has already been archived',
  async () => {
    const contractId = await createRequest();
    await exerciseChoice(provider, {
      contractId,
      choice: AppInstallRequest.AppInstallRequest_Reject,
      argument: { meta: { values: {} } },
      commandId: randomUUID(),
      actAs: [providerParty],
    });
    const commandId = randomUUID();
    await expect(
      exerciseChoice(provider, {
        contractId,
        choice: AppInstallRequest.AppInstallRequest_Accept,
        argument: { installMeta: { values: {} }, meta: { values: {} } },
        commandId,
        actAs: [providerParty],
      }),
    ).rejects.toMatchObject({
      name: 'LedgerApiError',
      commandId,
      updateId: undefined,
      cause: { grpcCodeValue: GRPC_NOT_FOUND },
    });
  },
  TEST_TIMEOUT_MS,
);

test(
  'Rejects an App User exercising a choice controlled by the App Provider',
  async () => {
    const contractId = await createRequest();
    const commandId = randomUUID();
    await expect(
      exerciseChoice(user, {
        contractId,
        choice: AppInstallRequest.AppInstallRequest_Accept,
        argument: { installMeta: { values: {} }, meta: { values: {} } },
        commandId,
        actAs: [userParty],
      }),
    ).rejects.toMatchObject({
      name: 'LedgerApiError',
      commandId,
      updateId: undefined,
      cause: { code: 'DAML_AUTHORIZATION_ERROR' },
    });
    const remaining = await snapshot(provider, providerParty, AppInstallRequest.templateId);
    expect(remaining.some((event) => event.contractId === contractId)).toBe(true);
  },
  TEST_TIMEOUT_MS,
);

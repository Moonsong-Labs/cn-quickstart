import { beforeAll, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import type { LedgerCommonSchemas } from '@canton-network/core-ledger-client-types';
import { ContractId } from '@daml/types';
import { Pool } from 'pg';
import {
  AllocationRequest,
  type AllocationRequestView,
} from '../build/generated-daml-bindings/splice-api-token-allocation-request-v1-1.0.0/lib/Splice/Api/Token/AllocationRequestV1/module';
import { Allocation } from '../build/generated-daml-bindings/splice-api-token-allocation-v1-1.0.0/lib/Splice/Api/Token/AllocationV1/module';
import {
  AnyContract,
  ChoiceContext,
} from '../build/generated-daml-bindings/splice-api-token-metadata-v1-1.0.0/lib/Splice/Api/Token/MetadataV1/module';
import { readApplicationConfig } from '../src/config/application';
import { readPostgresConfig } from '../src/config/postgres';
import {
  AppInstall,
  AppInstallRequest,
  License,
  LicenseRenewalRequest,
} from '../src/daml/licensing';
import { createLedgerClient } from '../src/integrations/ledger/client';
import { connectLedger } from '../src/integrations/ledger/connect';
import { exerciseChoice } from '../src/integrations/ledger/exercise';
import { createStaticTokenProvider } from '../src/integrations/ledger/token-provider';
import { findActiveById, listActive, listActiveByKey } from '../src/integrations/pqs/contracts';
import { createAppInstallRequest } from '../src/modules/app-installations';
import { findActiveLicenses } from '../src/modules/licenses';

const TEST_TIMEOUT_MS = 30_000;
// Participant ingestion can lag behind confirmation on the submitting participant.
const VISIBILITY_TIMEOUT_MS = 10_000;
const VISIBILITY_POLL_INTERVAL_MS = 100;
const PQS_VISIBILITY_TIMEOUT_MS = 30_000;
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

async function waitForPqs(pool: Pool, contractIds: string[]) {
  const deadline = Date.now() + PQS_VISIBILITY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const { rows } = await pool.query<{ watermark_table: string | null }>(
      "SELECT to_regclass('__watermark')::text AS watermark_table",
    );
    if (rows[0]?.watermark_table) {
      // Scribe recreates active() during migrations. A non-null ingestion checkpoint
      // in its stable watermark table means the fresh test database is initialized.
      const checkpoint = await pool.query<{ ready: boolean }>(`
        SELECT EXISTS (
          SELECT 1 FROM __watermark WHERE "offset" IS NOT NULL AND ix IS NOT NULL
        ) AS ready
      `);
      if (checkpoint.rows[0]?.ready) {
        // Unfiltered PQS results include interface views with the same contract ID.
        const contracts = await pool.query(
          'SELECT DISTINCT contract_id FROM active() WHERE contract_id = ANY($1::text[])',
          [contractIds],
        );
        if (contracts.rows.length === contractIds.length) return;
      }
    }
    await Bun.sleep(VISIBILITY_POLL_INTERVAL_MS);
  }
  throw new Error('Contracts did not become active in PQS');
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

test('Creates a keyed license and permits renewal requests sharing the same key', async () => {
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
  expect(License.keyDecoder.runWithException(license?.contractKey)).toEqual({
    provider: providerParty,
    user: userParty,
    licenseNum: '1',
  });

  const pqs = new Pool(readPostgresConfig());
  try {
    await waitForPqs(pqs, [created.licenseId]);
    const licenseKey = { provider: providerParty, user: userParty, licenseNum: '1' };
    let activeLicenses = await listActiveByKey(pqs, License, licenseKey);
    const pqsLicense = activeLicenses.find(({ contractId }) => contractId === created.licenseId);
    expect(pqsLicense?.payload).toEqual(payload);

    const renewalArgument = {
      requestId: randomUUID(),
      licenseFeeInstrumentId: { admin: providerParty, id: 'test-instrument' },
      licenseFeeAmount: '1.0000000000',
      licenseExtensionDuration: { microseconds: '86400000000' },
      requestedAt: payload.expiresAt,
      prepareUntil: new Date(Date.now() + 3_600_000).toISOString(),
      settleBefore: new Date(Date.now() + 7_200_000).toISOString(),
      description: 'Contract key integration',
    };
    const renewalIds: ContractId<LicenseRenewalRequest>[] = [];
    for (let i = 0; i < 2; i++) {
      renewalIds.push(
        await exerciseChoice(provider, {
          contractId: created.licenseId,
          choice: License.License_Renew,
          argument: renewalArgument,
          commandId: randomUUID(),
          actAs: [providerParty],
        }),
      );
    }
    const renewals = await snapshot(provider, providerParty, LicenseRenewalRequest.templateId);
    const matchingRenewals = renewals.filter((event) =>
      renewalIds.includes(
        ContractId(LicenseRenewalRequest).decoder.runWithException(event.contractId),
      ),
    );
    expect(matchingRenewals).toHaveLength(2);
    for (const event of matchingRenewals) {
      expect(LicenseRenewalRequest.keyDecoder.runWithException(event.contractKey)).toEqual({
        provider: providerParty,
        user: userParty,
        requestId: renewalArgument.requestId,
      });
    }

    const renewalKey = {
      provider: providerParty,
      user: userParty,
      requestId: renewalArgument.requestId,
    };
    await waitForPqs(pqs, renewalIds);
    const activeRenewals = await listActiveByKey(pqs, LicenseRenewalRequest, renewalKey);
    expect(activeRenewals.map(({ contractId }) => contractId.toString()).sort()).toEqual(
      renewalIds.map(String).sort(),
    );

    const joinedLicenses = await findActiveLicenses(pqs, providerParty);
    const joinedLicense = joinedLicenses.find(
      ({ license }) => license.contractId === created.licenseId,
    );
    expect(joinedLicense?.license.payload).toEqual(payload);
    expect(joinedLicense?.renewals.map(({ renewal }) => String(renewal.contractId)).sort()).toEqual(
      renewalIds.map(String).sort(),
    );
    expect(joinedLicense?.renewals.every(({ allocationCid }) => allocationCid === undefined)).toBe(
      true,
    );

    const interfaceContract = await findActiveById(pqs, AllocationRequest, renewalIds[0]);
    const meta = {
      values: {
        'splice.lfdecentralizedtrust.org/reason': renewalArgument.description,
        'cn-quickstart.example.org/licenseNum': '1',
      },
    };
    expect(interfaceContract?.contractId.toString()).toBe(renewalIds[0].toString());
    expect<AllocationRequestView | undefined>(interfaceContract?.payload).toEqual({
      settlement: {
        executor: providerParty,
        requestedAt: activeRenewals[0].payload.requestedAt,
        allocateBefore: activeRenewals[0].payload.prepareUntil,
        settleBefore: activeRenewals[0].payload.settleBefore,
        settlementRef: { id: renewalArgument.requestId, cid: null },
        meta,
      },
      transferLegs: {
        licenseFeePayment: {
          sender: userParty,
          receiver: providerParty,
          amount: activeRenewals[0].payload.licenseFeeAmount,
          instrumentId: renewalArgument.licenseFeeInstrumentId,
          meta,
        },
      },
      meta,
    });
    const interfaceContracts = await listActive(pqs, AllocationRequest);
    expect(
      interfaceContracts
        .filter(({ contractId }) => renewalIds.some((id) => id === contractId.toString()))
        .map(({ contractId }) => contractId.toString())
        .sort(),
    ).toEqual(renewalIds.map(String).sort());
    expect(await findActiveById(pqs, AllocationRequest, created.licenseId)).toBeUndefined();

    await exerciseChoice(provider, {
      contractId: LicenseRenewalRequest.toInterface(AllocationRequest, renewalIds[0]),
      choice: AllocationRequest.AllocationRequest_Withdraw,
      argument: { extraArgs: { context: { values: {} }, meta: { values: {} } } },
      commandId: randomUUID(),
      actAs: [providerParty],
    });
    const withdrawalDeadline = Date.now() + PQS_VISIBILITY_TIMEOUT_MS;
    let withdrawn = await findActiveById(pqs, AllocationRequest, renewalIds[0]);
    while (withdrawn !== undefined && Date.now() < withdrawalDeadline) {
      await Bun.sleep(VISIBILITY_POLL_INTERVAL_MS);
      withdrawn = await findActiveById(pqs, AllocationRequest, renewalIds[0]);
    }
    expect(withdrawn).toBeUndefined();
    expect(await findActiveById(pqs, LicenseRenewalRequest, renewalIds[0])).toBeUndefined();
    expect(
      (await listActive(pqs, AllocationRequest)).map(({ contractId }) => String(contractId)),
    ).not.toContain(renewalIds[0]);
    expect(
      (await findActiveById(pqs, AllocationRequest, renewalIds[1]))?.contractId.toString(),
    ).toBe(renewalIds[1].toString());

    const afterWithdrawal = (await findActiveLicenses(pqs, providerParty)).find(
      ({ license }) => license.contractId === created.licenseId,
    );
    expect(afterWithdrawal?.renewals.map(({ renewal }) => String(renewal.contractId))).toEqual([
      String(renewalIds[1]),
    ]);

    await exerciseChoice(provider, {
      contractId: created.licenseId,
      choice: License.License_Expire,
      argument: { actor: providerParty, meta: { values: {} } },
      commandId: randomUUID(),
      actAs: [providerParty],
    });
    const archiveDeadline = Date.now() + PQS_VISIBILITY_TIMEOUT_MS;
    activeLicenses = await listActiveByKey(pqs, License, licenseKey);
    while (
      activeLicenses.some(({ contractId }) => contractId === created.licenseId) &&
      Date.now() < archiveDeadline
    ) {
      await Bun.sleep(VISIBILITY_POLL_INTERVAL_MS);
      activeLicenses = await listActiveByKey(pqs, License, licenseKey);
    }
    expect(activeLicenses.some(({ contractId }) => contractId === created.licenseId)).toBe(false);
    const remainingLicenses = await findActiveLicenses(pqs, providerParty);
    expect(remainingLicenses.some(({ license }) => license.contractId === created.licenseId)).toBe(
      false,
    );
  } finally {
    await pqs.end();
  }
}, 150_000);

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

async function tokenApi<T = unknown>(
  baseUrl: string,
  path: string,
  body?: object,
  token?: string,
): Promise<T> {
  const deadline = Date.now() + 60_000;
  let retryDelay = 500;
  while (true) {
    const response = await fetch(new URL(path, baseUrl), {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(Math.max(1, Math.min(30_000, deadline - Date.now()))),
    });
    // Wallets can be busy buying traffic or processing an allocation. Mutation bodies
    // carry stable tap command IDs or settlement references so retries are deduplicated.
    if (response.status === 429 && Date.now() + retryDelay < deadline) {
      await response.body?.cancel();
      await Bun.sleep(retryDelay);
      retryDelay = Math.min(retryDelay * 2, 5_000);
      continue;
    }
    if (!response.ok)
      throw new Error(`Token API ${path} failed (${response.status}): ${await response.text()}`);
    return response.json() as Promise<T>;
  }
}

test('Matches a real wallet allocation and observes completed renewal in PQS', async () => {
  const walletUrl = process.env.APP_USER_WALLET_API_URL;
  const registryUrl = process.env.TOKEN_REGISTRY_URL;
  const token = process.env.APP_USER_TOKEN;
  if (!walletUrl || !registryUrl || !token) throw new Error('Missing integration token services');

  const requestId = await createRequest();
  const installId = await exerciseChoice(provider, {
    contractId: requestId,
    choice: AppInstallRequest.AppInstallRequest_Accept,
    argument: { installMeta: { values: {} }, meta: { values: {} } },
    commandId: randomUUID(),
    actAs: [providerParty],
  });
  const { licenseId } = await exerciseChoice(provider, {
    contractId: installId,
    choice: AppInstall.AppInstall_CreateLicense,
    argument: { params: { meta: { values: { integrationTest: randomUUID() } } } },
    commandId: randomUUID(),
    actAs: [providerParty],
  });
  const pqs = new Pool(readPostgresConfig());
  try {
    await waitForPqs(pqs, [licenseId]);
    const original = await findActiveById(pqs, License, licenseId);
    expect(original).toBeDefined();
    if (!original) throw new Error('Created license missing from PQS');
    const { adminId } = await tokenApi<{ adminId: string }>(
      registryUrl,
      '/registry/metadata/v1/info',
    );
    const renewalArgument = {
      requestId: randomUUID(),
      licenseFeeInstrumentId: { admin: adminId, id: 'Amulet' },
      licenseFeeAmount: '1.0000000000',
      licenseExtensionDuration: { microseconds: '86400000000' },
      requestedAt: original.payload.expiresAt,
      prepareUntil: new Date(Date.now() + 3_600_000).toISOString(),
      settleBefore: new Date(Date.now() + 7_200_000).toISOString(),
      description: 'Real allocation integration',
    };
    const renewalId = await exerciseChoice(provider, {
      contractId: licenseId,
      choice: License.License_Renew,
      argument: renewalArgument,
      commandId: randomUUID(),
      actAs: [providerParty],
    });
    const siblingId = await exerciseChoice(provider, {
      contractId: licenseId,
      choice: License.License_Renew,
      argument: { ...renewalArgument, requestId: randomUUID() },
      commandId: randomUUID(),
      actAs: [providerParty],
    });
    await waitForPqs(pqs, [renewalId, siblingId]);
    const before = (await findActiveLicenses(pqs, providerParty)).find(
      ({ license }) => license.contractId === licenseId,
    );
    if (!before) throw new Error('License missing from joined PQS query');
    // License numbers are installation-local; preserve matching requests from other fixtures.
    const pending = before.renewals.map(({ renewal, allocationCid }) => [
      renewal.contractId,
      allocationCid,
    ]);
    expect(pending).toEqual(
      expect.arrayContaining([
        [renewalId, undefined],
        [siblingId, undefined],
      ]),
    );

    await tokenApi(
      walletUrl,
      '/api/validator/v0/wallet/tap',
      { amount: '1000', command_id: randomUUID() },
      token,
    );
    const request = await findActiveById(pqs, AllocationRequest, renewalId);
    if (!request) throw new Error('Renewal interface view missing from PQS');
    const { settlement, transferLegs } = request.payload;
    const leg = transferLegs.licenseFeePayment;
    // Wallet timestamps use epoch microseconds; Date.parse alone loses Daml's sub-ms digits.
    const epochMicros = (timestamp: string) =>
      Date.parse(timestamp) * 1000 +
      Number((timestamp.match(/\.(\d+)Z$/)?.[1] ?? '').padEnd(6, '0').slice(3, 6));
    const allocated = await tokenApi<{ output: { allocation_cid?: string } }>(
      walletUrl,
      '/api/validator/v0/allocations',
      {
        settlement: {
          executor: settlement.executor,
          settlement_ref: { id: settlement.settlementRef.id },
          requested_at: epochMicros(settlement.requestedAt),
          allocate_before: epochMicros(settlement.allocateBefore),
          settle_before: epochMicros(settlement.settleBefore),
          meta: settlement.meta.values,
        },
        transfer_leg_id: 'licenseFeePayment',
        transfer_leg: { receiver: leg.receiver, amount: leg.amount, meta: leg.meta.values },
      },
      token,
    );
    const returnedId = allocated.output.allocation_cid;
    if (!returnedId) throw new Error('Wallet did not return a completed allocation');
    const allocationId = ContractId(Allocation).decoder.runWithException(returnedId);
    await waitForPqs(pqs, [allocationId]);
    const allocation = await findActiveById(pqs, Allocation, allocationId);
    expect(allocation?.payload.allocation).toEqual({
      settlement,
      transferLegId: 'licenseFeePayment',
      transferLeg: leg,
    });
    for (const party of [providerParty, userParty]) {
      const joined = (await findActiveLicenses(pqs, party)).find(
        ({ license }) => license.contractId === licenseId,
      );
      expect(
        joined?.renewals.map(({ renewal, allocationCid }) => [renewal.contractId, allocationCid]),
      ).toEqual(pending.map(([id, cid]) => [id, id === renewalId ? allocationId : cid]));
    }

    const context = await tokenApi<{
      choiceContextData: unknown;
      disclosedContracts: LedgerCommonSchemas['DisclosedContract'][];
    }>(
      registryUrl,
      `/registry/allocations/v1/${encodeURIComponent(allocationId)}/choice-contexts/execute-transfer`,
      {},
    );
    const choiceContext = ChoiceContext.decoder.runWithException(context.choiceContextData);
    // Match Java's context enrichment for registries that provide these IDs through disclosures.
    for (const disclosure of context.disclosedContracts) {
      const key = { AmuletRules: 'amulet-rules', OpenMiningRound: 'open-round' }[
        disclosure.templateId?.split(':').at(-1) as 'AmuletRules' | 'OpenMiningRound'
      ];
      if (key)
        choiceContext.values[key] = {
          tag: 'AV_ContractId',
          value: ContractId(AnyContract).decoder.runWithException(disclosure.contractId),
        };
    }
    const replacementId = await exerciseChoice(provider, {
      contractId: renewalId,
      choice: LicenseRenewalRequest.LicenseRenewalRequest_CompleteRenewal,
      argument: {
        licenseCid: licenseId,
        allocationCid: allocationId,
        extraArgs: { context: choiceContext, meta: { values: {} } },
      },
      disclosedContracts: context.disclosedContracts,
      commandId: randomUUID(),
      actAs: [providerParty],
    });
    expect(replacementId).not.toBe(licenseId);
    await waitForPqs(pqs, [replacementId]);
    const replacement = await findActiveById(pqs, License, replacementId);
    expect(replacement?.payload).toEqual({ ...original.payload, expiresAt: expect.any(String) });
    expect(Date.parse(replacement?.payload.expiresAt ?? '')).toBeGreaterThanOrEqual(
      Date.parse(original.payload.expiresAt) + 86_400_000,
    );
    expect(await findActiveById(pqs, License, licenseId)).toBeUndefined();
    expect(await findActiveById(pqs, LicenseRenewalRequest, renewalId)).toBeUndefined();
    expect(await findActiveById(pqs, AllocationRequest, renewalId)).toBeUndefined();
    expect(await findActiveById(pqs, Allocation, allocationId)).toBeUndefined();
    const after = await findActiveLicenses(pqs, providerParty);
    expect(after.some(({ license }) => license.contractId === licenseId)).toBe(false);
    const renewed = after.find(({ license }) => license.contractId === replacementId);
    expect(
      renewed?.renewals.map(({ renewal, allocationCid }) => [renewal.contractId, allocationCid]),
    ).toEqual(pending.filter(([id]) => id !== renewalId));
  } finally {
    await pqs.end();
  }
}, 180_000);

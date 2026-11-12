import { afterAll, beforeAll, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import type { AllocationRequestView } from '../build/generated-daml-bindings/splice-api-token-allocation-request-v1-1.0.0/lib/Splice/Api/Token/AllocationRequestV1/module';
import { readPostgresConfig } from '../src/config/postgres';

import { License, LicenseRenewalRequest } from '../src/daml/licensing';
import { findActiveLicenses } from '../src/modules/licenses';

const schema = `pqs_licenses_${randomUUID().replaceAll('-', '')}`;
const config = readPostgresConfig();
const admin = new Pool(config);
const pool = new Pool({ ...config, options: `-c search_path=${schema},pg_catalog` });

const party = { provider: 'provider::test', user: 'user::test' };
const licensePayload = (provider: string, user: string, licenseNum: string) => ({
  provider,
  user,
  licenseNum,
  expiresAt: '2026-10-30T00:00:00Z',
  params: { meta: { values: {} } },
});
const renewalPayload = (
  requestId: string,
  provider: string,
  user: string,
  licenseNum: string,
  overrides: Record<string, unknown> = {},
) => ({
  requestId,
  provider,
  user,
  licenseNum,
  licenseFeeAmount: '12.3400000000',
  licenseFeeInstrumentId: { admin: provider, id: 'test-instrument' },
  licenseExtensionDuration: { microseconds: '86400000000' },
  prepareUntil: '2026-10-30T13:00:00Z',
  settleBefore: '2026-10-30T14:00:00Z',
  requestedAt: '2026-10-30T12:00:00Z',
  description: 'Renewal test',
  ...overrides,
});
const metadata = { values: { reason: 'Renewal test', license: '7' } };
const allocationRequestView = (
  requestId: string,
  provider: string,
  user: string,
  overrides: { settlement?: Record<string, unknown>; transferLeg?: Record<string, unknown> } = {},
): AllocationRequestView => ({
  settlement: {
    executor: provider,
    settlementRef: { id: requestId, cid: null },
    requestedAt: '2026-10-30T13:00:00+01:00',
    allocateBefore: '2026-10-30T14:00:00+01:00',
    settleBefore: '2026-10-30T15:00:00+01:00',
    meta: metadata,
    ...overrides.settlement,
  },
  transferLegs: {
    licenseFeePayment: {
      sender: user,
      receiver: provider,
      amount: '12.34',
      instrumentId: { admin: provider, id: 'test-instrument' },
      meta: metadata,
      ...overrides.transferLeg,
    },
  },
  meta: metadata,
});
const allocationPayload = (
  requestId: string,
  provider: string,
  user: string,
  view = allocationRequestView(requestId, provider, user),
  transferLegId = 'licenseFeePayment',
) => ({
  allocation: {
    settlement: view.settlement,
    transferLegId,
    transferLeg: view.transferLegs.licenseFeePayment,
  },
  holdingCids: [],
  meta: metadata,
});

type Seed = {
  template: string;
  id: string;
  payload: Record<string, unknown>;
  archived?: boolean;
};
const template = {
  license: License.templateId.slice(1),
  renewal: LicenseRenewalRequest.templateId.slice(1),
  allocationRequest:
    'splice-api-token-allocation-request-v1:Splice.Api.Token.AllocationRequestV1:AllocationRequest',
  allocation: 'splice-api-token-allocation-v1:Splice.Api.Token.AllocationV1:Allocation',
};

async function seed({ template: fqn, id, payload, archived = false }: Seed) {
  await pool.query(
    'INSERT INTO contracts (template_fqn, contract_id, payload, archived_at_ix) VALUES ($1, $2, $3, $4)',
    [fqn, id, payload, archived ? 1 : null],
  );
}

async function seedAllocation(
  id: string,
  payload: ReturnType<typeof allocationPayload>,
  archived = false,
) {
  await seed({ template: template.allocation, id, payload, archived });
}

beforeAll(async () => {
  await admin.query(`CREATE SCHEMA ${schema}`);
  await pool.query(`
    CREATE TABLE contracts (
      template_fqn text NOT NULL,
      contract_id text NOT NULL,
      payload jsonb NOT NULL,
      archived_at_ix bigint,
      PRIMARY KEY (template_fqn, contract_id)
    );
    CREATE FUNCTION active(template_name text)
    RETURNS TABLE (contract_id text, payload jsonb)
    LANGUAGE sql STABLE AS $$
      SELECT c.contract_id, c.payload FROM contracts c
      WHERE c.template_fqn = template_name AND c.archived_at_ix IS NULL
    $$;
  `);
  const licenses: Seed[] = [
    {
      template: template.license,
      id: 'license-primary',
      payload: licensePayload('provider::test', 'user::test', '7'),
    },
    {
      template: template.license,
      id: 'license-same-key',
      payload: licensePayload('provider::test', 'user::test', '7'),
    },
    {
      template: template.license,
      id: 'license-other-provider',
      payload: licensePayload('other-provider::test', 'user::test', '7'),
    },
    {
      template: template.license,
      id: 'license-other-user',
      payload: licensePayload('provider::test', 'other-user::test', '7'),
    },
    {
      template: template.license,
      id: 'license-other-number',
      payload: licensePayload('provider::test', 'user::test', '8'),
    },
    {
      template: template.license,
      id: 'license-no-renewals',
      payload: licensePayload('provider::test', 'no-renewal-user::test', '1'),
    },
    {
      template: template.license,
      id: 'license-both-parties',
      payload: licensePayload('same-party::test', 'same-party::test', '1'),
    },
    {
      template: template.license,
      id: 'license-archived',
      payload: licensePayload('provider::test', 'user::test', '7'),
      archived: true,
    },
  ];
  for (const license of licenses) await seed(license);

  const renewals = [
    ['renewal-primary', 'request-primary', 'provider::test', 'user::test', '7', false],
    ['renewal-same-request-1', 'request-duplicate', 'provider::test', 'user::test', '7', false],
    ['renewal-same-request-2', 'request-duplicate', 'provider::test', 'user::test', '7', false],
    [
      'renewal-other-provider',
      'request-other-provider',
      'other-provider::test',
      'user::test',
      '7',
      false,
    ],
    ['renewal-other-user', 'request-other-user', 'provider::test', 'other-user::test', '7', false],
    ['renewal-other-number', 'request-other-number', 'provider::test', 'user::test', '8', false],
    ['renewal-no-allocation', 'request-no-allocation', 'provider::test', 'user::test', '7', false],
    [
      'renewal-no-license',
      'request-no-license',
      'provider::test',
      'unmatched-user::test',
      '9',
      false,
    ],
    ['renewal-archived', 'request-archived', 'provider::test', 'user::test', '7', true],
  ] as const;
  for (const [id, requestId, provider, user, licenseNum, archived] of renewals) {
    const payload = renewalPayload(requestId, provider, user, licenseNum);
    await seed({ template: template.renewal, id, payload, archived });
    if (archived) continue;
    await seed({
      template: template.allocationRequest,
      id,
      payload: allocationRequestView(requestId, provider, user) as Record<string, unknown>,
    });
  }

  await seedAllocation(
    'allocation-primary',
    allocationPayload('request-primary', party.provider, party.user),
  );
  await seedAllocation(
    'allocation-duplicate-1',
    allocationPayload('request-duplicate', party.provider, party.user),
  );
  await seedAllocation(
    'allocation-duplicate-2',
    allocationPayload('request-duplicate', party.provider, party.user),
  );
  await seedAllocation(
    'allocation-other-provider',
    allocationPayload('request-other-provider', 'other-provider::test', party.user),
  );
  await seedAllocation(
    'allocation-other-user',
    allocationPayload('request-other-user', party.provider, 'other-user::test'),
  );
  await seedAllocation(
    'allocation-other-number',
    allocationPayload('request-other-number', party.provider, party.user),
  );
  await seedAllocation(
    'allocation-archived',
    allocationPayload('request-primary', party.provider, party.user),
    true,
  );
});

afterAll(async () => {
  try {
    await pool.end();
  } finally {
    try {
      await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    } finally {
      await admin.end();
    }
  }
});

function renewalsByLicense(result: Awaited<ReturnType<typeof findActiveLicenses>>) {
  return Object.fromEntries(
    result.map(({ license, renewals }) => [
      license.contractId.toString(),
      renewals.map(({ renewal, allocationCid }) => ({
        contractId: renewal.contractId.toString(),
        allocationCid: allocationCid?.toString(),
      })),
    ]),
  );
}

test('finds active licenses by provider or user and groups duplicate keys by contract ID', async () => {
  const result = await findActiveLicenses(pool, party.provider);
  const grouped = renewalsByLicense(result);

  expect(Object.keys(grouped).sort()).toEqual([
    'license-no-renewals',
    'license-other-number',
    'license-other-user',
    'license-primary',
    'license-same-key',
  ]);
  expect(grouped['license-primary']).toEqual([
    { contractId: 'renewal-no-allocation', allocationCid: undefined },
    { contractId: 'renewal-primary', allocationCid: 'allocation-primary' },
    { contractId: 'renewal-same-request-1', allocationCid: 'allocation-duplicate-1' },
    { contractId: 'renewal-same-request-1', allocationCid: 'allocation-duplicate-2' },
    { contractId: 'renewal-same-request-2', allocationCid: 'allocation-duplicate-1' },
    { contractId: 'renewal-same-request-2', allocationCid: 'allocation-duplicate-2' },
  ]);
  expect(grouped['license-same-key']).toEqual(grouped['license-primary']);
  expect(grouped['license-no-renewals']).toEqual([]);
  expect(grouped['license-other-user']).toEqual([
    { contractId: 'renewal-other-user', allocationCid: 'allocation-other-user' },
  ]);
  expect(grouped['license-other-number']).toEqual([
    { contractId: 'renewal-other-number', allocationCid: 'allocation-other-number' },
  ]);
});

test('includes user-visible licenses and keeps provider-scoped renewals separate', async () => {
  const userResult = await findActiveLicenses(pool, party.user);
  const userGrouped = renewalsByLicense(userResult);
  expect(userGrouped['license-primary']).toEqual(userGrouped['license-same-key']);
  expect(userGrouped['license-other-provider']).toEqual([
    { contractId: 'renewal-other-provider', allocationCid: 'allocation-other-provider' },
  ]);

  const sameParty = await findActiveLicenses(pool, 'same-party::test');
  expect(sameParty.map(({ license }) => license.contractId.toString())).toEqual([
    'license-both-parties',
  ]);
  expect(sameParty[0]?.renewals).toEqual([]);
});

test('returns no rows when the party has no active license', async () => {
  expect(await findActiveLicenses(pool, 'outsider::test')).toEqual([]);
});

type Allocation = ReturnType<typeof allocationPayload>;

const mismatchedAllocationFields: [string, (allocation: Allocation) => void][] = [
  [
    'settlement executor',
    (allocation) => {
      allocation.allocation.settlement.executor = 'wrong-provider::test';
    },
  ],
  [
    'settlement reference ID',
    (allocation) => {
      allocation.allocation.settlement.settlementRef.id = 'wrong-request';
    },
  ],
  [
    'settlement reference CID',
    (allocation) => {
      allocation.allocation.settlement.settlementRef.cid =
        'wrong-cid' as AllocationRequestView['settlement']['settlementRef']['cid'];
    },
  ],
  [
    'settlement requestedAt',
    (allocation) => {
      allocation.allocation.settlement.requestedAt = '2026-10-30T12:00:01Z';
    },
  ],
  [
    'settlement allocateBefore',
    (allocation) => {
      allocation.allocation.settlement.allocateBefore = '2026-10-30T13:00:01Z';
    },
  ],
  [
    'settlement settleBefore',
    (allocation) => {
      allocation.allocation.settlement.settleBefore = '2026-10-30T14:00:01Z';
    },
  ],
  [
    'settlement metadata',
    (allocation) => {
      allocation.allocation.settlement.meta = { values: { reason: 'different' } };
    },
  ],
  [
    'transfer leg ID',
    (allocation) => {
      allocation.allocation.transferLegId = 'wrong-leg';
    },
  ],
  [
    'transfer leg sender',
    (allocation) => {
      allocation.allocation.transferLeg.sender = 'wrong-user::test';
    },
  ],
  [
    'transfer leg receiver',
    (allocation) => {
      allocation.allocation.transferLeg.receiver = 'wrong-provider::test';
    },
  ],
  [
    'transfer leg amount',
    (allocation) => {
      allocation.allocation.transferLeg.amount = '12.35';
    },
  ],
  [
    'transfer leg instrument',
    (allocation) => {
      allocation.allocation.transferLeg.instrumentId.id = 'wrong-instrument';
    },
  ],
  [
    'transfer leg metadata',
    (allocation) => {
      allocation.allocation.transferLeg.meta = { values: { reason: 'different' } };
    },
  ],
];

test.each(mismatchedAllocationFields)(
  'ignores an allocation with a mismatched %s',
  async (field, mutate) => {
    const id = `mismatch-${field.replaceAll(' ', '-')}`;
    const allocation = allocationPayload('request-primary', party.provider, party.user);
    mutate(allocation);
    await seedAllocation(id, allocation);

    try {
      const result = await findActiveLicenses(pool, party.provider);
      const grouped = renewalsByLicense(result);
      expect(
        grouped['license-primary']?.filter(({ contractId }) => contractId === 'renewal-primary'),
      ).toEqual([{ contractId: 'renewal-primary', allocationCid: 'allocation-primary' }]);
    } finally {
      await pool.query('DELETE FROM contracts WHERE template_fqn = $1 AND contract_id = $2', [
        template.allocation,
        id,
      ]);
    }
  },
);

test('normalizes numeric and timestamp representations when matching allocations', async () => {
  const allocation = allocationPayload('request-primary', party.provider, party.user);
  allocation.allocation.transferLeg.amount = '12.3400000000';
  allocation.allocation.settlement.requestedAt = '2026-10-30T12:00:00Z';
  allocation.allocation.settlement.allocateBefore = '2026-10-30T13:00:00Z';
  allocation.allocation.settlement.settleBefore = '2026-10-30T14:00:00Z';
  await seedAllocation('allocation-equivalent-format', allocation);

  try {
    const result = await findActiveLicenses(pool, party.provider);
    const matching = renewalsByLicense(result)['license-primary']?.filter(
      ({ contractId }) => contractId === 'renewal-primary',
    );
    expect(matching?.map(({ allocationCid }) => allocationCid).sort()).toEqual([
      'allocation-equivalent-format',
      'allocation-primary',
    ]);
  } finally {
    await pool.query('DELETE FROM contracts WHERE template_fqn = $1 AND contract_id = $2', [
      template.allocation,
      'allocation-equivalent-format',
    ]);
  }
});

test('compares large decimal amounts without losing integer precision', async () => {
  const licenseNum = '9007199254740993';
  const requestId = 'request-large-amount';
  const licenseId = 'license-large-amount';
  const renewalId = 'renewal-large-amount';
  const view = allocationRequestView(requestId, party.provider, party.user);
  view.transferLegs.licenseFeePayment.amount = '9007199254740993.0000000000';
  await seed({
    template: template.license,
    id: licenseId,
    payload: licensePayload(party.provider, party.user, licenseNum),
  });
  await seed({
    template: template.renewal,
    id: renewalId,
    payload: renewalPayload(requestId, party.provider, party.user, licenseNum, {
      licenseFeeAmount: '9007199254740993.0000000000',
    }),
  });
  await seed({
    template: template.allocationRequest,
    id: renewalId,
    payload: view as Record<string, unknown>,
  });
  await seedAllocation(
    'allocation-rounded-neighbor',
    allocationPayload(requestId, party.provider, party.user, view),
  );
  const neighbor = allocationPayload(requestId, party.provider, party.user, view);
  neighbor.allocation.transferLeg.amount = '9007199254740992.0000000000';
  await seedAllocation('allocation-large-decimal-mismatch', neighbor);

  try {
    const result = await findActiveLicenses(pool, party.provider);
    const largeLicense = result.find(({ license }) => license.contractId.toString() === licenseId);
    expect(
      largeLicense?.renewals.map(({ renewal, allocationCid }) => ({
        renewalId: renewal.contractId.toString(),
        allocationCid: allocationCid?.toString(),
      })),
    ).toEqual([{ renewalId, allocationCid: 'allocation-rounded-neighbor' }]);
  } finally {
    await pool.query('DELETE FROM contracts WHERE contract_id IN ($1, $2, $3, $4, $5)', [
      licenseId,
      renewalId,
      'allocation-rounded-neighbor',
      'allocation-large-decimal-mismatch',
      renewalId,
    ]);
  }
});

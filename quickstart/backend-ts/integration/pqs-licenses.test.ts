import { afterAll, beforeAll, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { readPostgresConfig } from '../src/config/postgres';

import { License, LicenseRenewalRequest } from '../src/daml/licensing';
import { findActiveLicenses } from '../src/modules/licenses';

const schema = `pqs_licenses_${randomUUID().replaceAll('-', '')}`;
const config = readPostgresConfig();
const admin = new Pool(config);
const pool = new Pool({ ...config, options: `-c search_path=${schema},pg_catalog` });

const party = { provider: 'provider::test', user: 'user::test' };
type RenewalPayload = Omit<LicenseRenewalRequest, 'settlementReference' | 'originalRequestCid'> & {
  settlementReference: string;
  originalRequestCid: string | null;
};
const licensePayload = (provider: string, user: string, licenseNum: string) => ({
  provider,
  user,
  uuid: '00000000-0000-4000-8000-000000000001',
  licenseNum,
  expiresAt: '2026-10-30T00:00:00Z',
  params: { meta: { values: {} } },
});
const renewalPayload = (
  requestId: string,
  provider: string,
  user: string,
  licenseNum: string,
  overrides: Partial<
    Pick<RenewalPayload, 'uuid' | 'licenseFeeAmount' | 'originalRequestCid' | 'settlementReference'>
  > = {},
): RenewalPayload => ({
  requestId,
  provider,
  user,
  uuid: '00000000-0000-4000-8000-000000000001',
  licenseNum,
  licenseFeeAmount: '12.3400000000',
  licenseFeeInstrumentId: { admin: provider, id: 'test-instrument' },
  licenseExtensionDuration: { microseconds: '86400000000' },
  settleBefore: '2026-10-30T14:00:00Z',
  requestedAt: '2026-10-30T12:00:00Z',
  description: 'Renewal test',
  settlementReference: `settlement-reference-${provider}-${user}-${requestId}`,
  originalRequestCid: null,
  ...overrides,
});
const metadataFor = (renewal: RenewalPayload) => ({
  values: {
    'splice.lfdecentralizedtrust.org/reason': renewal.description,
    'cn-quickstart.example.org/licenseNum': renewal.licenseNum,
    'cn-quickstart.example.org/uuid': renewal.uuid,
  },
});
const settlementFor = (renewal: RenewalPayload) => ({
  executors: [renewal.provider],
  id: renewal.requestId,
  cid: renewal.settlementReference,
  meta: metadataFor(renewal),
});
const allocationSpecificationFor = (renewal: RenewalPayload) => ({
  admin: renewal.licenseFeeInstrumentId.admin,
  authorizer: { owner: renewal.user, provider: null, id: '' },
  transferLegSides: [
    {
      transferLegId: 'licenseFeePayment',
      side: 'SenderSide',
      otherside: { owner: renewal.provider, provider: null, id: '' },
      amount: renewal.licenseFeeAmount,
      instrumentId: renewal.licenseFeeInstrumentId.id,
      meta: metadataFor(renewal),
    },
  ],
  settlementDeadline: renewal.settleBefore,
  nextIterationFunding: null,
  committed: false,
  meta: { values: {} },
});
const allocationRequestView = (renewal: RenewalPayload) => ({
  originalRequestCid: renewal.originalRequestCid,
  settlement: settlementFor(renewal),
  allocations: [allocationSpecificationFor(renewal)],
  requestedAt: renewal.requestedAt,
  settleAt: null,
  availableActions: [],
  meta: metadataFor(renewal),
});
const allocationPayload = (renewal: RenewalPayload) => ({
  originalAllocationCid: null,
  settlement: settlementFor(renewal),
  allocation: allocationSpecificationFor(renewal),
  holdingCids: [],
  createdAt: renewal.requestedAt,
  numIterations: '0',
  expiresAt: null,
  availableActions: [],
  meta: { values: {} },
});

type Seed = {
  template: string;
  id: string;
  payload: Record<string, unknown>;
  archived?: boolean;
  signatories?: string[];
};
const template = {
  license: License.templateId.slice(1),
  renewal: LicenseRenewalRequest.templateId.slice(1),
  allocationRequest:
    'splice-api-token-allocation-request-v2:Splice.Api.Token.AllocationRequestV2:AllocationRequest',
  allocation: 'splice-api-token-allocation-v2:Splice.Api.Token.AllocationV2:Allocation',
};

async function seed({ template: fqn, id, payload, archived = false, signatories = [] }: Seed) {
  await pool.query(
    'INSERT INTO contracts (template_fqn, contract_id, payload, archived_at_ix, signatories) VALUES ($1, $2, $3, $4, $5)',
    [fqn, id, payload, archived ? 1 : null, signatories],
  );
}

async function seedAllocation(
  id: string,
  payload: ReturnType<typeof allocationPayload>,
  archived = false,
  signatories: string[] = [payload.allocation.admin, payload.allocation.authorizer.owner ?? ''],
) {
  await seed({ template: template.allocation, id, payload, archived, signatories });
}

beforeAll(async () => {
  await admin.query(`CREATE SCHEMA ${schema}`);
  await pool.query(`
    CREATE TABLE contracts (
      template_fqn text NOT NULL,
      contract_id text NOT NULL,
      payload jsonb NOT NULL,
      archived_at_ix bigint,
      signatories text[] NOT NULL DEFAULT '{}',
      PRIMARY KEY (template_fqn, contract_id)
    );
    CREATE FUNCTION active(template_name text)
    RETURNS TABLE (contract_id text, payload jsonb, signatories text[])
    LANGUAGE sql STABLE AS $$
      SELECT c.contract_id, c.payload, c.signatories FROM contracts c
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
      id: 'license-other-uuid',
      payload: {
        ...licensePayload('provider::test', 'user::test', '7'),
        uuid: '00000000-0000-4000-8000-000000000002',
      },
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
    ['renewal-other-provider', 'request-primary', 'other-provider::test', 'user::test', '7', false],
    ['renewal-other-user', 'request-other-user', 'provider::test', 'other-user::test', '7', false],
    ['renewal-other-uuid', 'request-other-uuid', 'provider::test', 'user::test', '7', false],
    ['renewal-no-allocation', 'request-no-allocation', 'provider::test', 'user::test', '7', false],
    [
      'renewal-no-license',
      'request-no-license',
      'provider::test',
      'unmatched-user::test',
      '9',
      false,
    ],
    // CompleteRenewal also checks the license number when the same UUID is reused.
    ['renewal-wrong-number', 'request-wrong-number', 'provider::test', 'user::test', '8', false],
    ['renewal-archived', 'request-archived', 'provider::test', 'user::test', '7', true],
  ] as const;
  for (const [id, requestId, provider, user, licenseNum, archived] of renewals) {
    const payload = {
      ...renewalPayload(requestId, provider, user, licenseNum),
      ...(id === 'renewal-same-request-2'
        ? { settlementReference: 'second-settlement-reference' }
        : {}),
      ...(id === 'renewal-primary'
        ? { originalRequestCid: 'renewal-primary-before-wallet-accept' }
        : {}),
    };
    if (id === 'renewal-other-uuid') payload.uuid = '00000000-0000-4000-8000-000000000002';
    if (id === 'renewal-primary') {
      await seed({
        template: template.renewal,
        id: 'renewal-primary-before-wallet-accept',
        payload: renewalPayload(requestId, provider, user, licenseNum),
        archived: true,
      });
      await seed({
        template: template.renewal,
        id: 'renewal-primary-previous-use',
        payload: renewalPayload(requestId, provider, user, licenseNum, {
          settlementReference: 'settlement-reference-previous-use',
        }),
        archived: true,
      });
    }
    await seed({ template: template.renewal, id, payload, archived });
    if (archived) continue;
    await seed({
      template: template.allocationRequest,
      id,
      payload: allocationRequestView(payload) as Record<string, unknown>,
    });
  }

  await seedAllocation(
    'allocation-primary',
    allocationPayload(renewalPayload('request-primary', party.provider, party.user, '7')),
  );
  const staleAllocation = allocationPayload(
    renewalPayload('request-primary', party.provider, party.user, '7', {
      settlementReference: 'settlement-reference-previous-use',
    }),
  );
  await seedAllocation('allocation-stale-reference', staleAllocation);
  await seedAllocation(
    'allocation-without-admin-signature',
    allocationPayload(renewalPayload('request-primary', party.provider, party.user, '7')),
    false,
    [party.user],
  );
  await seedAllocation(
    'allocation-duplicate-1',
    allocationPayload(renewalPayload('request-duplicate', party.provider, party.user, '7')),
  );
  await seedAllocation(
    'allocation-other-user',
    allocationPayload(
      renewalPayload('request-other-user', party.provider, 'other-user::test', '7'),
    ),
  );
  await seedAllocation(
    'allocation-other-uuid',
    allocationPayload(
      renewalPayload('request-other-uuid', party.provider, party.user, '7', {
        uuid: '00000000-0000-4000-8000-000000000002',
      }),
    ),
  );
  await seedAllocation(
    'allocation-archived',
    allocationPayload(renewalPayload('request-primary', party.provider, party.user, '7')),
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
    'license-other-user',
    'license-other-uuid',
    'license-primary',
    'license-same-key',
  ]);
  expect(grouped['license-primary']).toEqual([
    { contractId: 'renewal-no-allocation', allocationCid: undefined },
    { contractId: 'renewal-primary', allocationCid: 'allocation-primary' },
    { contractId: 'renewal-same-request-1', allocationCid: 'allocation-duplicate-1' },
    { contractId: 'renewal-same-request-2', allocationCid: undefined },
  ]);
  expect(grouped['license-same-key']).toEqual(grouped['license-primary']);
  expect(grouped['license-no-renewals']).toEqual([]);
  expect(grouped['license-other-user']).toEqual([
    { contractId: 'renewal-other-user', allocationCid: 'allocation-other-user' },
  ]);
  expect(grouped['license-other-uuid']).toEqual([
    { contractId: 'renewal-other-uuid', allocationCid: 'allocation-other-uuid' },
  ]);
});

test('includes user-visible licenses and keeps provider-scoped renewals separate', async () => {
  const userResult = await findActiveLicenses(pool, party.user);
  const userGrouped = renewalsByLicense(userResult);
  expect(userGrouped['license-primary']).toEqual(userGrouped['license-same-key']);
  expect(userGrouped['license-primary']).toEqual([
    { contractId: 'renewal-no-allocation', allocationCid: undefined },
    { contractId: 'renewal-primary', allocationCid: 'allocation-primary' },
    { contractId: 'renewal-same-request-1', allocationCid: 'allocation-duplicate-1' },
    { contractId: 'renewal-same-request-2', allocationCid: undefined },
  ]);
  expect(userGrouped['license-other-provider']).toEqual([
    { contractId: 'renewal-other-provider', allocationCid: undefined },
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

function firstTransferLegSide(allocation: Allocation) {
  const side = allocation.allocation.transferLegSides[0];
  if (!side) throw new Error('Expected one transfer leg side in the fixture');
  return side;
}

const mismatchedAllocationFields: [string, (allocation: Allocation) => void][] = [
  [
    'settlement executors',
    (allocation) => {
      allocation.settlement.executors = ['wrong-provider::test'];
    },
  ],
  [
    'settlement reference ID',
    (allocation) => {
      allocation.settlement.id = 'wrong-request';
    },
  ],
  [
    'settlement reference CID',
    (allocation) => {
      allocation.settlement.cid = 'wrong-cid';
    },
  ],
  [
    'settlement metadata',
    (allocation) => {
      allocation.settlement.meta = {
        values: {
          ...allocation.settlement.meta.values,
          'splice.lfdecentralizedtrust.org/reason': 'different',
        },
      };
    },
  ],
  [
    'transfer leg amount',
    (allocation) => {
      firstTransferLegSide(allocation).transferLegId = 'wrong-leg';
    },
  ],
  [
    'transfer leg instrument',
    (allocation) => {
      allocation.allocation.authorizer.owner = 'wrong-user::test';
    },
  ],
  [
    'transfer leg metadata',
    (allocation) => {
      firstTransferLegSide(allocation).otherside.owner = 'wrong-provider::test';
    },
  ],
  [
    'transfer leg ID',
    (allocation) => {
      firstTransferLegSide(allocation).amount = '12.35';
    },
  ],
  [
    'transfer leg sender',
    (allocation) => {
      firstTransferLegSide(allocation).instrumentId = 'wrong-instrument';
    },
  ],
  [
    'transfer leg receiver',
    (allocation) => {
      firstTransferLegSide(allocation).meta = {
        values: {
          ...firstTransferLegSide(allocation).meta.values,
          'splice.lfdecentralizedtrust.org/reason': 'different',
        },
      };
    },
  ],
  [
    'settlement deadline',
    (allocation) => {
      allocation.allocation.settlementDeadline = '2026-10-30T14:00:01Z';
    },
  ],
  [
    'allocation metadata',
    (allocation) => {
      allocation.allocation.meta = { values: { reason: 'different' } };
    },
  ],
];

test.each(mismatchedAllocationFields)(
  'ignores an allocation with a mismatched %s',
  async (field, mutate) => {
    const id = `mismatch-${field.replaceAll(' ', '-')}`;
    const primary = renewalPayload('request-primary', party.provider, party.user, '7');
    const allocation = structuredClone(allocationPayload(primary));
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

test('normalizes numeric and deadline representations when matching allocations', async () => {
  const primary = renewalPayload('request-primary', party.provider, party.user, '7');
  const allocation = structuredClone(allocationPayload(primary));
  firstTransferLegSide(allocation).amount = '12.3400000000';
  allocation.allocation.settlementDeadline = '2026-10-30T15:00:00+01:00';
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
  const renewal = renewalPayload(requestId, party.provider, party.user, licenseNum, {
    uuid: '00000000-0000-4000-8000-000000000003',
    licenseFeeAmount: '9007199254740993.0000000000',
  });
  const view = allocationRequestView(renewal);
  await seed({
    template: template.license,
    id: licenseId,
    payload: {
      ...licensePayload(party.provider, party.user, licenseNum),
      uuid: '00000000-0000-4000-8000-000000000003',
    },
  });
  await seed({
    template: template.renewal,
    id: renewalId,
    payload: renewal,
  });
  await seed({
    template: template.allocationRequest,
    id: renewalId,
    payload: view as Record<string, unknown>,
  });
  await seedAllocation('allocation-rounded-neighbor', allocationPayload(renewal));
  const neighbor = structuredClone(allocationPayload(renewal));
  firstTransferLegSide(neighbor).amount = '9007199254740992.0000000000';
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

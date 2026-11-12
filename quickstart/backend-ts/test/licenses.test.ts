import { afterEach, expect, spyOn, test } from 'bun:test';
import { Pool } from 'pg';
import { AllocationRequest } from '../build/generated-daml-bindings/splice-api-token-allocation-request-v1-1.0.0/lib/Splice/Api/Token/AllocationRequestV1/module';
import { Allocation } from '../build/generated-daml-bindings/splice-api-token-allocation-v1-1.0.0/lib/Splice/Api/Token/AllocationV1/module';
import { License, LicenseRenewalRequest } from '../src/daml/licensing';
import { findActiveLicenses } from '../src/modules/licenses';

const pools: Pool[] = [];

function poolWithRows(rows: object[] = []) {
  const pool = new Pool({
    host: '127.0.0.1',
    database: 'pqs-test',
    user: 'pqs-test',
    password: 'test',
  });
  pools.push(pool);
  const query = spyOn(pool, 'query').mockResolvedValue({ rows } as never);
  return { pool, query };
}

afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.end()));
});

const licensePayload = (provider: string, user: string, licenseNum: string) => ({
  provider,
  user,
  licenseNum,
  expiresAt: '2026-10-30T00:00:00Z',
  params: { meta: { values: {} } },
});

const renewalPayload = (requestId: string, provider: string, user: string, licenseNum: string) => ({
  requestId,
  provider,
  user,
  licenseNum,
  licenseFeeAmount: '12.3400000000',
  licenseFeeInstrumentId: { admin: 'provider::test', id: 'test-token' },
  licenseExtensionDuration: { microseconds: '86400000000' },
  prepareUntil: '2026-10-22T13:00:00.123456Z',
  settleBefore: '2026-10-22T14:00:00.123456Z',
  requestedAt: '2026-10-22T12:00:00.123456Z',
  description: 'Renewal test',
});

function row(
  licenseId: string,
  license: ReturnType<typeof licensePayload>,
  renewalId: string | null = null,
  renewal: ReturnType<typeof renewalPayload> | null = null,
  allocationId: string | null = null,
) {
  return {
    license_contract_id: licenseId,
    license_payload: license,
    renewal_contract_id: renewalId,
    renewal_payload: renewal,
    allocation_contract_id: allocationId,
  };
}

test('groups joined rows by license while retaining absent renewals and every allocation match', async () => {
  const licenseA = licensePayload('provider::test', 'user::test', '1');
  const licenseB = licensePayload('provider::test', 'another-user::test', '1');
  const noRenewals = licensePayload('provider::test', 'user::test', '2');
  const renewalA = renewalPayload('request-a', 'provider::test', 'user::test', '1');
  const renewalD = { ...renewalA, licenseFeeAmount: '98.7600000000' };
  const renewalB = renewalPayload('request-b', 'provider::test', 'another-user::test', '1');
  const { pool, query } = poolWithRows([
    row('license-a', licenseA, 'renewal-a', renewalA, 'allocation-a'),
    row('license-b', licenseB, 'renewal-b', renewalB, 'allocation-b'),
    row('license-a', licenseA, 'renewal-a', renewalA, 'allocation-a-2'),
    row(
      'license-a',
      licenseA,
      'renewal-c',
      renewalPayload('request-c', 'provider::test', 'user::test', '1'),
    ),
    row('license-a', licenseA, 'renewal-d', renewalD, 'allocation-d'),
    row('license-no-renewals', noRenewals),
  ]);
  const party = "user' OR true --";

  const results = await findActiveLicenses(pool, party);

  expect(query).toHaveBeenCalledTimes(1);
  expect(query).toHaveBeenCalledWith(expect.any(String), [
    License.templateId.slice(1),
    LicenseRenewalRequest.templateId.slice(1),
    AllocationRequest.templateId.slice(1),
    Allocation.templateId.slice(1),
    party,
  ]);
  expect(results.map(({ license }) => license.contractId.toString())).toEqual([
    'license-a',
    'license-b',
    'license-no-renewals',
  ]);
  expect(results[0]?.license.payload).toEqual(licenseA);
  expect(
    results[0]?.renewals.map(({ renewal, allocationCid }) => [
      renewal.contractId.toString(),
      allocationCid?.toString(),
    ]),
  ).toEqual([
    ['renewal-a', 'allocation-a'],
    ['renewal-a', 'allocation-a-2'],
    ['renewal-c', undefined],
    ['renewal-d', 'allocation-d'],
  ]);
  expect(results[0]?.renewals[3]?.renewal.payload).toEqual(renewalD);
  expect(results[2]?.renewals).toEqual([]);
  expect(
    results[1]?.renewals.map(({ renewal, allocationCid }) => [
      renewal.contractId.toString(),
      allocationCid?.toString(),
    ]),
  ).toEqual([['renewal-b', 'allocation-b']]);
  expect(results[0]?.renewals[0]?.renewal.payload).toEqual(renewalA);
});

test('returns an empty list when the party has no visible licenses', async () => {
  const { pool } = poolWithRows();

  expect(await findActiveLicenses(pool, 'unknown-party::test')).toEqual([]);
});

test('preserves the database error cause', async () => {
  const { pool, query } = poolWithRows();
  const databaseError = new Error('connection rejected');
  query.mockRejectedValue(databaseError as never);

  await expect(findActiveLicenses(pool, 'user::test')).rejects.toMatchObject({
    message: 'Failed to list active licenses',
    cause: databaseError,
  });
});

const validLicense = licensePayload('provider::test', 'user::test', '1');
const validRenewal = renewalPayload('request', 'provider::test', 'user::test', '1');
const baseRow = {
  license_contract_id: 'license-bad',
  license_payload: validLicense,
  renewal_contract_id: 'renewal-good',
  renewal_payload: validRenewal,
  allocation_contract_id: null,
};

const invalidRows = [
  {
    field: 'license',
    row: {
      ...baseRow,
      license_payload: { provider: 42 },
      renewal_contract_id: null,
      renewal_payload: null,
    },
    expected: 'Failed to decode PQS contract license-bad',
  },
  {
    field: 'renewal',
    row: { ...baseRow, renewal_contract_id: 'renewal-bad', renewal_payload: { requestId: 42 } },
    expected: 'Failed to decode PQS contract renewal-bad',
  },
  {
    field: 'allocation ID',
    row: { ...baseRow, allocation_contract_id: 42 },
    expected: 'expected a string, got a number',
  },
];

test.each(invalidRows)('rejects an invalid $field row', async ({ row: invalidRow, expected }) => {
  const { pool } = poolWithRows([invalidRow]);
  await expect(findActiveLicenses(pool, 'user::test')).rejects.toThrow(expected);
});

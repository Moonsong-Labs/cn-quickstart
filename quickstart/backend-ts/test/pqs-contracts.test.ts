import { afterEach, expect, spyOn, test } from 'bun:test';
import { Pool } from 'pg';
import {
  AllocationRequest,
  type AllocationRequestView,
} from '../build/generated-daml-bindings/splice-api-token-allocation-request-v1-1.0.0/lib/Splice/Api/Token/AllocationRequestV1/module';
import {
  AppInstall,
  AppInstallRequest,
  License,
  LicenseRenewalRequest,
} from '../src/daml/licensing';
import {
  type Contract,
  findActiveById,
  listActive,
  listActiveByKey,
} from '../src/integrations/pqs/contracts';

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

const allocationRequestPayload = {
  settlement: {
    executor: 'provider::test',
    settlementRef: { id: 'renewal-1', cid: null },
    requestedAt: '2026-10-22T12:00:00.123456Z',
    allocateBefore: '2026-10-22T13:00:00.123456Z',
    settleBefore: '2026-10-22T14:00:00.123456Z',
    meta: { values: {} },
  },
  transferLegs: {
    '0': {
      sender: 'user::test',
      receiver: 'provider::test',
      amount: '12.3400000000',
      instrumentId: { admin: 'issuer::test', id: 'test-token' },
      meta: { values: {} },
    },
  },
  meta: { values: {} },
};

const licenseKey = {
  provider: 'provider::test',
  user: 'user::test',
  licenseNum: '9007199254740993',
};

test('lists active contracts by the encoded template key and decodes all matches', async () => {
  const { pool, query } = poolWithRows([
    {
      contract_id: 'license-1',
      payload: {
        provider: licenseKey.provider,
        user: licenseKey.user,
        licenseNum: licenseKey.licenseNum,
        expiresAt: '2026-10-30T00:00:00Z',
        params: { meta: { values: {} } },
      },
    },
    {
      contract_id: 'license-2',
      payload: {
        provider: licenseKey.provider,
        user: licenseKey.user,
        licenseNum: licenseKey.licenseNum,
        expiresAt: '2026-10-31T00:00:00Z',
        params: { meta: { values: {} } },
      },
    },
  ]);

  const contracts = await listActiveByKey(pool, License, licenseKey);

  expect(query).toHaveBeenCalledWith(
    'SELECT contract_id, payload FROM active($1) WHERE contract_key = $2::jsonb',
    ['quickstart-licensing:Licensing.License:License', JSON.stringify(licenseKey)],
  );
  expect(contracts.map(({ contractId }) => contractId.toString())).toEqual([
    'license-1',
    'license-2',
  ]);
  expect(contracts[0]?.payload.licenseNum).toBe('9007199254740993');
});

test('rejects invalid and unkeyed contract keys before querying PQS', async () => {
  const { pool, query } = poolWithRows();

  // @ts-expect-error License keys require provider, user, and licenseNum.
  await expect(listActiveByKey(pool, License, { provider: 'provider::test' })).rejects.toThrow(
    'Failed to encode PQS contract key',
  );
  // @ts-expect-error provider must be a Daml Party string.
  await expect(listActiveByKey(pool, License, { ...licenseKey, provider: 42 })).rejects.toThrow(
    'Failed to encode PQS contract key',
  );
  await expect(listActiveByKey(pool, AppInstall, undefined)).rejects.toThrow(
    'Failed to encode PQS contract key',
  );
  expect(query).not.toHaveBeenCalled();
});

test('wraps key query failures with template context and preserves the cause', async () => {
  const { pool, query } = poolWithRows();
  const databaseError = new Error('connection rejected');
  query.mockRejectedValue(databaseError as never);

  await expect(listActiveByKey(pool, License, licenseKey)).rejects.toMatchObject({
    message:
      'Failed to list active PQS contracts by key for #quickstart-licensing:Licensing.License:License',
    cause: databaseError,
  });
});

test('wraps malformed key-query payloads with contract context', async () => {
  const { pool } = poolWithRows([{ contract_id: 'bad-license', payload: { provider: 42 } }]);

  await expect(listActiveByKey(pool, License, licenseKey)).rejects.toThrow(
    'Failed to decode PQS contract bad-license for #quickstart-licensing:Licensing.License:License',
  );
});

test('lists and decodes active installation contracts using the PQS package name', async () => {
  const { pool, query } = poolWithRows([
    {
      contract_id: 'install-1',
      payload: {
        provider: 'provider::test',
        user: 'user::test',
        meta: { values: { title: 'First' } },
        numLicensesCreated: '9007199254740993',
      },
    },
    {
      contract_id: 'install-2',
      payload: {
        provider: 'provider::test',
        user: 'user-2::test',
        meta: { values: {} },
        numLicensesCreated: '2',
      },
    },
  ]);

  const contracts = await listActive(pool, AppInstall);

  expect(query).toHaveBeenCalledWith('SELECT contract_id, payload FROM active($1)', [
    'quickstart-licensing:Licensing.AppInstall:AppInstall',
  ]);
  expect(contracts).toHaveLength(2);
  expect(String(contracts[0]?.contractId)).toBe('install-1');
  expect(contracts[0]?.payload.numLicensesCreated).toBe('9007199254740993');
  expect(contracts[1]?.payload.meta).toEqual({ values: {} });
});

test('finds an active installation request by ID and parameterizes both values', async () => {
  const { pool, query } = poolWithRows([
    {
      contract_id: 'request-1',
      payload: {
        provider: 'provider::test',
        user: 'user::test',
        meta: { values: { request: 'abc' } },
      },
    },
  ]);

  const contract = await findActiveById(pool, AppInstallRequest, 'request-1');

  expect(query).toHaveBeenCalledWith(
    'SELECT contract_id, payload FROM active($1) WHERE contract_id = $2',
    ['quickstart-licensing:Licensing.AppInstall:AppInstallRequest', 'request-1'],
  );
  expect(String(contract?.contractId)).toBe('request-1');
  expect(contract?.payload).toEqual({
    provider: 'provider::test',
    user: 'user::test',
    meta: { values: { request: 'abc' } },
  });
});

test('lists and finds active AllocationRequest interface views by ID', async () => {
  const { pool, query } = poolWithRows([
    { contract_id: 'allocation-1', payload: allocationRequestPayload },
  ]);

  const contracts: Contract<AllocationRequest>[] = await listActive(pool, AllocationRequest);

  expect(query).toHaveBeenCalledWith('SELECT contract_id, payload FROM active($1)', [
    'splice-api-token-allocation-request-v1:Splice.Api.Token.AllocationRequestV1:AllocationRequest',
  ]);
  expect(contracts).toHaveLength(1);
  expect(contracts[0]?.contractId.toString()).toBe('allocation-1');
  expect<AllocationRequestView | undefined>(contracts[0]?.payload).toEqual(
    allocationRequestPayload,
  );

  const contract = await findActiveById(pool, AllocationRequest, 'allocation-1');
  expect(query).toHaveBeenLastCalledWith(
    'SELECT contract_id, payload FROM active($1) WHERE contract_id = $2',
    [
      'splice-api-token-allocation-request-v1:Splice.Api.Token.AllocationRequestV1:AllocationRequest',
      'allocation-1',
    ],
  );
  expect(contract?.contractId.toString()).toBe('allocation-1');
  expect<AllocationRequestView | undefined>(contract?.payload).toEqual(allocationRequestPayload);
});

test('returns undefined when an AllocationRequest interface lookup finds no row', async () => {
  const { pool, query } = poolWithRows();

  expect(await findActiveById(pool, AllocationRequest, 'archived-allocation')).toBeUndefined();
  expect(query).toHaveBeenCalledWith(
    'SELECT contract_id, payload FROM active($1) WHERE contract_id = $2',
    [
      'splice-api-token-allocation-request-v1:Splice.Api.Token.AllocationRequestV1:AllocationRequest',
      'archived-allocation',
    ],
  );
});

test('rejects a payload that does not match the AllocationRequest interface view', async () => {
  const { pool } = poolWithRows([
    { contract_id: 'not-an-allocation', payload: { requestId: 'x' } },
  ]);

  await expect(listActive(pool, AllocationRequest)).rejects.toThrow(
    'Failed to decode PQS contract not-an-allocation for #splice-api-token-allocation-request-v1:Splice.Api.Token.AllocationRequestV1:AllocationRequest',
  );
});

test('decodes renewal amounts, time values, and large integers without conversion', async () => {
  const payload = {
    requestId: 'renewal-1',
    provider: 'provider::test',
    user: 'user::test',
    licenseNum: '9007199254740993',
    licenseFeeAmount: '123456789012345678.1234567890',
    licenseFeeInstrumentId: { admin: 'issuer::test', id: 'test-token' },
    licenseExtensionDuration: { microseconds: '86400000000' },
    prepareUntil: '2026-10-22T13:00:00.123456Z',
    settleBefore: '2026-10-22T14:00:00.123456Z',
    requestedAt: '2026-10-22T12:00:00.123456Z',
    description: 'Renew test license',
  };
  const { pool } = poolWithRows([{ contract_id: 'renewal-1', payload }]);

  const contract = await findActiveById(pool, LicenseRenewalRequest, 'renewal-1');

  expect(contract?.payload).toEqual(payload);
});

test('returns empty results for no active contracts and a missing ID', async () => {
  const { pool } = poolWithRows();

  expect(await listActive(pool, AppInstallRequest)).toEqual([]);
  expect(await findActiveById(pool, AppInstallRequest, 'missing')).toBeUndefined();
});

test('rejects a lookup that returns multiple active contracts', async () => {
  const { pool } = poolWithRows([
    { contract_id: 'first', payload: {} },
    { contract_id: 'second', payload: {} },
  ]);

  await expect(findActiveById(pool, AppInstall, 'duplicate')).rejects.toThrow(
    'Multiple active PQS contracts returned for #quickstart-licensing:Licensing.AppInstall:AppInstall',
  );
});

test('wraps contract decoding errors with template and contract context', async () => {
  const { pool } = poolWithRows([{ contract_id: 'bad-payload', payload: { user: 42 } }]);

  const error = await listActive(pool, AppInstall).then(
    () => {
      throw new Error('Expected contract decoding to fail');
    },
    (cause: unknown) => cause as Error,
  );

  expect(error.message).toBe(
    'Failed to decode PQS contract bad-payload for #quickstart-licensing:Licensing.AppInstall:AppInstall',
  );
  expect(error.cause).toMatchObject({
    kind: 'DecoderError',
    message: expect.stringContaining("the key 'provider' is required"),
  });
});

test('wraps query failures with template context and preserves the cause', async () => {
  const { pool, query } = poolWithRows();
  const databaseError = new Error('connection rejected');
  query.mockRejectedValue(databaseError as never);

  await expect(listActive(pool, AppInstall)).rejects.toMatchObject({
    message:
      'Failed to list active PQS contracts for #quickstart-licensing:Licensing.AppInstall:AppInstall',
    cause: databaseError,
  });
});

test('wraps lookup query failures with template context and preserves the cause', async () => {
  const { pool, query } = poolWithRows();
  const databaseError = new Error('connection rejected');
  query.mockRejectedValue(databaseError as never);

  await expect(findActiveById(pool, AppInstall, 'install-1')).rejects.toMatchObject({
    message:
      'Failed to find active PQS contract for #quickstart-licensing:Licensing.AppInstall:AppInstall',
    cause: databaseError,
  });
});

test.each(['', '  '])('returns undefined for an unmatched ID %j, matching Java', async (id) => {
  const { pool, query } = poolWithRows();

  expect(await findActiveById(pool, AppInstall, id)).toBeUndefined();
  expect(query).toHaveBeenCalledWith(
    'SELECT contract_id, payload FROM active($1) WHERE contract_id = $2',
    ['quickstart-licensing:Licensing.AppInstall:AppInstall', id],
  );
});

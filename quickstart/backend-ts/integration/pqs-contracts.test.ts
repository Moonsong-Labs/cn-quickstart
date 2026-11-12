import { afterAll, beforeAll, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { readPostgresConfig } from '../src/config/postgres';
import {
  AppInstall,
  AppInstallRequest,
  License,
  LicenseRenewalRequest,
} from '../src/daml/licensing';
import { findActiveById, listActive, listActiveByKey } from '../src/integrations/pqs/contracts';

const schema = `pqs_fixture_${randomUUID().replaceAll('-', '')}`;
const config = readPostgresConfig();
const admin = new Pool(config);
const pool = new Pool({ ...config, options: `-c search_path=${schema},pg_catalog` });
const licenseKey = {
  provider: 'provider::test',
  user: 'user::test',
  licenseNum: '9007199254740993',
};

beforeAll(async () => {
  await admin.query(`CREATE SCHEMA ${schema}`);
  await pool.query(await readFile(new URL('./fixtures/pqs.sql', import.meta.url), 'utf8'));
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

test('Lists only active contracts belonging to the requested template', async () => {
  const contracts = await listActive(pool, AppInstall);
  expect(contracts.map(({ contractId }) => contractId.toString()).sort()).toEqual([
    'install-1',
    'install-2',
  ]);
  expect(contracts.find(({ contractId }) => contractId === 'install-1')?.payload).toEqual({
    provider: 'provider::test',
    user: 'user::test',
    meta: { values: { description: 'First installation' } },
    numLicensesCreated: '9007199254740993',
  });
  expect(await listActive(pool, License)).toHaveLength(7);
});

test('Finds one contract by template and ID', async () => {
  const contract = await findActiveById(pool, AppInstallRequest, 'request-1');
  expect(contract?.contractId.toString()).toBe('request-1');
  expect(contract?.payload).toEqual({
    provider: 'provider::test',
    user: 'user::test',
    meta: { values: {} },
  });
});

test('Finds all active contracts with an exact key using PQS JSONB equality', async () => {
  const contracts = await listActiveByKey(pool, License, licenseKey);

  expect(contracts.map(({ contractId }) => contractId.toString()).sort()).toEqual([
    'license-key-match',
    'license-key-match-2',
  ]);
  expect(contracts.map(({ payload }) => payload.licenseNum)).toEqual([
    '9007199254740993',
    '9007199254740993',
  ]);
});

test('Matches the full key across provider, user, number, template, and active status', async () => {
  expect(
    (await listActiveByKey(pool, License, { ...licenseKey, user: 'another-user::test' })).map(
      ({ contractId }) => contractId.toString(),
    ),
  ).toEqual(['license-key-other-user']);
  expect(
    await listActiveByKey(pool, License, { ...licenseKey, licenseNum: '9007199254740992' }),
  ).toHaveLength(1);
  expect(await listActiveByKey(pool, License, { ...licenseKey, provider: 'absent::test' })).toEqual(
    [],
  );
  expect(
    (
      await listActiveByKey(pool, LicenseRenewalRequest, {
        provider: licenseKey.provider,
        user: licenseKey.user,
        requestId: 'renewal-ref',
      })
    ).map(({ contractId }) => contractId.toString()),
  ).toEqual(['renewal-1']);
});

test('Binds key values safely and returns no matches for absent keys', async () => {
  const injectionKey = {
    provider: "provider' OR true; DROP TABLE contracts; --",
    user: 'user::test',
    licenseNum: '1',
  };
  expect(await listActiveByKey(pool, License, injectionKey)).toEqual([]);
  expect(await listActive(pool, AppInstall)).toHaveLength(2);
  expect(await listActiveByKey(pool, License, { ...licenseKey, user: 'no-match::test' })).toEqual(
    [],
  );
});

test.each(['missing-install', 'archived-install', 'request-1', '', '  '])(
  'Returns undefined for an absent, archived, or different-template contract: %s',
  async (id) => {
    expect(await findActiveById(pool, AppInstall, id)).toBeUndefined();
  },
);

test('Preserves integer, decimal, duration, and microsecond timestamp precision from JSONB', async () => {
  const contract = await findActiveById(pool, LicenseRenewalRequest, 'renewal-1');
  expect(contract?.payload.licenseNum).toBe('9007199254740993');
  expect(contract?.payload.licenseFeeAmount).toBe('123456789012345678.1234567890');
  expect(contract?.payload.licenseExtensionDuration.microseconds).toBe('86400000000');
  expect(contract?.payload.requestedAt).toBe('2026-10-28T12:00:00.123456Z');
});

test('Binds contract IDs as values so SQL characters cannot change the query', async () => {
  expect(
    await findActiveById(pool, AppInstall, "' OR true; DROP TABLE contracts; --"),
  ).toBeUndefined();
  expect(await listActive(pool, AppInstall)).toHaveLength(2);
});

test('Rejects malformed JSONB payloads with the template and contract context', async () => {
  await expect(findActiveById(pool, AppInstallRequest, 'invalid-request')).rejects.toThrow(
    'Failed to decode PQS contract invalid-request for #quickstart-licensing:Licensing.AppInstall:AppInstallRequest',
  );
  await expect(listActive(pool, AppInstallRequest)).rejects.toThrow(
    'Failed to decode PQS contract',
  );
});

test('Preserves database failures when the PQS SQL function is unavailable', async () => {
  const unconfigured = new Pool({ ...config, options: '-c search_path=pg_catalog' });
  try {
    await expect(listActive(unconfigured, AppInstall)).rejects.toMatchObject({
      message: `Failed to list active PQS contracts for ${AppInstall.templateId}`,
      cause: { code: '42883' },
    });
  } finally {
    await unconfigured.end();
  }
});

import { afterAll, beforeAll, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { AllocationRequest } from '../../build/generated-daml-bindings/splice-api-token-allocation-request-v1-1.0.0/lib/Splice/Api/Token/AllocationRequestV1/module';
import {
  AppInstall,
  AppInstallRequest,
  License,
  LicenseRenewalRequest,
} from '../../src/daml/licensing';
import { findActiveById, listActive } from '../../src/integrations/pqs/contracts';
import { findActiveLicenses } from '../../src/modules/licenses';
import { run } from '../run';
import { incompatibleAllocations, seedFixtures } from './fixtures';

interface WireContract {
  contractId: string;
  payload: unknown;
}
interface WireLicense {
  license: WireContract;
  renewals: { renewal: WireContract; allocationCid?: string | null }[];
}
interface Snapshot {
  installs: WireContract[];
  requests: WireContract[];
  lookups: Record<string, WireContract | null | undefined>;
  licenses: Record<string, WireLicense[]>;
  invalidRenewalRejected?: boolean;
}

const quickstart = fileURLToPath(new URL('../../../', import.meta.url));
const suffix = randomUUID().replaceAll('-', '');
const container = `pqs-backward-compatibility-${suffix}`;
const schema = `java_backward_compatibility_${suffix}`;
const parties = [
  'common-provider',
  'common-user',
  'same-party',
  'outsider',
  'provider-a',
  'provider-b',
  'strict-provider',
];
let directory: string;
let started = false;
let pool: Pool;
let java: Snapshot;
let typescript: Snapshot;

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'pqs-backward-compatibility-'));
  await run(
    [
      'docker',
      'run',
      '--detach',
      '--rm',
      '--name',
      container,
      '--publish',
      '127.0.0.1::5432',
      '--env',
      'POSTGRES_USER=java_backward_compatibility',
      '--env',
      'POSTGRES_PASSWORD=compatibility-password',
      '--env',
      'POSTGRES_DB=java_backward_compatibility',
      '--health-cmd',
      'pg_isready -h 127.0.0.1 -U java_backward_compatibility -d java_backward_compatibility',
      '--health-interval',
      '1s',
      '--health-timeout',
      '3s',
      '--health-retries',
      '30',
      'postgres:14.24-trixie',
    ],
    { capture: true },
  );
  started = true;
  const deadline = Date.now() + 30_000;
  while (
    (await run(['docker', 'inspect', '--format', '{{.State.Health.Status}}', container], {
      capture: true,
    })) !== 'healthy\n'
  ) {
    if (Date.now() >= deadline) throw new Error('Parity PostgreSQL did not become healthy');
    await Bun.sleep(250);
  }
  const address = (await run(['docker', 'port', container, '5432/tcp'], { capture: true })).trim();
  const port = Number(address.split(':').at(-1));
  if (!Number.isInteger(port) || port <= 0)
    throw new Error('Docker did not publish the PostgreSQL port');
  const config = {
    host: '127.0.0.1',
    port,
    database: 'java_backward_compatibility',
    user: 'java_backward_compatibility',
    password: 'compatibility-password',
    connectionTimeoutMillis: 5000,
  };
  pool = new Pool(config);
  await pool.query(`CREATE SCHEMA ${schema}`);
  await pool.end();
  pool = new Pool({ ...config, options: `-c search_path=${schema},pg_catalog` });
  await seedFixtures(pool);
  const output = join(directory, 'java.json');
  const buildEnv: NodeJS.ProcessEnv = {};
  for (const name of [
    'PATH',
    'HOME',
    'JAVA_HOME',
    'DPM_HOME',
    'DPM_SDK_VERSION',
    'GRADLE_USER_HOME',
    'LANG',
    'TMPDIR',
    'HTTP_PROXY',
    'HTTPS_PROXY',
    'NO_PROXY',
  ]) {
    if (process.env[name] !== undefined) buildEnv[name] = process.env[name];
  }
  await run(['./gradlew', '--console=plain', ':backend:runPqsBackwardCompatibility'], {
    cwd: quickstart,
    timeoutMs: 300_000,
    env: {
      ...buildEnv,
      POSTGRES_HOST: config.host,
      POSTGRES_PORT: String(config.port),
      POSTGRES_DATABASE: config.database,
      POSTGRES_USERNAME: config.user,
      POSTGRES_PASSWORD: config.password,
      PQS_BACKWARD_COMPATIBILITY_SCHEMA: schema,
      PQS_BACKWARD_COMPATIBILITY_OUTPUT: output,
    },
  });
  java = JSON.parse(await readFile(output, 'utf8')) as Snapshot;
  const lookups = {
    install: await findActiveById(pool, AppInstall, 'install-active'),
    request: await findActiveById(pool, AppInstallRequest, 'request-active'),
    license: await findActiveById(pool, License, 'license-common'),
    renewal: await findActiveById(pool, LicenseRenewalRequest, 'renewal-common'),
    allocationRequest: await findActiveById(pool, AllocationRequest, 'renewal-common'),
    missing: await findActiveById(pool, License, 'missing'),
    archived: await findActiveById(pool, License, 'license-archived'),
    wrongTemplate: await findActiveById(pool, License, 'request-active'),
    blank: await findActiveById(pool, License, ''),
  };
  typescript = {
    installs: await listActive(pool, AppInstall),
    requests: await listActive(pool, AppInstallRequest),
    lookups,
    licenses: Object.fromEntries(
      await Promise.all(
        parties.map(async (party) => [party, await findActiveLicenses(pool, party)]),
      ),
    ),
  };
}, 360_000);

afterAll(async () => {
  try {
    await pool?.end();
  } finally {
    try {
      if (started)
        await run(['docker', 'rm', '--force', '--volumes', container], {
          timeoutMs: 30_000,
          capture: true,
        });
    } finally {
      if (directory) await rm(directory, { recursive: true, force: true });
    }
  }
}, 40_000);

// Normalize Java's value encodings while retaining numeric and microsecond precision.
function payloadValue(value: unknown, key = ''): unknown {
  if (key === 'meta') return value;
  if (Array.isArray(value)) return value.map((item) => payloadValue(item));
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([name, item]) => [name, payloadValue(item, name)]),
    );
  if (typeof value !== 'string') return value;
  if (
    ['expiresAt', 'requestedAt', 'prepareUntil', 'settleBefore', 'allocateBefore'].includes(key)
  ) {
    const subMillis = (value.match(/\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/)?.[1] ?? '')
      .padEnd(6, '0')
      .slice(3, 6);
    return (BigInt(Date.parse(value)) * 1000n + BigInt(subMillis)).toString();
  }
  if (key === 'amount' || key === 'licenseFeeAmount')
    return value.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  return value;
}

function contracts(values: WireContract[]) {
  return values
    .map(({ contractId, payload }) => ({ contractId, payload: payloadValue(payload) }))
    .sort((a, b) => a.contractId.localeCompare(b.contractId));
}

function licenses(values: WireLicense[]) {
  return values
    .map(({ license, renewals }) => ({
      license: contracts([license])[0],
      renewals: renewals
        .map(({ renewal, allocationCid }) => ({
          renewal: contracts([renewal])[0],
          allocationCid: allocationCid ?? null,
        }))
        .sort(
          (a, b) =>
            a.renewal.contractId.localeCompare(b.renewal.contractId) ||
            (a.allocationCid ?? '').localeCompare(b.allocationCid ?? ''),
        ),
    }))
    .sort((a, b) => a.license.contractId.localeCompare(b.license.contractId));
}

test('Java and TS list the same active installations and installation requests', () => {
  expect(typescript.installs.map((c) => c.contractId)).toEqual(['install-active']);
  expect(typescript.requests.map((c) => c.contractId)).toEqual(['request-active']);
  expect(contracts(typescript.installs)).toEqual(contracts(java.installs));
  expect(contracts(typescript.requests)).toEqual(contracts(java.requests));
  expect(typescript.installs[0].payload).toHaveProperty('numLicensesCreated', '9007199254740993');
});

test('Java and TS return equivalent typed lookups, including AllocationRequest views', () => {
  expect(Object.keys(java.lookups).sort()).toEqual(Object.keys(typescript.lookups).sort());
  for (const name of ['install', 'request', 'license', 'renewal', 'allocationRequest']) {
    expect(typescript.lookups[name]).toBeDefined();
    expect(payloadValue(typescript.lookups[name])).toEqual(payloadValue(java.lookups[name]));
  }
  expect(typescript.lookups.renewal?.payload).toHaveProperty(
    'licenseFeeAmount',
    '123456789012345678.1234567890',
  );
  expect(typescript.lookups.renewal?.payload).toHaveProperty(
    'requestedAt',
    '2026-11-02T13:00:00.123456+01:00',
  );
  for (const name of ['missing', 'archived', 'wrongTemplate', 'blank']) {
    expect(typescript.lookups[name]).toBeUndefined();
    expect(java.lookups[name]).toBeNull();
  }
});

test.each(['common-provider', 'common-user', 'same-party', 'outsider'])(
  'Java and TS agree on license visibility and grouping for %s',
  (party) => {
    expect(licenses(typescript.licenses[party])).toEqual(licenses(java.licenses[party]));
    if (party === 'outsider') expect(typescript.licenses[party]).toEqual([]);
    else if (party === 'same-party')
      expect(typescript.licenses[party].map((v) => v.license.contractId)).toEqual(['license-self']);
    else {
      expect(typescript.licenses[party].map((v) => v.license.contractId).sort()).toEqual(
        [
          'license-common',
          'license-precision',
          'license-same-key',
          ...(party === 'common-provider' ? ['license-no-renewals'] : []),
        ].sort(),
      );
      if (party === 'common-provider')
        expect(
          typescript.licenses[party].find((v) => v.license.contractId === 'license-no-renewals')
            ?.renewals,
        ).toEqual([]);
      const common = typescript.licenses[party].find(
        (v) => v.license.contractId === 'license-common',
      );
      expect(common?.renewals.map((v) => [v.renewal.contractId, v.allocationCid])).toEqual([
        ['renewal-common', 'allocation-common-1'],
        ['renewal-common', 'allocation-common-2'],
        ['renewal-duplicate-1', 'allocation-duplicate'],
        ['renewal-duplicate-2', 'allocation-duplicate'],
        ['renewal-no-allocation', undefined],
      ]);
      expect(
        typescript.licenses[party].some((v) => v.license.contractId === 'license-archived'),
      ).toBe(false);
    }
  },
);

test('TS intentionally excludes the other provider renewal that Java associates by user and license number', () => {
  expect(java.licenses['provider-a'][0].renewals.map((v) => v.renewal.contractId)).toEqual([
    'renewal-provider-b',
  ]);
  expect(typescript.licenses['provider-a'][0].renewals).toEqual([]);
  expect(licenses(typescript.licenses['provider-b'])).toEqual(
    licenses(java.licenses['provider-b']),
  );
  expect(typescript.licenses['provider-b'][0].renewals.map((v) => v.renewal.contractId)).toEqual([
    'renewal-provider-b',
  ]);
});

test('TS intentionally rejects incompatible allocations that pass the Java reference and sender checks', () => {
  expect(typescript.licenses['strict-provider'][0].renewals.map((v) => v.allocationCid)).toEqual([
    'allocation-valid',
  ]);
  const javaIds = java.licenses['strict-provider'][0].renewals.map((v) => v.allocationCid).sort();
  expect(javaIds).toEqual(
    [
      'allocation-valid',
      ...incompatibleAllocations
        .filter(([name]) => name !== 'reference-id' && name !== 'sender')
        .map(([name]) => `allocation-wrong-${name}`),
    ].sort(),
  );
});

test('Java and TS reject an invalid renewal payload instead of returning a missing contract', async () => {
  expect(java.invalidRenewalRejected).toBe(true);
  await expect(findActiveById(pool, LicenseRenewalRequest, 'renewal-invalid')).rejects.toThrow(
    'Failed to decode PQS contract renewal-invalid',
  );
});

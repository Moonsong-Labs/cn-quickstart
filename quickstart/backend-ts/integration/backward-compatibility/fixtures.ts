import type { Pool } from 'pg';
import {
  AllocationRequest,
  type AllocationRequestView,
} from '../../build/generated-daml-bindings/splice-api-token-allocation-request-v1-1.0.0/lib/Splice/Api/Token/AllocationRequestV1/module';
import {
  Allocation,
  type AllocationView,
} from '../../build/generated-daml-bindings/splice-api-token-allocation-v1-1.0.0/lib/Splice/Api/Token/AllocationV1/module';
import {
  AppInstall,
  AppInstallRequest,
  License,
  LicenseRenewalRequest,
} from '../../src/daml/licensing';

// Each allocation changes one field validated by Daml renewal completion.
export const incompatibleAllocations: [string, (view: AllocationView) => void][] = [
  [
    'executor',
    (v) => {
      v.allocation.settlement.executor = 'other-executor';
    },
  ],
  [
    'reference-id',
    (v) => {
      v.allocation.settlement.settlementRef.id = 'other-request';
    },
  ],
  [
    'reference-cid',
    (v) => {
      v.allocation.settlement.settlementRef.cid = 'other-cid' as NonNullable<
        typeof v.allocation.settlement.settlementRef.cid
      >;
    },
  ],
  [
    'requested-at',
    (v) => {
      v.allocation.settlement.requestedAt = '2026-11-02T11:00:00Z';
    },
  ],
  [
    'allocate-before',
    (v) => {
      v.allocation.settlement.allocateBefore = '2026-11-02T15:00:00Z';
    },
  ],
  [
    'settle-before',
    (v) => {
      v.allocation.settlement.settleBefore = '2026-11-02T16:00:00Z';
    },
  ],
  [
    'settlement-meta',
    (v) => {
      v.allocation.settlement.meta = { values: {} };
    },
  ],
  [
    'leg-id',
    (v) => {
      v.allocation.transferLegId = 'other-leg';
    },
  ],
  [
    'sender',
    (v) => {
      v.allocation.transferLeg.sender = 'other-sender';
    },
  ],
  [
    'receiver',
    (v) => {
      v.allocation.transferLeg.receiver = 'other-receiver';
    },
  ],
  [
    'amount',
    (v) => {
      v.allocation.transferLeg.amount = '1.0';
    },
  ],
  [
    'instrument',
    (v) => {
      v.allocation.transferLeg.instrumentId.id = 'OTHER';
    },
  ],
  [
    'leg-meta',
    (v) => {
      v.allocation.transferLeg.meta = { values: {} };
    },
  ],
];

export async function seedFixtures(pool: Pool) {
  async function seed(templateId: string, id: string, payload: object, archived = false) {
    await pool.query('INSERT INTO contracts VALUES ($1, $2, $3, $4)', [
      templateId.replace(/^#/, ''),
      id,
      payload,
      archived ? 1 : null,
    ]);
  }

  async function seedLicense(
    id: string,
    provider: string,
    user: string,
    licenseNum: string,
    archived = false,
  ) {
    await seed(
      License.templateId,
      id,
      {
        provider,
        user,
        licenseNum,
        expiresAt: '2026-11-02T12:00:00.123456Z',
        params: {
          meta: {
            values: { description: id, amount: '000.0100', requestedAt: 'literal metadata' },
          },
        },
      } satisfies License,
      archived,
    );
  }

  async function seedRenewal(
    id: string,
    requestId: string,
    provider: string,
    user: string,
    licenseNum: string,
    archived = false,
  ): Promise<AllocationRequestView> {
    const payload = {
      provider,
      user,
      licenseNum,
      requestId,
      licenseFeeAmount: '123456789012345678.1234567890',
      licenseFeeInstrumentId: { admin: 'instrument-admin', id: 'TOKEN' },
      licenseExtensionDuration: { microseconds: '86400000000' },
      requestedAt: '2026-11-02T13:00:00.123456+01:00',
      prepareUntil: '2026-11-02T13:00:00.123456Z',
      settleBefore: '2026-11-02T14:00:00.123456Z',
      description: 'Parity renewal',
    } satisfies LicenseRenewalRequest;
    const meta = {
      values: {
        'splice.lfdecentralizedtrust.org/reason': payload.description,
        'cn-quickstart.example.org/licenseNum': licenseNum,
      },
    };
    const view: AllocationRequestView = {
      settlement: {
        executor: provider,
        requestedAt: payload.requestedAt,
        allocateBefore: payload.prepareUntil,
        settleBefore: payload.settleBefore,
        settlementRef: { id: requestId, cid: null },
        meta,
      },
      transferLegs: {
        licenseFeePayment: {
          sender: user,
          receiver: provider,
          amount: payload.licenseFeeAmount,
          instrumentId: payload.licenseFeeInstrumentId,
          meta,
        },
      },
      meta,
    };
    await seed(LicenseRenewalRequest.templateId, id, payload, archived);
    await seed(AllocationRequest.templateId, id, view, archived);
    return view;
  }

  async function seedAllocation(
    id: string,
    request: AllocationRequestView,
    mutate?: (view: AllocationView) => void,
    archived = false,
  ) {
    const view: AllocationView = structuredClone({
      allocation: {
        settlement: request.settlement,
        transferLegId: 'licenseFeePayment',
        transferLeg: request.transferLegs.licenseFeePayment,
      },
      holdingCids: [],
      meta: request.meta,
    });
    mutate?.(view);
    await seed(Allocation.templateId, id, view, archived);
  }

  await pool.query(`CREATE TABLE contracts (
    template_fqn text NOT NULL, contract_id text NOT NULL, payload jsonb NOT NULL,
    archived_at_ix bigint, PRIMARY KEY(template_fqn, contract_id)
  );
  CREATE FUNCTION active(template_name text) RETURNS TABLE(contract_id text, payload jsonb)
  LANGUAGE sql STABLE AS $$ SELECT c.contract_id, c.payload FROM contracts c
    WHERE (c.template_fqn = template_name
      OR split_part(c.template_fqn, ':', 2) || ':' || split_part(c.template_fqn, ':', 3) = template_name)
      AND c.archived_at_ix IS NULL $$;`);
  const install: AppInstall = {
    provider: 'common-provider',
    user: 'common-user',
    numLicensesCreated: '9007199254740993',
    meta: { values: { description: 'Installation metadata' } },
  };
  await seed(AppInstall.templateId, 'install-active', install);
  await seed(AppInstall.templateId, 'install-archived', install, true);
  await seed(AppInstallRequest.templateId, 'request-active', {
    provider: install.provider,
    user: install.user,
    meta: install.meta,
  } satisfies AppInstallRequest);
  await seed(
    AppInstallRequest.templateId,
    'request-archived',
    { provider: install.provider, user: install.user, meta: install.meta },
    true,
  );
  await seedLicense('license-common', 'common-provider', 'common-user', '7');
  await seedLicense('license-same-key', 'common-provider', 'common-user', '7');
  await seedLicense('license-no-renewals', 'common-provider', 'other-user', '8');
  await seedLicense('license-precision', 'common-provider', 'common-user', '9007199254740993');
  await seedLicense('license-archived', 'common-provider', 'common-user', '7', true);
  await seedLicense('license-self', 'same-party', 'same-party', '1');
  const common = await seedRenewal(
    'renewal-common',
    'request-common',
    'common-provider',
    'common-user',
    '7',
  );
  await seedAllocation('allocation-common-1', common);
  await seedAllocation('allocation-common-2', common);
  await seedAllocation('allocation-archived', common, undefined, true);
  const duplicate = await seedRenewal(
    'renewal-duplicate-1',
    'request-duplicate',
    'common-provider',
    'common-user',
    '7',
  );
  await seedRenewal(
    'renewal-duplicate-2',
    'request-duplicate',
    'common-provider',
    'common-user',
    '7',
  );
  await seedAllocation('allocation-duplicate', duplicate);
  await seedRenewal(
    'renewal-no-allocation',
    'request-unpaid',
    'common-provider',
    'common-user',
    '7',
  );
  await seedRenewal(
    'renewal-precision',
    'request-precision',
    'common-provider',
    'common-user',
    '9007199254740993',
  );
  await seedRenewal(
    'renewal-archived',
    'request-archived',
    'common-provider',
    'common-user',
    '7',
    true,
  );
  await seedRenewal('renewal-orphan', 'request-orphan', 'common-provider', 'orphan-user', '99');
  await seed(LicenseRenewalRequest.templateId, 'renewal-invalid', { provider: 42 });

  await seedLicense('license-provider-a', 'provider-a', 'cross-user', '1');
  await seedLicense('license-provider-b', 'provider-b', 'cross-user', '1');
  await seedRenewal('renewal-provider-b', 'request-provider-b', 'provider-b', 'cross-user', '1');
  await seedLicense('license-strict', 'strict-provider', 'strict-user', '1');
  const strict = await seedRenewal(
    'renewal-strict',
    'request-strict',
    'strict-provider',
    'strict-user',
    '1',
  );
  await seedAllocation('allocation-valid', strict);
  for (const [name, mutate] of incompatibleAllocations)
    await seedAllocation(`allocation-wrong-${name}`, strict, mutate);
}

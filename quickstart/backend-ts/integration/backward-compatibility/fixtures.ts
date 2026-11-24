import { emptyMap } from '@daml/types';
import type { Pool } from 'pg';
import {
  AllocationRequest,
  type AllocationRequestAction,
  AllocationRequestView,
} from '../../build/generated-daml-bindings/splice-api-token-allocation-request-v2-1.0.0/lib/Splice/Api/Token/AllocationRequestV2/module';
import {
  Allocation,
  type AllocationAction,
  AllocationView,
} from '../../build/generated-daml-bindings/splice-api-token-allocation-v2-1.0.0/lib/Splice/Api/Token/AllocationV2/module';
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
      v.settlement.executors[0] = 'other-executor';
    },
  ],
  [
    'reference-id',
    (v) => {
      v.settlement.id = 'other-request';
    },
  ],
  [
    'reference-cid',
    (v) => {
      v.settlement.cid = 'other-cid' as typeof v.settlement.cid;
    },
  ],
  [
    'settlement-meta',
    (v) => {
      v.settlement.meta = { values: {} };
    },
  ],
  [
    'settlement-deadline',
    (v) => {
      v.allocation.settlementDeadline = '2026-11-02T16:00:00Z';
    },
  ],
  [
    'leg-id',
    (v) => {
      v.allocation.transferLegSides[0].transferLegId = 'other-leg';
    },
  ],
  [
    'sender',
    (v) => {
      v.allocation.authorizer.owner = 'other-sender';
    },
  ],
  [
    'receiver',
    (v) => {
      v.allocation.transferLegSides[0].otherside.owner = 'other-receiver';
    },
  ],
  [
    'amount',
    (v) => {
      v.allocation.transferLegSides[0].amount = '1.0';
    },
  ],
  [
    'instrument',
    (v) => {
      v.allocation.transferLegSides[0].instrumentId = 'OTHER';
    },
  ],
  [
    'side',
    (v) => {
      v.allocation.transferLegSides[0].side = 'ReceiverSide';
    },
  ],
  [
    'authorizer-id',
    (v) => {
      v.allocation.authorizer.id = 'unexpected-account';
    },
  ],
  [
    'authorizer-provider',
    (v) => {
      v.allocation.authorizer.provider = 'unexpected-provider';
    },
  ],
  [
    'leg-meta',
    (v) => {
      v.allocation.transferLegSides[0].meta = { values: {} };
    },
  ],
  [
    'admin',
    (v) => {
      v.allocation.admin = 'other-admin';
    },
  ],
  [
    'committed',
    (v) => {
      v.allocation.committed = true;
    },
  ],
  [
    'allocation-meta',
    (v) => {
      v.allocation.meta = { values: { unexpected: 'value' } };
    },
  ],
];

export async function seedFixtures(pool: Pool) {
  async function seed(
    templateId: string,
    id: string,
    payload: object,
    archived = false,
    signatories: string[] = [],
  ) {
    await pool.query('INSERT INTO contracts VALUES ($1, $2, $3, $4, $5)', [
      templateId.replace(/^#/, ''),
      id,
      payload,
      archived ? 1 : null,
      signatories,
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
        uuid: `00000000-0000-4000-8000-${BigInt(licenseNum).toString(16).slice(-12).padStart(12, '0')}`,
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
      uuid: `00000000-0000-4000-8000-${BigInt(licenseNum).toString(16).slice(-12).padStart(12, '0')}`,
      licenseNum,
      requestId,
      licenseFeeAmount: '123456789012345678.1234567890',
      licenseFeeInstrumentId: { admin: 'instrument-admin', id: 'TOKEN' },
      licenseExtensionDuration: { microseconds: '86400000000' },
      requestedAt: '2026-11-02T13:00:00.123456+01:00',
      settleBefore: '2026-11-02T14:00:00.123456Z',
      description: 'Parity renewal',
      settlementReference:
        `settlement-reference-${id}` as LicenseRenewalRequest['settlementReference'],
      originalRequestCid: null,
    } satisfies LicenseRenewalRequest;
    const meta = {
      values: {
        'splice.lfdecentralizedtrust.org/reason': payload.description,
        'cn-quickstart.example.org/licenseNum': licenseNum,
        'cn-quickstart.example.org/uuid': payload.uuid,
      },
    };
    const view: AllocationRequestView = {
      originalRequestCid: null,
      settlement: {
        executors: [provider],
        id: requestId,
        cid: payload.settlementReference as unknown as AllocationRequest['settlement']['cid'],
        meta,
      },
      allocations: [
        {
          admin: payload.licenseFeeInstrumentId.admin,
          authorizer: { owner: user, provider: null, id: '' },
          transferLegSides: [
            {
              transferLegId: 'licenseFeePayment',
              side: 'SenderSide',
              otherside: { owner: provider, provider: null, id: '' },
              amount: payload.licenseFeeAmount,
              instrumentId: payload.licenseFeeInstrumentId.id,
              meta,
            },
          ],
          settlementDeadline: payload.settleBefore,
          nextIterationFunding: null,
          committed: false,
          meta: { values: {} },
        },
      ],
      requestedAt: payload.requestedAt,
      settleAt: null,
      availableActions: emptyMap<AllocationRequestAction, string[][]>(),
      meta,
    };
    await seed(LicenseRenewalRequest.templateId, id, payload, archived);
    await seed(
      AllocationRequest.templateId,
      id,
      AllocationRequestView.encode(view) as object,
      archived,
    );
    return view;
  }

  async function seedAllocation(
    id: string,
    request: AllocationRequestView,
    mutate?: (view: AllocationView) => void,
    archived = false,
    signatories?: string[],
  ) {
    const view: AllocationView = {
      originalAllocationCid: null,
      settlement: structuredClone(request.settlement),
      allocation: structuredClone(request.allocations[0]),
      holdingCids: [],
      createdAt: request.requestedAt,
      numIterations: '0',
      expiresAt: null,
      availableActions: emptyMap<AllocationAction, string[][]>(),
      meta: { values: {} },
    };
    mutate?.(view);
    await seed(
      Allocation.templateId,
      id,
      AllocationView.encode(view) as object,
      archived,
      signatories ?? [view.allocation.admin, view.allocation.authorizer.owner ?? ''],
    );
  }

  await pool.query(`CREATE TABLE contracts (
    template_fqn text NOT NULL, contract_id text NOT NULL, payload jsonb NOT NULL,
    archived_at_ix bigint, signatories text[] NOT NULL DEFAULT '{}',
    PRIMARY KEY(template_fqn, contract_id)
  );
  CREATE FUNCTION active(template_name text)
  RETURNS TABLE(contract_id text, payload jsonb, signatories text[])
  LANGUAGE sql STABLE AS $$ SELECT c.contract_id, c.payload, c.signatories FROM contracts c
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
  const duplicate1 = await seedRenewal(
    'renewal-duplicate-1',
    'request-duplicate',
    'common-provider',
    'common-user',
    '7',
  );
  const duplicate2 = await seedRenewal(
    'renewal-duplicate-2',
    'request-duplicate',
    'common-provider',
    'common-user',
    '7',
  );
  await seedAllocation('allocation-duplicate-1', duplicate1);
  await seedAllocation('allocation-duplicate-2', duplicate2);
  await seedAllocation('allocation-duplicate-wrong-reference', duplicate1, (allocation) => {
    allocation.settlement.cid =
      'settlement-reference-unrelated' as unknown as typeof allocation.settlement.cid;
  });
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
  await seedAllocation('allocation-wrong-admin-signatory', strict, undefined, false, [
    'strict-user',
  ]);
}

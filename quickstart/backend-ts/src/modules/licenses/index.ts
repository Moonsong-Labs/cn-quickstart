import { ContractId } from '@daml/types';
import type { Pool } from 'pg';
import { AllocationRequest } from '../../../build/generated-daml-bindings/splice-api-token-allocation-request-v2-1.0.0/lib/Splice/Api/Token/AllocationRequestV2/module';
import { Allocation } from '../../../build/generated-daml-bindings/splice-api-token-allocation-v2-1.0.0/lib/Splice/Api/Token/AllocationV2/module';
import { License, LicenseRenewalRequest } from '../../daml/licensing';
import { type Contract, decodeContract } from '../../integrations/pqs/contracts';

export interface LicenseRenewalRequestWithAllocationCid {
  renewal: Contract<LicenseRenewalRequest>;
  allocationCid: ContractId<Allocation> | undefined;
}

export interface LicenseWithRenewalRequests {
  license: Contract<License>;
  renewals: LicenseRenewalRequestWithAllocationCid[];
}

interface LicenseRow {
  license_contract_id: string;
  license_payload: unknown;
  renewal_contract_id: string | null;
  renewal_payload: unknown;
  allocation_contract_id: string | null;
}

export async function findActiveLicenses(
  pool: Pool,
  party: string,
): Promise<LicenseWithRenewalRequests[]> {
  // Compare the V2 interface views that LicenseRenewalRequest_CompleteRenewal
  // validates, including the stable settlement reference and full allocation spec.
  const { rows } = await pool
    .query<LicenseRow>(
      `
    SELECT license.contract_id AS license_contract_id,
           license.payload AS license_payload,
           renewal.contract_id AS renewal_contract_id,
           renewal.payload AS renewal_payload,
           allocation.contract_id AS allocation_contract_id
    FROM active($1) license
    LEFT JOIN active($2) renewal ON
      license.payload->>'provider' = renewal.payload->>'provider'
      AND license.payload->>'user' = renewal.payload->>'user'
      AND license.payload->>'uuid' = renewal.payload->>'uuid'
      AND license.payload->>'licenseNum' = renewal.payload->>'licenseNum'
    LEFT JOIN active($3) request_view ON request_view.contract_id = renewal.contract_id
    LEFT JOIN active($4) allocation ON
      allocation.payload->'settlement' = request_view.payload->'settlement'
      AND (request_view.payload->'allocations'->0->>'admin') = ANY(allocation.signatories)
      AND (allocation.payload->'allocation' #- '{transferLegSides,0,amount}' #- '{settlementDeadline}')
        = (request_view.payload->'allocations'->0 #- '{transferLegSides,0,amount}' #- '{settlementDeadline}')
      AND (allocation.payload->'allocation'->'transferLegSides'->0->>'amount')::numeric
        = (request_view.payload->'allocations'->0->'transferLegSides'->0->>'amount')::numeric
      AND (allocation.payload->'allocation'->>'settlementDeadline')::timestamptz
        = (request_view.payload->'allocations'->0->>'settlementDeadline')::timestamptz
    WHERE license.payload->>'user' = $5 OR license.payload->>'provider' = $5
    ORDER BY license.contract_id, renewal.contract_id, allocation.contract_id
  `,
      [
        License.templateId.replace(/^#/, ''),
        LicenseRenewalRequest.templateId.replace(/^#/, ''),
        AllocationRequest.templateId.replace(/^#/, ''),
        Allocation.templateId.replace(/^#/, ''),
        party,
      ],
    )
    .catch((cause: unknown) => {
      throw new Error('Failed to list active licenses', { cause });
    });

  const licenses = new Map<string, LicenseWithRenewalRequests>();
  for (const row of rows) {
    let entry = licenses.get(row.license_contract_id);
    if (!entry) {
      entry = {
        license: decodeContract(License, {
          contract_id: row.license_contract_id,
          payload: row.license_payload,
        }),
        renewals: [],
      };
      licenses.set(row.license_contract_id, entry);
    }
    if (row.renewal_contract_id !== null) {
      // Keep every matching allocation so the caller can select a funded one.
      entry.renewals.push({
        renewal: decodeContract(LicenseRenewalRequest, {
          contract_id: row.renewal_contract_id,
          payload: row.renewal_payload,
        }),
        allocationCid:
          row.allocation_contract_id === null
            ? undefined
            : ContractId(Allocation).decoder.runWithException(row.allocation_contract_id),
      });
    }
  }
  return [...licenses.values()];
}

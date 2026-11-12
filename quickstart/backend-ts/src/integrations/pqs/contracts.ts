import { ContractId, type Template, type TemplateOrInterface } from '@daml/types';
import type { Pool } from 'pg';

export interface Contract<T> {
  contractId: ContractId<T>;
  payload: T;
}

interface ContractRow {
  contract_id: string;
  payload: unknown;
}

export function decodeContract<T extends object, K>(
  template: TemplateOrInterface<T, K>,
  row: ContractRow,
): Contract<T> {
  try {
    return {
      contractId: ContractId(template).decoder.runWithException(row.contract_id),
      payload: template.decoder.runWithException(row.payload),
    };
  } catch (cause) {
    throw new Error(`Failed to decode PQS contract ${row.contract_id} for ${template.templateId}`, {
      cause,
    });
  }
}

export async function listActive<T extends object, K>(
  pool: Pool,
  template: TemplateOrInterface<T, K>,
): Promise<Contract<T>[]> {
  // PQS uses package names without the Ledger API's leading '#'.
  const name = template.templateId.replace(/^#/, '');
  const { rows } = await pool
    .query<ContractRow>('SELECT contract_id, payload FROM active($1)', [name])
    .catch((cause: unknown) => {
      throw new Error(`Failed to list active PQS contracts for ${template.templateId}`, { cause });
    });
  return rows.map((row) => decodeContract(template, row));
}

export async function listActiveByKey<T extends object, K>(
  pool: Pool,
  template: Template<T, K>,
  key: NoInfer<K>,
): Promise<Contract<T>[]> {
  let encodedKey: string | undefined;
  try {
    encodedKey = JSON.stringify(template.keyEncode(template.keyDecoder.runWithException(key)));
  } catch (cause) {
    throw new Error(`Failed to encode PQS contract key for ${template.templateId}`, { cause });
  }
  const name = template.templateId.replace(/^#/, '');
  const { rows } = await pool
    .query<ContractRow>(
      'SELECT contract_id, payload FROM active($1) WHERE contract_key = $2::jsonb',
      [name, encodedKey],
    )
    .catch((cause: unknown) => {
      throw new Error(`Failed to list active PQS contracts by key for ${template.templateId}`, {
        cause,
      });
    });
  return rows.map((row) => decodeContract(template, row));
}

export async function findActiveById<T extends object, K>(
  pool: Pool,
  template: TemplateOrInterface<T, K>,
  contractId: string,
): Promise<Contract<T> | undefined> {
  const name = template.templateId.replace(/^#/, '');
  const { rows } = await pool
    .query<ContractRow>('SELECT contract_id, payload FROM active($1) WHERE contract_id = $2', [
      name,
      contractId,
    ])
    .catch((cause: unknown) => {
      throw new Error(`Failed to find active PQS contract for ${template.templateId}`, { cause });
    });
  if (rows.length > 1)
    throw new Error(`Multiple active PQS contracts returned for ${template.templateId}`);
  return rows[0] === undefined ? undefined : decodeContract(template, rows[0]);
}

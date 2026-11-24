import type { Pool } from 'pg';
import { LEDGER_REQUEST_TIMEOUT_MS } from '../../config/ledger';
import {
  AppInstall,
  type AppInstall_Cancel,
  AppInstallRequest,
  type AppInstallRequest_Accept,
  type AppInstallRequest_Reject,
} from '../../daml/licensing';
import type { LedgerConnection } from '../../integrations/ledger/connect';
import { LedgerApiError } from '../../integrations/ledger/error';
import { exerciseChoice } from '../../integrations/ledger/exercise';
import { findActiveById, listActive } from '../../integrations/pqs/contracts';

/** Returns active installation requests visible to the authenticated party in API format. */
export async function listAppInstallRequests(pqs: Pool, party: string) {
  /** Decoded active requests from the same PQS query used for other templates. */
  const contracts = await listActive(pqs, AppInstallRequest);
  return contracts
    .filter(({ payload }) => payload.user === party || payload.provider === party)
    .map(({ contractId, payload }) => ({
      contractId,
      provider: payload.provider,
      user: payload.user,
      meta: { data: payload.meta.values },
    }));
}

/** Returns active installations and their ledger counters for the authenticated party. */
export async function listAppInstalls(pqs: Pool, party: string) {
  /** Decoded installations retain the ledger's 64-bit counters as strings. */
  const contracts = await listActive(pqs, AppInstall);
  return contracts
    .filter(({ payload }) => payload.user === party || payload.provider === party)
    .map(({ contractId, payload }) => {
      /** The HTTP count is a JSON number and must remain exact in the frontend. */
      const numLicensesCreated = Number(payload.numLicensesCreated);
      if (!Number.isSafeInteger(numLicensesCreated)) {
        throw new Error('Installation license count exceeds the safe integer range');
      }
      return {
        contractId,
        provider: payload.provider,
        user: payload.user,
        meta: { data: payload.meta.values },
        numLicensesCreated,
        // The Java response leaves this field unset because the installation has no license number.
        licenseNum: null,
      };
    });
}

/** Finds an active request only when the configured AppProvider controls its choices. */
async function findProviderInstallRequest(pqs: Pool, providerParty: string, contractId: string) {
  /** Looks up the request by its typed template and contract ID. */
  const request = await findActiveById(pqs, AppInstallRequest, contractId);
  return request?.payload.provider === providerParty ? request : undefined;
}

/** Accepts an active request controlled by the configured provider and returns the created installation. */
export async function acceptAppInstallRequest(
  pqs: Pool,
  ledger: LedgerConnection,
  providerParty: string,
  contractId: string,
  commandId: string,
  argument: AppInstallRequest_Accept,
) {
  /** Lookup supplies the request parties and excludes already consumed requests. */
  const request = await findProviderInstallRequest(pqs, providerParty, contractId);
  if (!request) return undefined;

  /** The consuming choice returns the new contract ID without waiting for PQS ingestion. */
  const installId = await exerciseChoice(ledger, {
    contractId: request.contractId,
    choice: AppInstallRequest.AppInstallRequest_Accept,
    argument,
    commandId,
    actAs: [providerParty],
    readAs: [providerParty],
  });
  return {
    contractId: installId,
    provider: request.payload.provider,
    user: request.payload.user,
    meta: { data: argument.installMeta.values },
    numLicensesCreated: 0,
    licenseNum: null,
  };
}

/** Consumes an active request controlled by the AppProvider and waits for ledger confirmation. */
export async function rejectAppInstallRequest(
  pqs: Pool,
  ledger: LedgerConnection,
  providerParty: string,
  contractId: string,
  commandId: string,
  argument: AppInstallRequest_Reject,
) {
  /** Uses the same provider scope and active request check as acceptance. */
  const request = await findProviderInstallRequest(pqs, providerParty, contractId);
  if (!request) return false;

  await exerciseChoice(ledger, {
    contractId: request.contractId,
    choice: AppInstallRequest.AppInstallRequest_Reject,
    argument,
    commandId,
    actAs: [providerParty],
    readAs: [providerParty],
  });
  return true;
}

/** Cancels a visible installation when the AppProvider can act as a signatory. */
export async function cancelAppInstall(
  pqs: Pool,
  ledger: LedgerConnection,
  providerParty: string,
  {
    contractId,
    commandId,
    party,
    meta,
  }: {
    contractId: string;
    commandId: string;
    party: string;
    meta: AppInstall_Cancel['meta'];
  },
) {
  /** Loads the active installation and its signatories from PQS. */
  const install = await findActiveById(pqs, AppInstall, contractId);
  if (!install) return 'missing';

  /** The authenticated party must be a signatory, as must the provider acting on the ledger. */
  const { user, provider } = install.payload;
  if (
    (party !== user && party !== provider) ||
    (providerParty !== user && providerParty !== provider)
  )
    return 'forbidden';

  await exerciseChoice(ledger, {
    contractId: install.contractId,
    choice: AppInstall.AppInstall_Cancel,
    argument: { actor: providerParty, meta },
    commandId,
    actAs: [providerParty],
    readAs: [providerParty],
  });
  return 'canceled';
}

/**
 * Validates commandId, the generated payload, and nonblank provider and user identifiers.
 * Submits with actAs containing only the request user and resolves with Ledger confirmation.
 * Validation throws synchronously; Ledger failures reject with LedgerApiError and commandId.
 * HTTP timeout cancels the request; the submitted command may still commit.
 */
export function createAppInstallRequest(
  connection: LedgerConnection,
  request: AppInstallRequest,
  commandId: string,
) {
  if (typeof commandId !== 'string' || !commandId.trim()) {
    throw new Error('commandId must not be blank');
  }

  const payload = AppInstallRequest.decoder.runWithException(request);
  if (!payload.provider.trim()) throw new Error('provider must not be blank');
  if (!payload.user.trim()) throw new Error('user must not be blank');

  return connection.client
    .post(
      '/v2/commands/submit-and-wait',
      {
        userId: connection.ledgerUserId,
        commandId,
        actAs: [payload.user],
        commands: [
          {
            CreateCommand: {
              templateId: AppInstallRequest.templateId,
              createArguments: AppInstallRequest.encode(payload),
            },
          },
        ],
      },
      undefined,
      { signal: AbortSignal.timeout(LEDGER_REQUEST_TIMEOUT_MS) },
    )
    .catch((cause: unknown) => {
      throw new LedgerApiError('Ledger API command failed', { cause, commandId });
    });
}

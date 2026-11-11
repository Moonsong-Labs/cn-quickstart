import type { LedgerClient } from '@canton-network/core-ledger-client';
import { LEDGER_REQUEST_TIMEOUT_MS } from '../../config/ledger';
import { AppInstallRequest } from '../../daml/licensing';
import { LedgerApiError } from '../../integrations/ledger/error';

/**
 * Validates commandId, the generated payload, and nonblank provider and user identifiers.
 * Submits with actAs containing only the request user and resolves with Ledger confirmation.
 * Validation throws synchronously; Ledger failures reject with LedgerApiError and commandId.
 * HTTP timeout cancels the request; the submitted command may still commit.
 */
export function createAppInstallRequest(
  connection: { client: LedgerClient; ledgerUserId: string },
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

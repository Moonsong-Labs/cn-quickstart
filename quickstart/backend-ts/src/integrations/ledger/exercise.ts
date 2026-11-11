import type { LedgerClient } from '@canton-network/core-ledger-client';
import type { LedgerCommonSchemas } from '@canton-network/core-ledger-client-types';
import type { Choice, ContractId } from '@daml/types';
import { LEDGER_REQUEST_TIMEOUT_MS } from '../../config/ledger';
import { LedgerApiError } from './error';

/** Couples a generated choice and typed arguments with its contract, parties, and disclosures. */
interface ExerciseOptions<T extends object, C, R, K> {
  contractId: ContractId<T>;
  choice: Choice<T, C, R, K>;
  argument: C;
  commandId: string;
  actAs: string[];
  readAs?: string[];
  disclosedContracts?: LedgerCommonSchemas['DisclosedContract'][];
}

/**
 * Validates identifiers, parties, and generated arguments before submitting one exercise
 * with TRANSACTION_SHAPE_LEDGER_EFFECTS. Selects the matching root ExercisedEvent and
 * decodes its result with the generated binding. LedgerApiError carries commandId for
 * submission or response failures, plus updateId when the confirmed response supplied it.
 * HTTP timeout cancels the request; the submitted command may still commit.
 */
export async function exerciseChoice<T extends object, C, R, K>(
  connection: { client: LedgerClient; ledgerUserId: string },
  options: ExerciseOptions<T, C, R, K>,
): Promise<R> {
  const {
    contractId,
    choice,
    argument,
    commandId,
    actAs,
    readAs = [],
    disclosedContracts,
  } = options;
  if (typeof contractId !== 'string' || !contractId.trim())
    throw new Error('contractId must not be blank');
  if (typeof commandId !== 'string' || !commandId.trim())
    throw new Error('commandId must not be blank');
  for (const [name, parties] of [
    ['actAs', actAs],
    ['readAs', readAs],
  ] as const) {
    if (
      !Array.isArray(parties) ||
      parties.some((party) => typeof party !== 'string' || !party.trim())
    )
      throw new Error(`${name} must contain nonblank party identifiers`);
  }
  if (actAs.length === 0) throw new Error('actAs must contain at least one party');
  const payload = choice.argumentDecoder.runWithException(argument);
  const response = await connection.client
    .post(
      '/v2/commands/submit-and-wait-for-transaction',
      {
        commands: {
          userId: connection.ledgerUserId,
          commandId,
          actAs,
          readAs,
          ...(disclosedContracts === undefined ? {} : { disclosedContracts }),
          commands: [
            {
              ExerciseCommand: {
                templateId: choice.template().templateId,
                contractId,
                choice: choice.choiceName,
                choiceArgument: choice.argumentEncode(payload),
              },
            },
          ],
        },
        transactionFormat: {
          // ACS_DELTA omits exercise results; LEDGER_EFFECTS includes the exercised events.
          transactionShape: 'TRANSACTION_SHAPE_LEDGER_EFFECTS',
          eventFormat: {
            filtersByParty: Object.fromEntries([...actAs, ...readAs].map((party) => [party, {}])),
            verbose: false,
          },
        },
      },
      undefined,
      { signal: AbortSignal.timeout(LEDGER_REQUEST_TIMEOUT_MS) },
    )
    .catch((cause: unknown) => {
      throw new LedgerApiError('Ledger API command failed', { cause, commandId });
    });

  let updateId: string | undefined;
  try {
    const { transaction } = response;
    updateId = transaction?.updateId;
    let exercised: LedgerCommonSchemas['ExercisedEvent'] | undefined;
    for (const event of transaction.events) {
      if (!('ExercisedEvent' in event)) continue;
      const candidate = event.ExercisedEvent;
      if (candidate.contractId !== contractId || candidate.choice !== choice.choiceName) continue;
      // Descendants have larger node IDs, including recursive exercises of the same choice.
      if (!exercised || candidate.nodeId < exercised.nodeId) exercised = candidate;
    }
    if (!exercised) throw new Error('Ledger transaction did not include the requested exercise');
    return choice.resultDecoder.runWithException(exercised.exerciseResult);
  } catch (cause) {
    // Keep the update ID when available so callers can reconcile a confirmed transaction.
    throw new LedgerApiError('Failed to decode Ledger API transaction', {
      cause,
      commandId,
      updateId,
    });
  }
}

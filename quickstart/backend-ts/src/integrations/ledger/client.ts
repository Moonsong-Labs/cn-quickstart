import { LedgerClient } from '@canton-network/core-ledger-client';
import { LedgerApiError } from './error';

/** Reuses the SDK constructor contract for endpoint, token provider, and optional API version. */
type LedgerClientOptions = ConstructorParameters<typeof LedgerClient>[0];

class BackendLedgerClient extends LedgerClient {
  constructor({ accessTokenProvider, ...options }: LedgerClientOptions) {
    super({ ...options, accessTokenProvider });

    const fetchCommand = async (request: Request) => {
      const headers = new Headers(request.headers);
      const token = await accessTokenProvider.getAccessToken();
      if (token) headers.set('authorization', `Bearer ${token}`);
      // A dropped response on a reused Bun connection can replay a submitted command.
      return fetch(request, { headers, keepalive: false });
    };

    this.post = (path, body, params, requestOptions) => {
      if (
        requestOptions?.fetch ||
        (path !== '/v2/commands/submit-and-wait' &&
          path !== '/v2/commands/submit-and-wait-for-transaction')
      )
        return super.post(path, body, params, requestOptions);
      return super.post(path, body, params, { ...requestOptions, fetch: fetchCommand });
    };
  }
}

/**
 * Constructs the SDK client and calls init() to discover the Ledger API version.
 * Wraps initialization failures in LedgerApiError; identity is verified during app bootstrap.
 */
export async function createLedgerClient(options: LedgerClientOptions): Promise<LedgerClient> {
  const client = new BackendLedgerClient(options);

  try {
    await client.init();
  } catch (cause) {
    throw new LedgerApiError('Failed to initialize Ledger API client', { cause });
  }

  return client;
}

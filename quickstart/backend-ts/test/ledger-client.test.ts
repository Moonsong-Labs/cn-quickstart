import { afterEach, expect, test } from 'bun:test';
import { createLedgerClient } from '../src/integrations/ledger/client';
import { connectLedger } from '../src/integrations/ledger/connect';

// A simulated Ledger API keeps these tests independent of LocalNet. The SDK client is real.
const servers: ReturnType<typeof Bun.serve>[] = [];

const accessTokenProvider = {
  getAccessToken: async () => 'test-token',
  getAuthContext: async () => ({ userId: 'test-backend', accessToken: 'test-token' }),
};

function serve(fetch: (request: Request) => Response) {
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch });
  servers.push(server);
  return server;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.stop(true)));
});

test('Initializes the Ledger API client with authentication', async () => {
  const requests: { url: string; method: string; authorization: string | null }[] = [];
  const server = serve((request) => {
    requests.push({
      url: request.url,
      method: request.method,
      authorization: request.headers.get('authorization'),
    });
    return Response.json({ version: '3.5.2' });
  });

  await createLedgerClient({ baseUrl: server.url, accessTokenProvider });

  expect(requests).toHaveLength(1);
  expect(new URL(requests[0].url).pathname).toBe('/v2/version');
  expect(requests[0].method).toBe('GET');
  expect(requests[0].authorization).toBe('Bearer test-token');
});

test('Rejects initialization when the ledger rejects authentication', async () => {
  const server = serve(() => Response.json({ message: 'Unauthorized' }, { status: 401 }));

  await expect(createLedgerClient({ baseUrl: server.url, accessTokenProvider })).rejects.toThrow(
    'Failed to initialize Ledger API client',
  );
});

test('Preserves token acquisition failures without contacting the ledger', async () => {
  const failure = new Error('Token provider unavailable');
  let requestCount = 0;
  const server = serve(() => {
    requestCount += 1;
    return Response.json({ version: '3.5.2' });
  });

  await expect(
    createLedgerClient({
      baseUrl: server.url,
      accessTokenProvider: {
        ...accessTokenProvider,
        getAccessToken: () => Promise.reject(failure),
      },
    }),
  ).rejects.toMatchObject({
    message: 'Failed to initialize Ledger API client',
    cause: failure,
  });
  expect(requestCount).toBe(0);
});

test('Rejects initialization when the connection fails', async () => {
  const server = serve(() => Response.error());

  await expect(createLedgerClient({ baseUrl: server.url, accessTokenProvider })).rejects.toThrow(
    'Failed to initialize Ledger API client',
  );
});

test('Connects using the onboarding token without requiring an App Provider party', async () => {
  const authorizations: (string | null)[] = [];
  const server = serve((request) => {
    authorizations.push(request.headers.get('authorization'));
    return Response.json({ version: '3.5.2' });
  });

  const connection = await connectLedger({
    LEDGER_API_URL: server.url.href,
    LEDGER_API_ALLOW_HTTP: 'true',
    LEDGER_API_USER_ID: 'backend-service',
    APP_PROVIDER_BACKEND_USER_TOKEN: 'onboarding-token',
  });

  expect(authorizations).toEqual(['Bearer onboarding-token']);
  expect(connection.ledgerUserId).toBe('backend-service');
});

test('Missing onboarding token prevents connecting to the ledger', async () => {
  let requestCount = 0;
  const server = serve(() => {
    requestCount += 1;
    return Response.json({ version: '3.5.2' });
  });

  for (const token of [undefined, '', '   ']) {
    await expect(
      connectLedger({
        LEDGER_API_URL: server.url.href,
        LEDGER_API_ALLOW_HTTP: 'true',
        LEDGER_API_USER_ID: 'backend-service',
        APP_PROVIDER_BACKEND_USER_TOKEN: token,
      }),
    ).rejects.toThrow('APP_PROVIDER_BACKEND_USER_TOKEN is required for Ledger API access');
  }
  expect(requestCount).toBe(0);
});

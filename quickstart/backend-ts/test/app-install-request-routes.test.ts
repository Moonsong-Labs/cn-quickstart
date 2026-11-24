import { afterEach, expect, spyOn, test } from 'bun:test';
import { Pool } from 'pg';
import { createApp } from '../src/app';
import { readApplicationConfig } from '../src/config/application';
import { appDependencies } from './fixtures/dependencies';

/** Keeps the test pools available for cleanup after each request scenario. */
const pools: Pool[] = [];

/** Builds an app that uses real shared-secret sessions and a stubbed PQS query. */
function setup(rows: object[]) {
  /** The query stub prevents the pool from opening a database connection. */
  const pool = new Pool();
  pools.push(pool);
  /** Captures the SQL and returns rows in the same shape as PQS. */
  const query = spyOn(pool, 'query').mockResolvedValue({ rows } as never);
  /** Uses the built-in provider login to register the test tenants. */
  const application = readApplicationConfig({
    AUTH_MODE: 'shared-secret',
    APP_PROVIDER_PARTY: 'provider-party',
  });
  /** Runs the route with the same wiring as the backend server. */
  const app = createApp({ ...appDependencies, application, pqs: pool });

  /** Logs in through the normal endpoint and extracts the issued session cookie. */
  const login = async (username: string) => {
    /** Holds the login redirect and the session cookie for subsequent requests. */
    const response = await app.handle(
      new Request('http://localhost/login', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ username }),
      }),
    );
    expect(response.status).toBe(302);
    /** The browser cookie contains the session issued by the login handler. */
    const cookie = response.headers.get('set-cookie')?.split(';')[0] ?? '';
    expect(cookie).toStartWith('JSESSIONID=');
    return cookie;
  };

  /** Registers a tenant via the provider's authenticated administration endpoint. */
  const register = (cookie: string, tenant: object) =>
    app.handle(
      new Request('http://localhost/admin/tenant-registrations', {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify(tenant),
      }),
    );

  return { app, login, query, register };
}

/** Builds a PQS row with the original ledger metadata field names. */
function requestRow(contractId: string, user: string, provider: string, description: string) {
  return {
    contract_id: contractId,
    payload: {
      user,
      provider,
      meta: { values: { description } },
    },
  };
}

afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.end()));
});

test('Lists installation requests visible to the authenticated party with API metadata', async () => {
  const { app, login, register, query } = setup([
    requestRow('user-request', 'customer-party', 'provider-party', 'Customer request'),
    requestRow('provider-request', 'another-customer', 'provider-party', 'Provider request'),
    requestRow('unrelated-request', 'unrelated-party', 'another-provider', 'Hidden request'),
  ]);
  const admin = await login('app-provider');
  expect(
    (
      await register(admin, {
        tenantId: 'Customer',
        partyId: 'customer-party',
        users: ['customer'],
      })
    ).status,
  ).toBe(201);
  const response = await app.handle(
    new Request('http://localhost/app-install-requests', {
      headers: { cookie: await login('customer') },
    }),
  );

  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await response.json()).toEqual([
    {
      contractId: 'user-request',
      provider: 'provider-party',
      user: 'customer-party',
      meta: { data: { description: 'Customer request' } },
    },
  ]);
  expect(query).toHaveBeenCalledTimes(1);
  expect(query).toHaveBeenCalledWith('SELECT contract_id, payload FROM active($1)', [
    'quickstart-licensing:Licensing.AppInstall:AppInstallRequest',
  ]);
});

test('Provider sees its requests while unrelated parties remain hidden', async () => {
  const { app, login } = setup([
    requestRow('provider-request', 'customer-party', 'provider-party', 'Customer request'),
    requestRow('unrelated-request', 'unrelated-party', 'another-provider', 'Hidden request'),
    requestRow('second-request', 'other-customer', 'provider-party', 'Second customer request'),
  ]);
  const admin = await login('app-provider');

  const response = await app.handle(
    new Request('http://localhost/app-install-requests', { headers: { cookie: admin } }),
  );

  expect(response.status).toBe(200);
  /** Captures the visible requests without assuming PQS provides a sort order. */
  const requests = await response.json();
  expect(requests).toHaveLength(2);
  expect(requests).toEqual(
    expect.arrayContaining([
      {
        contractId: 'provider-request',
        provider: 'provider-party',
        user: 'customer-party',
        meta: { data: { description: 'Customer request' } },
      },
      {
        contractId: 'second-request',
        provider: 'provider-party',
        user: 'other-customer',
        meta: { data: { description: 'Second customer request' } },
      },
    ]),
  );
});

test('Returns an empty list when the provider is absent from every active request', async () => {
  /** Provides a request that cannot be seen by the configured provider. */
  const { app, login } = setup([
    requestRow('unrelated-request', 'unrelated-party', 'another-provider', 'Hidden request'),
  ]);
  /** Holds the response for an authenticated party with no visible requests. */
  const response = await app.handle(
    new Request('http://localhost/app-install-requests', {
      headers: { cookie: await login('app-provider') },
    }),
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual([]);
});

test('Rejects unauthenticated requests without querying PQS', async () => {
  const { app, query } = setup([]);

  const response = await app.handle(new Request('http://localhost/app-install-requests'));

  expect(response.status).toBe(401);
  expect(response.headers.get('content-type')).toBe('application/problem+json');
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(query).not.toHaveBeenCalled();
});

test('Hides PQS details when listing installation requests fails', async () => {
  const { app, login, query } = setup([]);
  query.mockImplementation(() => Promise.reject(new Error('private database details')) as never);

  const response = await app.handle(
    new Request('http://localhost/app-install-requests', {
      headers: { cookie: await login('app-provider') },
    }),
  );

  expect(response.status).toBe(500);
  expect(response.headers.get('content-type')).toContain('application/problem+json');
  expect(await response.json()).toEqual({ message: 'Internal Server Error' });
});

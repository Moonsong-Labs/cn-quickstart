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

/** Builds a PQS installation with the ledger's string-encoded license count. */
function installRow(
  contractId: string,
  user: string,
  provider: string,
  description: string,
  numLicensesCreated: string,
) {
  /** Provides the common contract fields and metadata in ledger format. */
  const row = requestRow(contractId, user, provider, description);
  return { ...row, payload: { ...row.payload, numLicensesCreated } };
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

test('Lists only the installations visible to each party with their exact license counts', async () => {
  /** Mixes provider-owned, customer-visible and unrelated active installations. */
  const { app, login, register, query } = setup([
    installRow('new-install', 'customer-party', 'provider-party', 'New install', '0'),
    installRow('used-install', 'customer-party', 'other-provider', 'Used install', '3'),
    installRow('large-install', 'other-customer', 'provider-party', 'Large install', '2147483648'),
    installRow(
      'hidden-install',
      'other-customer',
      'other-provider',
      'Hidden install',
      '9007199254740993',
    ),
  ]);
  /** Registers a non-admin customer with a party different from the provider. */
  const providerCookie = await login('app-provider');
  expect(
    (
      await register(providerCookie, {
        tenantId: 'Customer',
        partyId: 'customer-party',
        users: ['customer'],
      })
    ).status,
  ).toBe(201);

  /** Calls the listing endpoint using a real authenticated session. */
  async function list(cookie: string) {
    /** Reads the response issued to the current session. */
    const response = await app.handle(
      new Request('http://localhost/app-installs', { headers: { cookie } }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    return response.json();
  }

  /** The customer and provider can both see this installation. */
  const newInstall = {
    contractId: 'new-install',
    user: 'customer-party',
    provider: 'provider-party',
    meta: { data: { description: 'New install' } },
    numLicensesCreated: 0,
    licenseNum: null,
  };
  /** The customer sees its installations regardless of provider. */
  const userInstalls = await list(await login('customer'));
  expect(userInstalls).toHaveLength(2);
  expect(userInstalls).toEqual(
    expect.arrayContaining([
      newInstall,
      {
        contractId: 'used-install',
        user: 'customer-party',
        provider: 'other-provider',
        meta: { data: { description: 'Used install' } },
        numLicensesCreated: 3,
        licenseNum: null,
      },
    ]),
  );

  /** The provider sees its installations regardless of customer. */
  const providerInstalls = await list(providerCookie);
  expect(providerInstalls).toHaveLength(2);
  expect(providerInstalls).toEqual(
    expect.arrayContaining([
      newInstall,
      {
        contractId: 'large-install',
        user: 'other-customer',
        provider: 'provider-party',
        meta: { data: { description: 'Large install' } },
        numLicensesCreated: 2147483648,
        licenseNum: null,
      },
    ]),
  );
  expect(query).toHaveBeenCalledTimes(2);
  expect(query).toHaveBeenCalledWith('SELECT contract_id, payload FROM active($1)', [
    'quickstart-licensing:Licensing.AppInstall:AppInstall',
  ]);
});

test('Returns an empty installation list for an authenticated party with no visible rows', async () => {
  /** Supplies active rows for other parties only. */
  const { app, login } = setup([
    installRow('hidden-install', 'other-customer', 'other-provider', 'Hidden install', '0'),
  ]);
  /** Requests active installations as the configured provider. */
  const response = await app.handle(
    new Request('http://localhost/app-installs', {
      headers: { cookie: await login('app-provider') },
    }),
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual([]);
});

test('Rejects an unauthenticated installation list request before querying PQS', async () => {
  /** Tracks attempts to read installation data without a session. */
  const { app, query } = setup([]);
  /** Holds the response to the request with no authentication. */
  const response = await app.handle(new Request('http://localhost/app-installs'));
  expect(response.status).toBe(401);
  expect(response.headers.get('content-type')).toBe('application/problem+json');
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(query).not.toHaveBeenCalled();
});

test('Returns a sanitized error when a visible license count cannot be represented exactly', async () => {
  /** Supplies an Int64 that would round if converted to an unchecked JavaScript number. */
  const { app, login } = setup([
    installRow(
      'large-install',
      'customer-party',
      'provider-party',
      'Large install',
      '9007199254740993',
    ),
  ]);
  /** Requests the installation as a party that can see its count. */
  const response = await app.handle(
    new Request('http://localhost/app-installs', {
      headers: { cookie: await login('app-provider') },
    }),
  );
  expect(response.status).toBe(500);
  expect(response.headers.get('content-type')).toBe('application/problem+json');
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await response.json()).toEqual({ message: 'Internal Server Error' });
});

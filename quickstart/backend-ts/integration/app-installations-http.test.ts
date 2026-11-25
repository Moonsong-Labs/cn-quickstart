import { expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { DatabaseError, Pool } from 'pg';
import { createApp } from '../src/app';
import { readApplicationConfig } from '../src/config/application';
import { readPostgresConfig } from '../src/config/postgres';
import { AppInstall, AppInstallRequest } from '../src/daml/licensing';
import { createLedgerClient } from '../src/integrations/ledger/client';
import { connectLedger, type LedgerConnection } from '../src/integrations/ledger/connect';
import { createStaticTokenProvider } from '../src/integrations/ledger/token-provider';
import { createAppInstallRequest } from '../src/modules/app-installations';

/** Waits for PQS to index the ledger transition under test. */
async function waitForPqs(description: string, check: () => Promise<boolean>, timeoutMs = 30_000) {
  /** Gives a slow indexer time to observe the relevant transaction. */
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await Bun.sleep(250);
  }
  throw new Error(`PQS did not index ${description} within ${timeoutMs} ms`);
}

/** Checks a known contract ID without requiring PQS to have indexed its template yet. */
async function isActiveInPqs(pqs: Pool, contractId: string) {
  /** The unfiltered active() function also works before a template's first event. */
  const { rows } = await pqs.query('SELECT 1 FROM active() WHERE contract_id = $1 LIMIT 1', [
    contractId,
  ]);
  return rows.length > 0;
}

/** Reads active contracts for one template as seen by the specified ledger party. */
async function activeContracts(
  { client }: LedgerConnection,
  party: string,
  templateId: string,
  atOffset?: number,
) {
  /** Uses the command completion offset when reading a newly created request. */
  const offset = atOffset ?? (await client.get('/v2/state/ledger-end')).offset;
  if (offset === undefined) throw new Error('Ledger API did not return a ledger-end offset');
  /** Uses the Ledger API independently of the HTTP backend and PQS. */
  const contracts = await client.post('/v2/state/active-contracts', {
    activeAtOffset: offset,
    eventFormat: {
      filtersByParty: {
        [party]: {
          cumulative: [{ identifierFilter: { TemplateFilter: { value: { templateId } } } }],
        },
      },
      verbose: false,
    },
  });
  return contracts.flatMap(({ contractEntry }) =>
    contractEntry && 'JsActiveContract' in contractEntry
      ? [contractEntry.JsActiveContract.createdEvent]
      : [],
  );
}

test('Covers the installation lifecycle through HTTP against LocalNet', async () => {
  /** Uses shared-secret HTTP sessions for both parties while ledger access keeps LocalNet OAuth. */
  const application = readApplicationConfig({ ...process.env, AUTH_MODE: 'shared-secret' });
  /** The provider service identity exercises the choices exercised by the HTTP handlers. */
  const ledger = await connectLedger();
  /** Uses the App User's onboarded identity to submit installation requests. */
  const {
    APP_USER_LEDGER_API_URL: userUrl,
    APP_USER_PARTY: configuredUserParty,
    APP_USER_TOKEN: userToken,
    APP_USER_LEDGER_USER_ID: userId,
  } = process.env;
  if (!userUrl || !configuredUserParty || !userToken || !userId)
    throw new Error('Missing integration App User identity');
  /** Keeps the validated App User party available to the request fixture. */
  const userParty = configuredUserParty;

  /** Seeds requests using the real App User participant and wallet token. */
  const user: LedgerConnection = {
    client: await createLedgerClient({
      baseUrl: new URL(userUrl),
      accessTokenProvider: createStaticTokenProvider({ token: userToken, ledgerUserId: userId }),
    }),
    ledgerUserId: userId,
  };
  /** Identifies the configured App Provider used by the HTTP backend and assertions. */
  const providerParty = application.appProvider.partyId;
  /** Shares the live PQS database between the app and independent index checks. */
  const pqs = new Pool(readPostgresConfig());
  /** Runs the real routes on an ephemeral loopback port inside the test container. */
  const app = createApp({ ledger, application, pqs }, { port: 0, apiDocsEnabled: false });
  try {
    /** Waits for the onboarding backlog before starting the lifecycle checks. */
    const { offset } = await ledger.client.get('/v2/state/ledger-end');
    if (offset === undefined) throw new Error('Ledger API did not return a ledger-end offset');
    await waitForPqs(
      'onboarding',
      async () => {
        /** PQS records the last indexed offset after it has finished its migrations. */
        const { rows } = await pqs
          .query<{ offset: string }>(
            'SELECT "offset" FROM __watermark WHERE "offset" IS NOT NULL AND ix IS NOT NULL',
          )
          .catch((error: unknown) => {
            if (error instanceof DatabaseError && error.code === '42P01') return { rows: [] };
            throw error;
          });
        return rows[0] !== undefined && BigInt(rows[0].offset) >= BigInt(offset);
      },
      120_000,
    );

    app.listen({ hostname: '127.0.0.1', port: 0 });
    /** All HTTP calls hit the real listener rather than bypassing its server adapter. */
    const origin = app.server?.url;
    if (!origin) throw new Error('The backend did not start listening');

    /** Opens a browser-style session and captures its cookie without following the redirect. */
    async function login(username: string) {
      /** Holds the response from the normal login route. */
      const response = await fetch(new URL('/login', origin), {
        method: 'POST',
        body: new URLSearchParams({ username }),
        redirect: 'manual',
      });
      expect(response.status).toBe(302);
      /** Uses only the cookie pair in subsequent HTTP requests. */
      const cookie = response.headers.get('set-cookie')?.split(';')[0];
      if (!cookie?.startsWith('JSESSIONID=')) throw new Error('Login did not issue a session');
      return cookie;
    }

    /** Sends JSON to the installation API as an authenticated party. */
    function post(path: string, cookie: string, body: object) {
      return fetch(new URL(path, origin), {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    }

    /** Reads the requested installation list with the supplied session. */
    async function list(path: '/app-install-requests' | '/app-installs', cookie: string) {
      /** Lets the same checks cover both provider and user visibility. */
      const response = await fetch(new URL(path, origin), { headers: { cookie } });
      expect(response.status).toBe(200);
      return (await response.json()) as { contractId: string }[];
    }

    /** Issues a distinct command ID for each installation action. */
    function action(path: string, contractId: string, name: string, cookie: string, body: object) {
      return post(
        `${path}/${encodeURIComponent(contractId)}:${name}?commandId=${randomUUID()}`,
        cookie,
        body,
      );
    }

    /** Creates a uniquely tagged request and waits until the backend can read it. */
    async function createRequest() {
      /** Distinguishes this request from onboarding and other integration fixtures. */
      const metadata = { integrationTest: randomUUID() };
      /** Captures the user participant's completion offset for the new request. */
      const { completionOffset } = await createAppInstallRequest(
        user,
        { provider: providerParty, user: userParty, meta: { values: metadata } },
        randomUUID(),
      );
      /** Locates the request returned by the user participant's ACS. */
      const matches = (
        await activeContracts(user, userParty, AppInstallRequest.templateId, completionOffset)
      ).filter(
        (event) =>
          AppInstallRequest.decoder.runWithException(event.createArgument).meta.values
            .integrationTest === metadata.integrationTest,
      );
      expect(matches).toHaveLength(1);
      /** Uses the real contract ID in all subsequent HTTP operations. */
      const contractId = matches[0].contractId;
      await waitForPqs('the new installation request', async () => isActiveInPqs(pqs, contractId));
      return { contractId, provider: providerParty, user: userParty, meta: { data: metadata } };
    }

    /** Verifies the ledger archive and waits for the same archive to reach PQS. */
    async function expectArchived(templateId: string, id: string) {
      /** Reads the active contracts from the participant before checking indexed state. */
      const contracts = await activeContracts(ledger, providerParty, templateId);
      expect(contracts.some(({ contractId }) => contractId === id)).toBe(false);
      await waitForPqs(`the archive of ${id}`, async () => !(await isActiveInPqs(pqs, id)));
    }

    /** Starts independent HTTP sessions for the provisioned parties. */
    const providerCookie = await login('app-provider');
    expect(
      (
        await post('/admin/tenant-registrations', providerCookie, {
          tenantId: 'AppUser',
          partyId: userParty,
          users: ['app-user'],
        })
      ).status,
    ).toBe(201);
    /** Uses a non-admin session for the customer visibility and cancellation checks. */
    const userCookie = await login('app-user');

    /** Verifies that rejection consumes the request without creating an installation. */
    const rejected = await createRequest();
    expect(await list('/app-install-requests', providerCookie)).toContainEqual(rejected);
    /** Confirms rejection returns no HTTP body. */
    const rejection = await action(
      '/app-install-requests',
      rejected.contractId,
      'reject',
      providerCookie,
      {
        meta: { data: { reason: 'integration rejection' } },
      },
    );
    expect(rejection.status).toBe(204);
    expect(await rejection.text()).toBe('');
    await expectArchived(AppInstallRequest.templateId, rejected.contractId);
    /** Filters by the request tag so unrelated installations do not affect this assertion. */
    const installsAfterRejection = await activeContracts(
      ledger,
      providerParty,
      AppInstall.templateId,
    );
    expect(
      installsAfterRejection.some(
        ({ createArgument }) =>
          AppInstall.decoder.runWithException(createArgument).meta.values.integrationTest ===
          rejected.meta.data.integrationTest,
      ),
    ).toBe(false);
    expect(
      (await list('/app-install-requests', providerCookie)).map(({ contractId }) => contractId),
    ).not.toContain(rejected.contractId);

    /** Verifies acceptance from the provider session and visibility for both signatories. */
    const accepted = await createRequest();
    expect(await list('/app-install-requests', providerCookie)).toContainEqual(accepted);
    expect(await list('/app-install-requests', userCookie)).toContainEqual(accepted);
    /** Supplies distinct metadata for the installation and the accept choice. */
    const acceptanceBody = {
      installMeta: accepted.meta,
      meta: { data: { audit: 'integration acceptance' } },
    };
    expect(
      (
        await action(
          '/app-install-requests',
          accepted.contractId,
          'accept',
          userCookie,
          acceptanceBody,
        )
      ).status,
    ).toBe(403);
    /** Uses the returned ID to check the created installation against both stores. */
    const acceptance = await action(
      '/app-install-requests',
      accepted.contractId,
      'accept',
      providerCookie,
      acceptanceBody,
    );
    expect(acceptance.status).toBe(201);
    /** Checks the accepted installation's API representation. */
    const installation = (await acceptance.json()) as { contractId: string };
    const expectedInstallation = {
      contractId: expect.any(String),
      provider: providerParty,
      user: userParty,
      meta: accepted.meta,
      numLicensesCreated: 0,
      licenseNum: null,
    };
    expect(installation).toEqual(expectedInstallation);
    /** Matches the response against the installation created by the ledger. */
    const created = (await activeContracts(ledger, providerParty, AppInstall.templateId)).find(
      ({ contractId }) => contractId === installation.contractId,
    );
    expect(AppInstall.decoder.runWithException(created?.createArgument)).toEqual({
      provider: providerParty,
      user: userParty,
      meta: { values: accepted.meta.data },
      numLicensesCreated: '0',
    });
    await expectArchived(AppInstallRequest.templateId, accepted.contractId);
    await waitForPqs('the new installation', async () =>
      isActiveInPqs(pqs, installation.contractId),
    );
    expect(await list('/app-installs', providerCookie)).toContainEqual(installation);
    expect(await list('/app-installs', userCookie)).toContainEqual(installation);

    /** Cancels from the non-admin customer's HTTP session. */
    const cancellation = await action(
      '/app-installs',
      installation.contractId,
      'cancel',
      userCookie,
      {
        meta: { data: { reason: 'integration cancellation' } },
      },
    );
    expect(cancellation.status).toBe(204);
    expect(await cancellation.text()).toBe('');
    await expectArchived(AppInstall.templateId, installation.contractId);
    for (const session of [providerCookie, userCookie]) {
      expect(
        (await list('/app-installs', session)).map(({ contractId }) => contractId),
      ).not.toContain(installation.contractId);
    }
  } finally {
    try {
      if (app.server) await app.stop();
    } finally {
      await pqs.end();
    }
  }
}, 300_000);

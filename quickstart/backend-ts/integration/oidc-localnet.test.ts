// Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: 0BSD

import { expect, test } from 'bun:test';
import { createApp } from '../src/app';
import { readApplicationConfig } from '../src/config/application';
import { appDependencies } from '../test/fixtures/dependencies';

test('LocalNet Keycloak serves browser login and accepts the onboarding bearer', async () => {
  const token = process.env.APP_PROVIDER_PARTICIPANT_ADMIN_TOKEN;
  if (!token) throw new Error('Missing integration AppProvider administrator token');

  const application = readApplicationConfig();
  const { appProvider, oidc } = application;
  if (!oidc) throw new Error('LocalNet authentication test requires OIDC');
  /** Uses real OIDC settings and fixture dependencies for the ledger and PQS. */
  const app = createApp({ ...appDependencies, application });

  const login = await app.handle(
    new Request(`${oidc.publicOrigin}/oauth2/authorization/AppProvider`),
  );
  expect(login.status).toBe(302);
  const location = new URL(login.headers.get('location') ?? '');
  expect(location.origin).toBe(oidc.issuer.origin);
  expect(location.pathname).toBe(`${oidc.issuer.pathname}/protocol/openid-connect/auth`);
  expect(location.searchParams.get('client_id')).toBe(oidc.clientId);
  expect(location.searchParams.get('code_challenge_method')).toBe('S256');

  const tenants = await app.handle(
    new Request(`${oidc.publicOrigin}/admin/tenant-registrations`, {
      headers: { authorization: `Bearer ${token}` },
    }),
  );
  expect(tenants.status).toBe(200);
  expect(await tenants.json()).toContainEqual(
    expect.objectContaining({ tenantId: appProvider.tenantId, partyId: appProvider.partyId }),
  );
}, 30_000);

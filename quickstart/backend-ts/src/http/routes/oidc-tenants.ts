import { Elysia, t } from 'elysia';
import type { Configuration } from 'openid-client';
import type { ApplicationConfig } from '../../config/application';
import {
  assertOidcTenantAvailable,
  externalTenantFields,
  type OidcTenant,
  validateOidcTenant,
} from '../../modules/tenants';
import { problem, tenantRegistrationProblem } from '../plugins/errors';

/** Associates the tenant details returned by the admin API with its browser login client. */
export type OidcRegistration = {
  tenant: OidcTenant;
  /** Discovered at registration for external tenants. AppProvider uses lazy discovery instead. */
  config?: Configuration;
};

/** Seeds the browser registrations with the built-in AppProvider client. */
export function initialRegistrations(
  provider: ApplicationConfig['appProvider'],
  options: Pick<NonNullable<ApplicationConfig['oidc']>, 'issuer' | 'clientId'>,
) {
  return new Map<string, OidcRegistration>([
    [
      provider.tenantId,
      {
        tenant: {
          ...provider,
          walletUrl: null,
          clientId: options.clientId,
          issuerUrl: options.issuer.href,
        },
      },
    ],
  ]);
}

/** Manages OIDC registrations and revokes local access when a tenant is removed. */
export function oidcTenantRoutes(
  registrations: Map<string, OidcRegistration>,
  allowHttp: boolean,
  discover: (issuer: URL, clientId: string) => Promise<Configuration>,
  authorize: (
    request: Request,
    sessionId: unknown,
    csrfCookie: unknown,
  ) => Promise<200 | 401 | 403>,
  revoke: (registration: OidcRegistration) => void,
) {
  return new Elysia({ name: 'oidc-tenants', prefix: '/admin/tenant-registrations' })
    .onTransform(async ({ request, cookie, set }) => {
      set.headers['cache-control'] = 'no-store';
      const access = await authorize(request, cookie.JSESSIONID.value, cookie['XSRF-TOKEN'].value);
      if (access !== 200) throw problem(access, access === 401 ? 'Unauthorized' : 'Forbidden');
    })
    .onError(({ error, code }) => {
      const response = tenantRegistrationProblem(error, code);
      if (response) return response;
      console.error(
        'OIDC tenant administration failed',
        error instanceof Error ? error.name : 'unknown error',
      );
      return problem(500, 'Internal Server Error');
    })
    .get(
      '',
      () => Array.from(registrations.values(), ({ tenant }) => ({ ...tenant, users: null })),
      {
        detail: { operationId: 'listTenantRegistrations', tags: ['Admin'] },
      },
    )
    .delete(
      '/:tenantId',
      ({ params: { tenantId } }) => {
        for (const [id, registration] of registrations) {
          if (registration.tenant.tenantId !== tenantId) continue;
          if (registration.tenant.internal) return problem(403, 'Cannot delete an internal tenant');
          registrations.delete(id);
          revoke(registration);
          return new Response(null, { status: 204 });
        }
        return problem(404, `No tenant found for tenantId = ${tenantId}.`);
      },
      { detail: { operationId: 'deleteTenantRegistration', tags: ['Admin'] } },
    )
    .post(
      '',
      async ({ body, status }) => {
        const fields = externalTenantFields(body);
        const { clientId, issuer } = validateOidcTenant(body, allowHttp);
        const registrationId = `${fields.tenantId}-${clientId}`;
        const entry = { ...fields, clientId, issuerUrl: issuer.href };
        assertOidcTenantAvailable(entry, registrationId, registrations);
        const config = await discover(issuer, clientId);
        const { authorization_endpoint, token_endpoint, jwks_uri } = config.serverMetadata();
        for (const value of [authorization_endpoint, token_endpoint, jwks_uri]) {
          const endpoint = typeof value === 'string' ? URL.parse(value) : null;
          if (
            endpoint?.protocol !== 'https:' &&
            !(allowHttp && issuer.protocol === 'http:' && endpoint?.protocol === 'http:')
          )
            throw new Error('Invalid endpoint in OIDC discovery metadata');
        }
        // Another request may have registered the same tenant while discovery was in flight.
        assertOidcTenantAvailable(entry, registrationId, registrations);
        registrations.set(registrationId, { tenant: entry, config });
        return status(201, { ...entry, users: body.users ?? null });
      },
      {
        body: t.Object({
          tenantId: t.Optional(t.String()),
          partyId: t.Optional(t.String()),
          clientId: t.Optional(t.String()),
          issuerUrl: t.Optional(t.String()),
          walletUrl: t.Optional(t.Nullable(t.String())),
          users: t.Optional(t.Nullable(t.Array(t.String()))),
        }),
        detail: { operationId: 'createTenantRegistration', tags: ['Admin'] },
      },
    );
}

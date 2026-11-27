import { Elysia, t } from 'elysia';
import type { resolveSharedSecretUser } from '../../auth/shared-secret-user';
import {
  assertTenantIdAvailable,
  externalTenantFields,
  optionalTenantUrl,
  type SharedSecretTenant,
  validateSharedSecretUsers,
} from '../../modules/tenants';
import { problem, tenantRegistrationProblem } from '../plugins/errors';

/** Registers admin-only shared-secret tenant creation, listing, and deletion with session revocation. */
export function tenantRegistrationRoutes(
  tenants: SharedSecretTenant[],
  sessionUser: (id: unknown) => ReturnType<typeof resolveSharedSecretUser>,
  revokeTenantSessions: (tenant: SharedSecretTenant) => void,
) {
  return new Elysia({ name: 'shared-secret-tenant-registration' })
    .guard({
      transform: ({ cookie: { JSESSIONID }, set }) => {
        set.headers['cache-control'] = 'no-store';
        const user = sessionUser(JSESSIONID.value);
        if (!user) throw problem(401, 'Unauthorized');
        if (!user.isAdmin) throw problem(403, 'Forbidden');
      },
      error: ({ error, code }) => tenantRegistrationProblem(error, code),
    })
    .get(
      '/admin/tenant-registrations',
      () =>
        tenants.map(({ tenantId, partyId, users, internal, walletUrl }) => ({
          tenantId,
          partyId,
          users,
          internal,
          walletUrl: walletUrl ?? null,
          clientId: null,
          issuerUrl: null,
        })),
      { detail: { operationId: 'listTenantRegistrations', tags: ['Admin'] } },
    )
    .delete(
      '/admin/tenant-registrations/:tenantId',
      ({ params: { tenantId } }) => {
        const index = tenants.findIndex((tenant) => tenant.tenantId === tenantId);
        if (index === -1) return problem(404, `No tenant found for tenantId = ${tenantId}.`);
        const tenant = tenants[index];
        if (tenant.internal) return problem(403, 'Cannot delete an internal tenant');
        revokeTenantSessions(tenant);
        tenants.splice(index, 1);
        return new Response(null, { status: 204 });
      },
      { detail: { operationId: 'deleteTenantRegistration', tags: ['Admin'] } },
    )
    .post(
      '/admin/tenant-registrations',
      ({ body }) => {
        const fields = externalTenantFields(body);
        assertTenantIdAvailable(fields.tenantId, tenants);
        const users = validateSharedSecretUsers(body.users, tenants);
        const issuerUrl = optionalTenantUrl(body.issuerUrl, 'issuer');
        const tenant = {
          ...fields,
          users,
        };
        tenants.push(tenant);
        return Response.json(
          {
            ...tenant,
            clientId: body.clientId ?? null,
            issuerUrl,
          },
          { status: 201 },
        );
      },
      {
        body: t.Object({
          tenantId: t.Optional(t.String()),
          partyId: t.Optional(t.String()),
          users: t.Optional(t.Array(t.String())),
          walletUrl: t.Optional(t.Nullable(t.String())),
          issuerUrl: t.Optional(t.Nullable(t.String())),
          clientId: t.Optional(t.Nullable(t.String())),
        }),
        detail: { operationId: 'createTenantRegistration', tags: ['Admin'] },
      },
    );
}

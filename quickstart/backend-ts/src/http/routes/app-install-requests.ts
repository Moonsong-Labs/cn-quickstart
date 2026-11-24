import { Elysia, t } from 'elysia';
import type { Pool } from 'pg';
import { listAppInstallRequests } from '../../modules/app-installations';

/** Path shared by the HTTP route and its OpenAPI operation. */
export const appInstallRequestsPath = '/app-install-requests';

/** Successful response shared by runtime validation and API documentation. */
const listResponse = t.Array(
  t.Object({
    contractId: t.String(),
    provider: t.String(),
    user: t.String(),
    meta: t.Object({ data: t.Record(t.String(), t.String()) }),
  }),
);

/** Media type used for application errors returned by this route. */
const problemMediaType = 'application/problem+json';

/** Matches the API error body without exposing authentication or database details. */
const errorResponse = t.Object({ message: t.String() });

/** Documents problem responses explicitly because automatic generation labels object responses as JSON. */
export const listAppInstallRequestsOperation = {
  operationId: 'listAppInstallRequests',
  tags: ['App Installs Requests'],
  responses: {
    200: {
      description: 'Installation requests visible to the authenticated party',
      content: { 'application/json': { schema: listResponse } },
    },
    401: {
      description: 'Not authenticated',
      content: { [problemMediaType]: { schema: errorResponse } },
    },
    500: {
      description: 'An internal server error occurred',
      content: { [problemMediaType]: { schema: errorResponse } },
    },
  },
};

/** Exposes the installation request list using the active authentication mode. */
export function appInstallRequestRoutes(
  pqs: Pool,
  authenticatedParty: (
    request: Request,
    sessionId: unknown,
  ) => string | null | Promise<string | null>,
) {
  return new Elysia({ name: 'app-install-requests' }).get(
    appInstallRequestsPath,
    async ({ request, cookie: { JSESSIONID }, set, status }) => {
      set.headers['cache-control'] = 'no-store';
      try {
        /** Party established by the configured session or trusted OIDC bearer. */
        const party = await authenticatedParty(request, JSESSIONID.value);
        if (party === null) {
          set.headers['content-type'] = problemMediaType;
          return status(401, { message: 'Unauthorized' });
        }
        return await listAppInstallRequests(pqs, party);
      } catch (error) {
        console.error(
          'Listing installation requests failed',
          error instanceof Error ? error.name : 'unknown error',
        );
        set.headers['content-type'] = problemMediaType;
        return status(500, { message: 'Internal Server Error' });
      }
    },
    {
      response: {
        200: listResponse,
        401: errorResponse,
        500: errorResponse,
      },
      detail: listAppInstallRequestsOperation,
    },
  );
}

import { Elysia, t } from 'elysia';
import type { Pool } from 'pg';
import { listAppInstallRequests } from '../../modules/app-installations';

/** Matches the API error body without exposing authentication or database details. */
const errorResponse = t.Object({ message: t.String() });

/** Exposes the installation request list using the active authentication mode. */
export function appInstallRequestRoutes(
  pqs: Pool,
  authenticatedParty: (
    request: Request,
    sessionId: unknown,
  ) => string | null | Promise<string | null>,
) {
  return new Elysia({ name: 'app-install-requests' }).get(
    '/app-install-requests',
    async ({ request, cookie: { JSESSIONID }, set, status }) => {
      set.headers['cache-control'] = 'no-store';
      try {
        /** Party established by the configured session or trusted OIDC bearer. */
        const party = await authenticatedParty(request, JSESSIONID.value);
        if (party === null) {
          set.headers['content-type'] = 'application/problem+json';
          return status(401, { message: 'Unauthorized' });
        }
        return await listAppInstallRequests(pqs, party);
      } catch (error) {
        console.error(
          'Listing installation requests failed',
          error instanceof Error ? error.name : 'unknown error',
        );
        set.headers['content-type'] = 'application/problem+json';
        return status(500, { message: 'Internal Server Error' });
      }
    },
    {
      response: {
        200: t.Array(
          t.Object({
            contractId: t.String(),
            provider: t.String(),
            user: t.String(),
            meta: t.Object({ data: t.Record(t.String(), t.String()) }),
          }),
        ),
        401: errorResponse,
        500: errorResponse,
      },
      detail: { operationId: 'listAppInstallRequests', tags: ['App Installs Requests'] },
    },
  );
}

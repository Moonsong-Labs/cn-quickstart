import { type Context, Elysia, status, t } from 'elysia';
import type { OpenAPIV3 } from 'openapi-types';
import type { Pool } from 'pg';
import { listAppInstallRequests, listAppInstalls } from '../../modules/app-installations';

/** Paths shared by the HTTP routes and their OpenAPI operations. */
export const appInstallRequestsPath = '/app-install-requests';
/** Path for the active installation list. */
export const appInstallsPath = '/app-installs';

/** Fields shared by installation request and installation API responses. */
const installationFields = {
  contractId: t.String(),
  provider: t.String(),
  user: t.String(),
  meta: t.Object({ data: t.Record(t.String(), t.String()) }),
};
/** Runtime and API schema for the installation request list. */
const requestListResponse = t.Array(t.Object(installationFields));
/** Runtime and API schema for the installation list, including Java's nullable license number. */
const installListResponse = t.Array(
  t.Object({
    ...installationFields,
    numLicensesCreated: t.Integer(),
    licenseNum: t.Nullable(t.Integer()),
  }),
);

/** Media type used for application errors returned by the listing routes. */
const problemMediaType = 'application/problem+json';

/** Matches the API error body without exposing authentication or database details. */
const errorResponse = t.Object({ message: t.String() });

/** Documents problem responses explicitly because automatic generation labels objects as JSON. */
function listOperation(
  operationId: string,
  tag: string,
  description: string,
  schema: typeof requestListResponse | typeof installListResponse,
) {
  /** TypeBox emits valid 3.1 JSON Schema, while the OpenAPI plugin types its input as 3.0. */
  const documentedSchema = schema as unknown as OpenAPIV3.SchemaObject;
  return {
    operationId,
    tags: [tag],
    responses: {
      200: { description, content: { 'application/json': { schema: documentedSchema } } },
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
}

/** OpenAPI operation for listing requests. */
export const listAppInstallRequestsOperation = listOperation(
  'listAppInstallRequests',
  'App Installs Requests',
  'Installation requests visible to the authenticated party',
  requestListResponse,
);
/** OpenAPI operation for listing installations. */
export const listAppInstallsOperation = listOperation(
  'listAppInstalls',
  'App Installs',
  'Installations visible to the authenticated party',
  installListResponse,
);

/** Exposes both installation lists using the active authentication mode. */
export function appInstallationRoutes(
  pqs: Pool,
  authenticatedParty: (
    request: Request,
    sessionId: unknown,
  ) => string | null | Promise<string | null>,
) {
  /** Authenticates before querying PQS and keeps party-specific results out of caches. */
  function listForParty<T>(list: (pqs: Pool, party: string) => Promise<T>, failureMessage: string) {
    return async ({
      request,
      cookie: { JSESSIONID },
      set,
    }: Pick<Context, 'request' | 'cookie' | 'set'>) => {
      set.headers['cache-control'] = 'no-store';
      try {
        /** Party established by the configured session or trusted OIDC bearer. */
        const party = await authenticatedParty(request, JSESSIONID.value);
        if (party === null) {
          set.headers['content-type'] = problemMediaType;
          return status(401, { message: 'Unauthorized' });
        }
        return await list(pqs, party);
      } catch (error) {
        console.error(failureMessage, error instanceof Error ? error.name : 'unknown error');
        set.headers['content-type'] = problemMediaType;
        return status(500, { message: 'Internal Server Error' });
      }
    };
  }

  return new Elysia({ name: 'app-installations' })
    .get(
      appInstallRequestsPath,
      listForParty(listAppInstallRequests, 'Listing installation requests failed'),
      {
        response: { 200: requestListResponse, 401: errorResponse, 500: errorResponse },
        detail: listAppInstallRequestsOperation,
      },
    )
    .get(appInstallsPath, listForParty(listAppInstalls, 'Listing installations failed'), {
      response: { 200: installListResponse, 401: errorResponse, 500: errorResponse },
      detail: listAppInstallsOperation,
    });
}

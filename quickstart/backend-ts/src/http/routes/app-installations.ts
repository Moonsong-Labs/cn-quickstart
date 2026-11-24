import { type Context, Elysia, status, t } from 'elysia';
import type { OpenAPIV3 } from 'openapi-types';
import type { Pool } from 'pg';
import type { LedgerConnection } from '../../integrations/ledger/connect';
import {
  acceptAppInstallRequest,
  listAppInstallRequests,
  listAppInstalls,
} from '../../modules/app-installations';

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
/** Runtime and API schema for an installation, including Java's nullable license number. */
const installResponse = t.Object({
  ...installationFields,
  numLicensesCreated: t.Integer(),
  licenseNum: t.Nullable(t.Integer()),
});
/** Runtime and API schema for the installation list. */
const installListResponse = t.Array(installResponse);
/** Optional map in an API metadata object. */
const choiceMetadata = t.Object({ data: t.Optional(t.Record(t.String(), t.String())) });
/** Keeps installation metadata distinct from acceptance metadata. */
const acceptBody = t.Object({ installMeta: choiceMetadata, meta: choiceMetadata });
/** Requires a nonblank command ID and passes the original value to the ledger. */
const commandIdQuery = t.Object({ commandId: t.String({ pattern: '\\S' }) });
/** Action suffix consumed by the route handler, distinct from the ledger contract ID. */
const acceptSuffix = ':accept';
/** Public OpenAPI path for the acceptance operation. */
export const acceptAppInstallRequestPath = `${appInstallRequestsPath}/{contractId}${acceptSuffix}`;

/** Media type used for installation API errors. */
const problemMediaType = 'application/problem+json';

/** Matches the API error body without exposing authentication or database details. */
const errorResponse = t.Object({ message: t.String() });

/** Describes a JSON problem response shared by installation API errors. */
function problemResponse(description: string) {
  return { description, content: { [problemMediaType]: { schema: errorResponse } } };
}

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
      401: problemResponse('Not authenticated'),
      500: problemResponse('An internal server error occurred'),
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

/** OpenAPI operation for acceptance, whose suffix is routed inside the dynamic segment. */
export const acceptAppInstallRequestOperation = {
  operationId: 'acceptAppInstallRequest',
  tags: ['App Installs Requests'],
  parameters: [
    { name: 'contractId', in: 'path', required: true, schema: { type: 'string' as const } },
    { name: 'commandId', in: 'query', required: true, schema: commandIdQuery.properties.commandId },
  ],
  requestBody: {
    required: true,
    content: { 'application/json': { schema: acceptBody } },
  },
  responses: {
    201: {
      description: 'AppInstall created from request',
      content: {
        'application/json': { schema: installResponse as unknown as OpenAPIV3.SchemaObject },
      },
    },
    400: problemResponse('Invalid request'),
    401: problemResponse('Not authenticated'),
    403: problemResponse('Forbidden'),
    404: problemResponse('Installation request not found'),
    500: problemResponse('An internal server error occurred'),
  },
};

/** Checks that normalization cannot turn a malformed metadata map into an empty object. */
function hasMetadataShape(value: unknown) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  if (!('data' in value)) return true;
  return typeof value.data === 'object' && value.data !== null && !Array.isArray(value.data);
}

/** Sends a sanitized error for acceptance and disables caching even on parse errors. */
function acceptanceProblem(status: number, message: string) {
  return Response.json(
    { message },
    { status, headers: { 'content-type': problemMediaType, 'cache-control': 'no-store' } },
  );
}

/** Exposes installation listing and acceptance using the active authentication mode. */
export function appInstallationRoutes(
  pqs: Pool,
  ledger: LedgerConnection,
  providerParty: string,
  authenticatedParty: (
    request: Request,
    sessionId: unknown,
  ) => string | null | Promise<string | null>,
  authorizeAppProvider: (
    request: Request,
    sessionId: unknown,
    csrfCookie: unknown,
  ) => 200 | 401 | 403 | Promise<200 | 401 | 403>,
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
    })
    .post(
      `${appInstallRequestsPath}/:contractAction`,
      async ({ params, query, body }) => {
        /** Removes only the action suffix, preserving the exact contract and command identifiers. */
        const contractId = params.contractAction.slice(0, -acceptSuffix.length);
        if (!contractId.trim()) throw acceptanceProblem(400, 'Invalid contract ID');

        /** Exercises the consuming choice and returns the confirmed installation directly. */
        const install = await acceptAppInstallRequest(
          pqs,
          ledger,
          providerParty,
          contractId,
          query.commandId,
          {
            installMeta: { values: body.installMeta.data ?? {} },
            meta: { values: body.meta.data ?? {} },
          },
        );
        if (!install) throw acceptanceProblem(404, 'Installation request not found');
        return status(201, install);
      },
      {
        // The router treats text after a parameter's colon as part of its name.
        detail: { hide: true },
        query: commandIdQuery,
        body: acceptBody,
        response: { 201: installResponse },
        async transform({ request, params, cookie, set, body }) {
          set.headers['cache-control'] = 'no-store';
          if (!params.contractAction.endsWith(acceptSuffix))
            throw acceptanceProblem(404, 'Not found');
          /** Uses the same provider authentication and CSRF rules as tenant administration. */
          const access = await authorizeAppProvider(
            request,
            cookie.JSESSIONID.value,
            cookie['XSRF-TOKEN'].value,
          );
          if (access !== 200)
            throw acceptanceProblem(access, access === 401 ? 'Unauthorized' : 'Forbidden');
          if (!hasMetadataShape(body?.installMeta) || !hasMetadataShape(body?.meta))
            throw acceptanceProblem(400, 'Invalid metadata');
        },
        error({ error, code }) {
          if (error instanceof Response) return error;
          if (code === 'PARSE' || (code === 'VALIDATION' && error.type !== 'response'))
            return acceptanceProblem(400, 'Invalid request');
          console.error(
            'Accepting installation request failed',
            error instanceof Error ? error.name : 'unknown error',
          );
          return acceptanceProblem(500, 'Internal Server Error');
        },
      },
    );
}

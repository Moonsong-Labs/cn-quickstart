import { type Context, Elysia, status, t, ValidationError } from 'elysia';
import type { OpenAPIV3 } from 'openapi-types';
import type { Pool } from 'pg';
import type { LedgerConnection } from '../../integrations/ledger/connect';
import {
  acceptAppInstallRequest,
  cancelAppInstall,
  listAppInstallRequests,
  listAppInstalls,
  rejectAppInstallRequest,
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
/** Runtime and API schema for rejection and cancellation metadata. */
const metadataActionBody = t.Object({ meta: choiceMetadata });
/** One runtime route handles both actions and checks installMeta for acceptance before validation. */
const requestActionBody = t.Object({
  ...metadataActionBody.properties,
  installMeta: t.Optional(choiceMetadata),
});
/** Requires a nonblank command ID and passes the original value to the ledger. */
const commandIdQuery = t.Object({ commandId: t.String({ pattern: '\\S' }) });
/** Action suffix consumed by the route handler, distinct from the ledger contract ID. */
const acceptSuffix = ':accept';
/** Suffix for consuming a request without creating an installation. */
const rejectSuffix = ':reject';
/** Suffix for canceling an active installation. */
const cancelSuffix = ':cancel';
/** Public OpenAPI path for the acceptance operation. */
export const acceptAppInstallRequestPath = `${appInstallRequestsPath}/{contractId}${acceptSuffix}`;
/** Public OpenAPI path for the rejection operation. */
export const rejectAppInstallRequestPath = `${appInstallRequestsPath}/{contractId}${rejectSuffix}`;
/** Public OpenAPI path for cancellation. */
export const cancelAppInstallPath = `${appInstallsPath}/{contractId}${cancelSuffix}`;

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

/** Shared path and query inputs for installation actions. */
const installationActionParameters = [
  { name: 'contractId', in: 'path', required: true, schema: { type: 'string' as const } },
  { name: 'commandId', in: 'query', required: true, schema: commandIdQuery.properties.commandId },
];

/** Error responses shared by acceptance and rejection. */
const requestActionErrors = {
  400: problemResponse('Invalid request'),
  401: problemResponse('Not authenticated'),
  403: problemResponse('Forbidden'),
  404: problemResponse('Installation request not found'),
  500: problemResponse('An internal server error occurred'),
};

/** OpenAPI operation for acceptance, whose suffix is routed inside the dynamic segment. */
export const acceptAppInstallRequestOperation = {
  operationId: 'acceptAppInstallRequest',
  tags: ['App Installs Requests'],
  parameters: installationActionParameters,
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
    ...requestActionErrors,
  },
};

/** OpenAPI operation for rejection, which returns no content after ledger confirmation. */
export const rejectAppInstallRequestOperation = {
  operationId: 'rejectAppInstallRequest',
  tags: ['App Installs Requests'],
  parameters: installationActionParameters,
  requestBody: {
    required: true,
    content: { 'application/json': { schema: metadataActionBody } },
  },
  responses: {
    204: { description: 'AppInstallRequest rejected' },
    ...requestActionErrors,
  },
};

/** OpenAPI operation for cancellation, which returns no content after ledger confirmation. */
export const cancelAppInstallOperation = {
  operationId: 'cancelAppInstall',
  tags: ['App Installs'],
  parameters: installationActionParameters,
  requestBody: {
    required: true,
    content: { 'application/json': { schema: metadataActionBody } },
  },
  responses: {
    204: { description: 'AppInstall canceled' },
    ...requestActionErrors,
    404: problemResponse('Installation not found'),
  },
};

/** Checks that normalization cannot turn a malformed metadata map into an empty object. */
function hasMetadataShape(value: unknown) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  if (!('data' in value)) return true;
  return typeof value.data === 'object' && value.data !== null && !Array.isArray(value.data);
}

/** Sends a sanitized error for an installation action and disables caching even on parse errors. */
function installationActionProblem(status: number, message: string) {
  return Response.json(
    { message },
    { status, headers: { 'content-type': problemMediaType, 'cache-control': 'no-store' } },
  );
}

/** Maps invalid input and unexpected failures to the installation API's problem responses. */
function installationActionError({ error, code }: { error: unknown; code: unknown }) {
  if (error instanceof Response) return error;
  if (code === 'PARSE' || (error instanceof ValidationError && error.type !== 'response'))
    return installationActionProblem(400, 'Invalid request');
  console.error(
    'Processing installation action failed',
    error instanceof Error ? error.name : 'unknown error',
  );
  return installationActionProblem(500, 'Internal Server Error');
}

/** Exposes installation listing and actions using the active authentication mode. */
export function appInstallationRoutes(
  pqs: Pool,
  ledger: LedgerConnection,
  providerParty: string,
  authenticatedParty: (
    request: Request,
    sessionId: unknown,
    csrfCookie?: unknown,
  ) => string | null | 403 | Promise<string | null | 403>,
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
        if (typeof party !== 'string') {
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
        /** The transform has already checked that the action suffix is supported. */
        const suffix = params.contractAction.endsWith(rejectSuffix) ? rejectSuffix : acceptSuffix;
        /** Removes only the action suffix, preserving the exact contract and command identifiers. */
        const contractId = params.contractAction.slice(0, -suffix.length);
        if (!contractId.trim()) throw installationActionProblem(400, 'Invalid contract ID');

        /** Operation metadata is passed to either Daml choice. */
        const meta = { values: body.meta.data ?? {} };
        if (suffix === rejectSuffix) {
          /** Waits for the consuming choice before returning no content. */
          const rejected = await rejectAppInstallRequest(
            pqs,
            ledger,
            providerParty,
            contractId,
            query.commandId,
            { meta },
          );
          if (!rejected) throw installationActionProblem(404, 'Installation request not found');
          return status(204, undefined);
        }

        /** Exercises the consuming choice and returns the confirmed installation directly. */
        const install = await acceptAppInstallRequest(
          pqs,
          ledger,
          providerParty,
          contractId,
          query.commandId,
          {
            installMeta: { values: body.installMeta?.data ?? {} },
            meta,
          },
        );
        if (!install) throw installationActionProblem(404, 'Installation request not found');
        return status(201, install);
      },
      {
        // The router treats text after a parameter's colon as part of its name.
        detail: { hide: true },
        query: commandIdQuery,
        body: requestActionBody,
        response: { 201: installResponse, 204: t.Void() },
        async transform({ request, params, cookie, set, body }) {
          set.headers['cache-control'] = 'no-store';
          /** Checks the action before authorizing or submitting a command. */
          const isAccept = params.contractAction.endsWith(acceptSuffix);
          if (!isAccept && !params.contractAction.endsWith(rejectSuffix))
            throw installationActionProblem(404, 'Not found');
          /** Uses the same provider authentication and CSRF rules as tenant administration. */
          const access = await authorizeAppProvider(
            request,
            cookie.JSESSIONID.value,
            cookie['XSRF-TOKEN'].value,
          );
          if (access !== 200)
            throw installationActionProblem(access, access === 401 ? 'Unauthorized' : 'Forbidden');
          if (!hasMetadataShape(body?.meta) || (isAccept && !hasMetadataShape(body?.installMeta)))
            throw installationActionProblem(400, 'Invalid metadata');
        },
        error: installationActionError,
      },
    )
    .post(
      `${appInstallsPath}/:contractAction`,
      async ({ request, params, query, body, cookie }) => {
        /** The contract ID excludes the action suffix checked by the transform. */
        const contractId = params.contractAction.slice(0, -cancelSuffix.length);
        if (!contractId.trim()) throw installationActionProblem(400, 'Invalid contract ID');

        /** Resolves a browser session with CSRF protection or a verified bearer. */
        const party = await authenticatedParty(
          request,
          cookie.JSESSIONID.value,
          cookie['XSRF-TOKEN'].value,
        );
        if (party === null) throw installationActionProblem(401, 'Unauthorized');
        if (party === 403) throw installationActionProblem(403, 'Forbidden');

        /** Waits for the ledger to confirm cancellation before sending no content. */
        const result = await cancelAppInstall(pqs, ledger, providerParty, {
          party,
          contractId,
          commandId: query.commandId,
          meta: { values: body.meta.data ?? {} },
        });
        if (result === 'missing') throw installationActionProblem(404, 'Installation not found');
        if (result === 'forbidden') throw installationActionProblem(403, 'Forbidden');
        return status(204, undefined);
      },
      {
        // The public OpenAPI path includes the suffix validated here.
        detail: { hide: true },
        query: commandIdQuery,
        body: metadataActionBody,
        response: { 204: t.Void() },
        transform({ params, set, body }) {
          set.headers['cache-control'] = 'no-store';
          if (!params.contractAction.endsWith(cancelSuffix))
            throw installationActionProblem(404, 'Not found');
          if (!hasMetadataShape(body?.meta))
            throw installationActionProblem(400, 'Invalid metadata');
        },
        error: installationActionError,
      },
    );
}

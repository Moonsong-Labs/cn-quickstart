import { expect, test } from 'bun:test';
import SwaggerParser from '@apidevtools/swagger-parser';
import type { OpenAPIV3_1 } from 'openapi-types';
import { createApp } from '../src/app';
import { appDependencies } from './fixtures/dependencies';

// Keep documentation assertions independent of NODE_ENV.
const docsConfig = { port: 8081, apiDocsEnabled: true };

test('OpenAPI describes the health endpoint and its response', async () => {
  const response = await createApp(appDependencies, docsConfig).handle(
    new Request('http://localhost/openapi/json'),
  );

  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    openapi: '3.1.0',
    info: { title: 'CN Quickstart Backend API' },
    paths: {
      '/health': {
        get: {
          operationId: 'getHealth',
          responses: {
            '200': {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['status'],
                    properties: { status: { const: 'ok' } },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
});

test.each(['/app-install-requests', '/app-installs'])(
  'OpenAPI documents problem JSON for errors from %s',
  async (path) => {
    /** Fetches the generated spec through the running application's documentation route. */
    const response = await createApp(appDependencies, docsConfig).handle(
      new Request('http://localhost/openapi/json'),
    );
    expect(response.status).toBe(200);

    /** Reads the responses exposed to consumers of the listing operation. */
    const document = (await response.json()) as OpenAPIV3_1.Document;
    /** Confirms error media types without masking an accidental change to the success response. */
    const responses = document.paths?.[path]?.get?.responses;
    for (const [status, mediaType] of [
      [200, 'application/json'],
      [401, 'application/problem+json'],
      [500, 'application/problem+json'],
    ] as const) {
      /** Looks up each response by its documented HTTP status. */
      const response = responses?.[status];
      expect(
        Object.keys(response && 'content' in response ? (response.content ?? {}) : {}),
      ).toEqual([mediaType]);
    }
  },
);

test.each([
  ['accept', 'acceptAppInstallRequest', 201, ['installMeta', 'meta']],
  ['reject', 'rejectAppInstallRequest', 204, ['meta']],
] as const)(
  'OpenAPI documents the public %s path and command ID',
  async (action, operationId, success, required) => {
    /** Fetches the generated spec exposed by the backend. */
    const response = await createApp(appDependencies, docsConfig).handle(
      new Request('http://localhost/openapi/json'),
    );
    /** Reads the operation that clients use rather than the internal dispatch path. */
    const document = (await response.json()) as OpenAPIV3_1.Document;
    expect(document.paths?.['/app-install-requests/{contractAction}']).toBeUndefined();
    /** Verifies the contract and command IDs are documented as distinct required inputs. */
    const operation = document.paths?.[`/app-install-requests/{contractId}:${action}`]?.post;
    expect(operation).toMatchObject({
      operationId,
      parameters: [
        { name: 'contractId', in: 'path', required: true },
        { name: 'commandId', in: 'query', required: true },
      ],
      requestBody: {
        required: true,
        content: { 'application/json': { schema: { required } } },
      },
      responses: {
        [success]: { description: expect.any(String) },
        400: { content: { 'application/problem+json': {} } },
        401: { content: { 'application/problem+json': {} } },
        403: { content: { 'application/problem+json': {} } },
        404: { content: { 'application/problem+json': {} } },
        500: { content: { 'application/problem+json': {} } },
      },
    });
    if (success === 204) expect(operation?.responses?.[success]).not.toHaveProperty('content');
    else expect(operation?.responses?.[success]).toHaveProperty('content.application/json');
  },
);

test('Serves documentation from independent application instances', async () => {
  for (const app of [
    createApp(appDependencies, docsConfig),
    createApp(appDependencies, docsConfig),
  ]) {
    const response = await app.handle(new Request('http://localhost/openapi'));

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    const html = await response.text();
    expect(html).toContain('openapi/json');
    expect(html).toContain('@scalar/api-reference@1.75.1/dist/browser/standalone.min.js');
    expect(html).not.toContain('@latest');
  }
});

test('omits API docs when they are disabled', async () => {
  const app = createApp(appDependencies, { port: 8081, apiDocsEnabled: false });
  const docs = await app.handle(new Request('http://localhost/openapi'));
  const spec = await app.handle(new Request('http://localhost/openapi/json'));
  const health = await app.handle(new Request('http://localhost/health'));

  expect(docs.status).toBe(404);
  expect(spec.status).toBe(404);
  expect(health.status).toBe(200);
});

test('Generated document is valid OpenAPI', async () => {
  const response = await createApp(appDependencies, docsConfig).handle(
    new Request('http://localhost/openapi/json'),
  );
  const document = (await response.json()) as OpenAPIV3_1.Document;

  await SwaggerParser.validate(document, { resolve: { external: false } });
});

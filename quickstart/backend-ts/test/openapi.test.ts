import { expect, test } from 'bun:test';
import SwaggerParser from '@apidevtools/swagger-parser';
import type { OpenAPIV3_1 } from 'openapi-types';
import { createApp } from '../src/app';

/** App with docs forced on, so these assertions do not follow `NODE_ENV`. */
function appWithDocs() {
  return createApp({ port: 8081, apiDocsEnabled: true });
}

test('OpenAPI describes the health endpoint and its response', async () => {
  const response = await appWithDocs().handle(new Request('http://localhost/openapi/json'));

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

test('Serves documentation from independent application instances', async () => {
  for (const app of [appWithDocs(), appWithDocs()]) {
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
  const app = createApp({ port: 8081, apiDocsEnabled: false });
  const docs = await app.handle(new Request('http://localhost/openapi'));
  const spec = await app.handle(new Request('http://localhost/openapi/json'));
  const health = await app.handle(new Request('http://localhost/health'));

  expect(docs.status).toBe(404);
  expect(spec.status).toBe(404);
  expect(health.status).toBe(200);
});

test('Generated document is valid OpenAPI', async () => {
  const response = await appWithDocs().handle(new Request('http://localhost/openapi/json'));
  const document = (await response.json()) as OpenAPIV3_1.Document;

  await SwaggerParser.validate(document, { resolve: { external: false } });
});

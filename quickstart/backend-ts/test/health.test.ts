import { expect, test } from 'bun:test';
import { createApp } from '../src/app';

test('GET /health returns OK as JSON', async () => {
  const app = createApp();
  const response = await app.handle(new Request('http://localhost/health'));

  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toContain('application/json');
  expect(await response.json()).toEqual({ status: 'ok' });
});

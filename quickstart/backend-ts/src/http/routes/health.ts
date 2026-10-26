import { Elysia, t } from 'elysia';

export const healthRoutes = new Elysia({ name: 'health' }).get(
  '/health',
  () => ({ status: 'ok' as const }),
  {
    response: {
      200: t.Object({ status: t.Literal('ok') }),
    },
    detail: {
      summary: 'Check server health',
      description: 'Confirms that the HTTP server is responding.',
      tags: ['System'],
      operationId: 'getHealth',
    },
  },
);

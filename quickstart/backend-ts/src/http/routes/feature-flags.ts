import { Elysia, t } from 'elysia';
import type { AuthMode } from '../../config/auth-mode';

export function featureFlagRoutes(authMode: AuthMode) {
  return new Elysia({ name: 'feature-flags' }).get('/feature-flags', () => ({ authMode }), {
    response: t.Object({ authMode: t.Union([t.Literal('oauth2'), t.Literal('shared-secret')]) }),
    detail: { operationId: 'getFeatureFlags', tags: ['Feature Flags'] },
  });
}

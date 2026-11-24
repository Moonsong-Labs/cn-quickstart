import { openapi } from '@elysiajs/openapi';
import {
  appInstallRequestsPath,
  listAppInstallRequestsOperation,
} from '../routes/app-install-requests';

export function createApiDocumentation() {
  return openapi({
    scalar: { version: '1.75.1' },
    documentation: {
      openapi: '3.1.0',
      info: {
        title: 'CN Quickstart Backend API',
        version: '0.0.0',
        description: 'HTTP API for the CN Quickstart licensing application.',
      },
      tags: [{ name: 'System', description: 'Server health and operational endpoints.' }],
      paths: {
        [appInstallRequestsPath]: { get: listAppInstallRequestsOperation },
      },
    },
  });
}

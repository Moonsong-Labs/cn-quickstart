import type { ServerResponse } from 'node:http';
import ViteYaml from '@modyfi/vite-plugin-yaml';
import react from '@vitejs/plugin-react';
import { type ConfigEnv, defineConfig, loadEnv, type Plugin } from 'vite';

type HeaderValue = string | string[] | undefined;

type ProxyRequest = {
  setHeader: (name: string, value: string | number) => void;
};

type ProxiedRequest = {
  headers: Record<string, HeaderValue>;
  socket: { remoteAddress?: string };
};

function printWelcomeMessage(): Plugin {
  return {
    name: 'print-welcome-message',
    configureServer(server) {
      const print = () =>
        server.config.logger.info(
          `  \x1b[97mVisit \x1b[96mhttp://app-provider.localhost\x1b[1;96m:${server.config.server.port}\x1b[0m\x1b[97m to start\x1b[0m`,
        );
      const http = server.httpServer;
      const handle = http ? Reflect.get(http, '_handle') : undefined;
      if (http && (http.listening || handle)) {
        print();
      } else if (http) {
        http.once('listening', print);
      } else {
        // fallback for older vite/node combos
        setTimeout(print, 100);
      }
    },
  };
}

function headerValue(value: HeaderValue, fallback = ''): string {
  if (Array.isArray(value)) return value.join(', ');
  return value || fallback;
}

function setProxyCustomHeaders(proxy: {
  on: (
    event: 'proxyReq',
    listener: (proxyReq: ProxyRequest, req: ProxiedRequest, res: ServerResponse) => void,
  ) => void;
}) {
  proxy.on('proxyReq', (proxyReq, req) => {
    proxyReq.setHeader('Content-Type', headerValue(req.headers['content-type']));
    proxyReq.setHeader('X-Real-IP', req.socket.remoteAddress || '');
    proxyReq.setHeader('X-Forwarded-Host', headerValue(req.headers.host));
    proxyReq.setHeader(
      'X-Forwarded-For',
      headerValue(req.headers['x-forwarded-for'], req.socket.remoteAddress || ''),
    );
    proxyReq.setHeader('X-Forwarded-Proto', 'http');
    proxyReq.setHeader('X-Forwarded-Port', 5173);
    proxyReq.setHeader('host', 'app-provider.localhost');
  });
}

export default defineConfig(({ mode }: ConfigEnv) => {
  const env = loadEnv(mode, '../');
  const backendPort = env.VITE_BACKEND_PORT || 8080;
  return {
    plugins: [react(), ViteYaml(), printWelcomeMessage()],
    server: {
      host: 'localhost',
      strictPort: true,
      allowedHosts: ['app-provider.localhost'],
      proxy: {
        '/api': {
          target: `http://localhost:${backendPort}/`,
          changeOrigin: false,
          rewrite: (path) => path.replace(/^\/api/, ''),
          configure: setProxyCustomHeaders,
        },
        '/login': {
          target: `http://localhost:${backendPort}/`,
          changeOrigin: false,
          configure: setProxyCustomHeaders,
        },
        '/login/oauth2': {
          target: `http://localhost:${backendPort}/`,
          changeOrigin: false,
          configure: setProxyCustomHeaders,
        },
        '/oauth2': {
          target: `http://localhost:${backendPort}/`,
          changeOrigin: false,
          configure: setProxyCustomHeaders,
        },
      },
    },
  };
});

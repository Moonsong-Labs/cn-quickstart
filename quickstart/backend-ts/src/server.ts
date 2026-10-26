import { createApp } from './app';
import { loadConfig } from './config/env';

/** Environment for this process, read once as the process starts. */
const config = loadConfig();

/** Running server. Listening starts when this module loads. */
const app = createApp(config).listen(config.port);

console.info(`Backend listening on port ${app.server?.port}`);

/**
 * True once shutdown has begun. A second signal while `app.stop()` is in
 * progress must not start another shutdown.
 */
let stopping = false;

/**
 * Closes the listener, waits for in-flight requests, then exits 0.
 * A call made after shutdown has started returns without doing anything.
 * Handles SIGTERM, which Docker and orchestrators send to process 1, and
 * SIGINT from Ctrl+C.
 */
async function shutdown(signal: 'SIGTERM' | 'SIGINT') {
  if (stopping) return;
  stopping = true;
  console.info(`Received ${signal}, shutting down`);
  await app.stop();
  process.exit(0);
}

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});
process.on('SIGINT', () => {
  void shutdown('SIGINT');
});

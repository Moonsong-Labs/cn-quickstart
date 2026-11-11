import { createApplication } from './bootstrap';

/** Marks configuration, authentication, or listener startup failures as unsuccessful exits. */
const STARTUP_FAILURE_EXIT_CODE = 1;

/** Allows 30 seconds for configuration, authentication, and listener startup together. */
const BACKEND_STARTUP_TIMEOUT_MS = 30_000;

/** Authenticates against the Ledger before listening and registers orderly shutdown handlers. */
async function main() {
  // Authenticate before accepting HTTP requests.
  const { app, config } = await createApplication();
  app.listen(config.port);
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
}

/** Forces exit on stalled startup so pending SDK connections cannot keep the process alive. */
const startupTimer = setTimeout(() => {
  console.error('Backend startup timed out');
  process.exit(STARTUP_FAILURE_EXIT_CODE);
}, BACKEND_STARTUP_TIMEOUT_MS);

try {
  await main();
} catch (error) {
  // SDK causes may include request credentials; only report the startup message.
  console.error(error instanceof Error ? error.message : 'Backend startup failed');
  process.exitCode = STARTUP_FAILURE_EXIT_CODE;
} finally {
  clearTimeout(startupTimer);
}

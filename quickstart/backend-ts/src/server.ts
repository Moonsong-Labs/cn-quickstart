import { createApplication } from './bootstrap';

/** Marks configuration, authentication, or listener startup failures as unsuccessful exits. */
const STARTUP_FAILURE_EXIT_CODE = 1;

/** Allows 30 seconds for configuration, authentication, and listener startup together. */
const BACKEND_STARTUP_TIMEOUT_MS = 30_000;

/** Authenticates against the Ledger before listening and registers orderly shutdown handlers. */
async function main() {
  const { app, config, pqs } = await createApplication();
  try {
    app.listen(config.port);
  } catch (error) {
    await pqs.end();
    throw error;
  }
  let stopping = false;
  async function shutdown(signal: 'SIGTERM' | 'SIGINT') {
    if (stopping) return;
    stopping = true;
    console.info(`Received ${signal}, shutting down`);
    let exitCode = 0;
    try {
      try {
        await app.stop();
      } finally {
        await pqs.end();
      }
    } catch {
      console.error('Backend shutdown failed');
      exitCode = 1;
    }
    process.exit(exitCode);
  }

  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });

  console.info(`Backend listening on port ${app.server?.port}`);
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

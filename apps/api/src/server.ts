/**
 * @fileoverview Implements the Fastify backend application boundary, runtime configuration or shared server behavior consumed by Edutex API modules.
 *
 * @remarks
 * Direct links: `./app.js`.
 * Security: Maintained source boundary; changes require strict type, test, lint, format and security review.
 */

import { startAlertWorker } from './modules/workflows/alert-worker.js';
import { buildApplication } from './app.js';

const server = await buildApplication();

/** Drains Fastify/database resources on process signals and forces exit if shutdown stalls. */
const shutdown = async (signal: string): Promise<void> => {
  server.log.info({ signal }, 'Graceful shutdown requested');
  const force = setTimeout(
    /** Derives the next immutable React state for `shutdown` from the previous value supplied by the state setter. Direct links: `process.exit`. */ () =>
      process.exit(1),
    20_000,
  );
  force.unref();
  await server.close();
  clearTimeout(force);
  process.exit(0);
};

process.once(
  'SIGINT',
  /** Performs the local `process.once` operation inside `server` and returns control to the surrounding feature only after this body completes. Direct links: `shutdown`. */ () =>
    void shutdown('SIGINT'),
);
process.once(
  'SIGTERM',
  /** Performs the local `process.once` operation inside `server` and returns control to the surrounding feature only after this body completes. Direct links: `shutdown`. */ () =>
    void shutdown('SIGTERM'),
);

try {
  await server.listen({ host: '0.0.0.0', port: server.configuration.port });
  startAlertWorker(server);
} catch (error) {
  server.log.fatal({ err: error }, 'Edutex API failed to start');
  process.exit(1);
}

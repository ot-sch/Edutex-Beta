/**
 * @fileoverview Implements the Fastify backend application boundary, runtime configuration or shared server behavior consumed by Edutex API modules.
 *
 * @remarks
 * Direct links: `node:fs/promises`, `@fastify/static`, `@edutex/database`, `fastify`, `./config.js`, `./modules/admin/routes.js`, `./modules/attendance/routes.js`, `./modules/audit/routes.js`, `/auth/`, `/auth`, `/app/`, `/app`, `/health/live`, `/health/ready`.
 * Security: Maintained source boundary; changes require strict type, test, lint, format and security review.
 */

import { resolve } from 'node:path';
import { access } from 'node:fs/promises';

import staticFiles from '@fastify/static';
import { closeDatabase, createDatabasePool, runInSystemTransaction } from '@edutex/database';
import Fastify, { type FastifyInstance } from 'fastify';

import { loadConfiguration, type ApplicationConfiguration } from './config.js';
import { registerAdminRoutes } from './modules/admin/routes.js';
import { registerAttendanceRoutes } from './modules/attendance/routes.js';
import { registerAuditRoutes } from './modules/audit/routes.js';
import { registerAuthenticationRoutes } from './modules/auth/routes.js';
import { createStores } from './modules/auth/session-store.js';
import { requireSession } from './modules/auth/session.js';
import { registerCryptoRoutes } from './modules/crypto/routes.js';
import { registerDashboardRoutes } from './modules/dashboard/routes.js';
import { registerFileRoutes } from './modules/files/routes.js';
import { registerResourceRoutes } from './modules/resources/routes.js';
import { registerTechnicianRoutes, requireTechnician } from './modules/workflows/technician.js';
import { registerMedicalRoutes } from './modules/workflows/medical.js';
import { registerPortalRoutes } from './modules/workflows/portals.js';
import { registerPreferenceRoutes } from './modules/workflows/preferences.js';
import { registerReportRoutes } from './modules/workflows/reports.js';
import { registerInsightRoutes } from './modules/workflows/insights.js';
import { registerAlertRoutes } from './modules/workflows/alerts.js';
import { registerWorkflowActions } from './modules/workflows/actions.js';
import { registerEventConsentRoutes } from './modules/workflows/event-consent.js';
import { registerLookupRoutes } from './modules/workflows/lookups.js';
import { registerSecurityPlugins } from './plugins/security.js';
import { releaseVersion } from './release.js';
import { sendError } from './shared/errors.js';

/** Returns whether a configured static-client directory is readable without exposing filesystem errors. */
async function directoryExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Mounts the public authentication bundle and session-protected portal bundle when built assets
 * are present. Portal HTML is always private/no-store; only Vite's hashed authentication assets
 * are immutable. Public root assets use a short cache so a logo or manifest can be replaced safely.
 */
async function registerWebClients(server: FastifyInstance): Promise<void> {
  const authExists = await directoryExists(server.configuration.authWebRoot);
  const portalExists = await directoryExists(server.configuration.portalWebRoot);

  if (authExists) {
    await server.register(staticFiles, {
      root: server.configuration.authWebRoot,
      prefix: '/auth/',
      index: ['index.html'],
      cacheControl: true,
      /** Implements `setHeaders` for implements the fastify backend application boundary, runtime configuration or shared server behavior consumed by edutex api modules. It receives `response`, `filePath`. Direct links: `filePath.endsWith`, `response.header`, `/[\\/]assets[\\/]/.test`. */ setHeaders:
        (response, filePath) => {
          if (filePath.endsWith('index.html')) {
            response.header('cache-control', 'no-store');
          } else if (/[\\/]assets[\\/]/.test(filePath)) {
            response.header('cache-control', 'public, max-age=31536000, immutable');
          } else {
            response.header('cache-control', 'public, max-age=300');
          }
        },
    });
    server.get(
      '/auth',
      /** Processes the GET `/auth` Fastify route and returns only its documented public or protected response. It receives `_request`, `reply`. Direct links: `reply.redirect`. */ async (
        _request,
        reply,
      ) => reply.redirect('/auth/', 308),
    );
  }

  if (portalExists) {
    await server.register(
      /** Performs the local `server.register` operation inside `registerWebClients` and returns control to the surrounding feature only after this body completes. It receives `protectedPortal`. Direct links: `protectedPortal.addHook`, `protectedPortal.register`, `protectedPortal.get`, `protectedPortal.setNotFoundHandler`. */ async (
        protectedPortal,
      ) => {
        protectedPortal.addHook('preHandler', requireSession);
        await protectedPortal.register(staticFiles, {
          root: server.configuration.portalWebRoot,
          prefix: '/app/',
          decorateReply: !authExists,
          index: ['index.html'],
          cacheControl: false,
          /** Implements `setHeaders` for implements the fastify backend application boundary, runtime configuration or shared server behavior consumed by edutex api modules. It receives `response`. Direct links: `response.header`. */ setHeaders:
            (response) => {
              response.header('cache-control', 'private, no-store');
            },
        });
        protectedPortal.get(
          '/app',
          /** Performs the local `protectedPortal.get` operation inside `registerWebClients` and returns control to the surrounding feature only after this body completes. It receives `_request`, `reply`. Direct links: `reply.redirect`. */ async (
            _request,
            reply,
          ) => reply.redirect('/app/', 308),
        );
        protectedPortal.setNotFoundHandler(
          /** Derives the next immutable React state for `registerWebClients` from the previous value supplied by the state setter. It receives `request`, `reply`. Direct links: `request.url.startsWith`, `reply.header`, `reply.sendFile`, `reply.status(404).send`, `reply.status`. */ async (
            request,
            reply,
          ) => {
            if (request.method === 'GET' && request.url.startsWith('/app/')) {
              reply.header('cache-control', 'private, no-store');
              return reply.sendFile('index.html', server.configuration.portalWebRoot);
            }
            return reply.status(404).send({
              statusCode: 404,
              code: 'NOT_FOUND',
              message: 'The requested resource was not found.',
              requestId: request.id,
            });
          },
        );
      },
    );
  }

  const technicianRoot = resolve(server.configuration.portalWebRoot, '../../technician-web/dist');
  if (await directoryExists(technicianRoot))
    await server.register(
      /** Coordinates app within app, preserving the caller's validation and error handling. */
      async (ict) => {
        ict.addHook('preHandler', requireSession);
        ict.addHook('preHandler', requireTechnician);
        await ict.register(staticFiles, {
          root: technicianRoot,
          prefix: '/technician/',
          decorateReply: !authExists && !portalExists,
          index: ['index.html'],
          cacheControl: false,

          /** Coordinates update Headers within app, preserving the caller's validation and error handling. */
          setHeaders: (response) => {
            response.header('cache-control', 'private, no-store');
          },
        });
        ict.get(
          '/technician',

          /** Coordinates app within app, preserving the caller's validation and error handling. */
          async (_request, reply) => reply.redirect('/technician/', 308),
        );
      },
    );

  server.get(
    '/',
    /** Processes the GET `/` Fastify route and returns only its documented public or protected response. It receives `_request`, `reply`. Direct links: `reply.redirect`. */ async (
      _request,
      reply,
    ) => reply.redirect('/auth/', 302),
  );
}

/** Builds the complete Fastify application without opening a network socket. */
export async function buildApplication(
  options: {
    readonly configuration?: ApplicationConfiguration;
    readonly initializeDatabase?: boolean;
  } = {},
): Promise<FastifyInstance> {
  const configuration = options.configuration ?? loadConfiguration();
  const server = Fastify({
    trustProxy: ['127.0.0.1', '::1'],
    logger: {
      level: configuration.logLevel,
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.headers.x-csrf-token',
          'res.headers.set-cookie',
          '*.password',
          '*.clientSecret',
          '*.access_token',
          '*.id_token',
          '*.refresh_token',
        ],
        censor: '[REDACTED]',
      },
    },
    requestIdHeader: false,
    /** Implements `genReqId` for implements the fastify backend application boundary, runtime configuration or shared server behavior consumed by edutex api modules. It receives `request`. Direct links: `/^[A-Za-z0-9-]{8,100}$/.test`, `crypto.randomUUID`. */ genReqId:
      (request) => {
        const edgeRequestId = request.headers['cf-ray'];
        return typeof edgeRequestId === 'string' && /^[A-Za-z0-9-]{8,100}$/.test(edgeRequestId)
          ? edgeRequestId
          : crypto.randomUUID();
      },
    bodyLimit: 1_100_000,
  });

  server.decorate('configuration', configuration);
  const stores = createStores(configuration);
  server.decorate('sessionStore', stores.sessionStore);
  server.decorate('transactionStore', stores.transactionStore);
  server.setErrorHandler(sendError);
  server.setNotFoundHandler(
    /** Derives the next immutable React state for `buildApplication` from the previous value supplied by the state setter. It receives `request`, `reply`. Direct links: `reply.status(404).send`, `reply.status`. */ (
      request,
      reply,
    ) =>
      reply.status(404).send({
        statusCode: 404,
        code: 'NOT_FOUND',
        message: 'The requested resource was not found.',
        requestId: request.id,
      }),
  );

  await registerSecurityPlugins(server);
  if (options.initializeDatabase !== false) await createDatabasePool();

  server.get(
    '/health/live',
    /** Processes the GET `/health/live` Fastify route and returns only its documented public or protected response. Direct links: `new Date().toISOString`. */ () => ({
      status: 'ok',
      service: 'edutex-api',
      version: releaseVersion,
      time: new Date().toISOString(),
    }),
  );
  server.get(
    '/health/ready',
    /** Processes the GET `/health/ready` Fastify route and returns only its documented public or protected response. It receives `_request`, `reply`. Direct links: `runInSystemTransaction`, `new Date().toISOString`, `server.log.error`, `reply.status(503).send`, `reply.status`. */ async (
      _request,
      reply,
    ) => {
      try {
        await runInSystemTransaction(
          /** Executes the `buildApplication` privileged database work on one controlled PostgreSQL transaction reserved for bootstrap/identity system operations. It receives `client`. Direct links: `client.query`. */ (
            client,
          ) => client.query('select 1'),
        );
        return {
          status: 'ok',
          service: 'edutex-api',
          version: releaseVersion,
          time: new Date().toISOString(),
        };
      } catch (error) {
        server.log.error({ err: error }, 'Readiness probe failed');
        return reply.status(503).send({
          status: 'degraded',
          service: 'edutex-api',
          version: releaseVersion,
          time: new Date().toISOString(),
        });
      }
    },
  );

  registerAuthenticationRoutes(server);
  registerDashboardRoutes(server);
  registerAttendanceRoutes(server);
  registerResourceRoutes(server);
  registerPreferenceRoutes(server);
  registerLookupRoutes(server);
  registerWorkflowActions(server);
  registerEventConsentRoutes(server);
  registerInsightRoutes(server);
  registerReportRoutes(server);
  registerAlertRoutes(server);
  registerPortalRoutes(server);
  registerMedicalRoutes(server);
  registerTechnicianRoutes(server);
  registerCryptoRoutes(server);
  registerFileRoutes(server);
  registerAuditRoutes(server);
  registerAdminRoutes(server);
  await registerWebClients(server);

  server.addHook(
    'onClose',
    /** Performs the local `server.addHook` operation inside `buildApplication` and returns control to the surrounding feature only after this body completes. Direct links: `closeDatabase`. */ async () =>
      closeDatabase(),
  );
  return server;
}

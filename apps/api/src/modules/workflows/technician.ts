/** @fileoverview Measures instance health and restricts technical configuration to the dedicated ICT role. */
import { performance } from 'node:perf_hooks';
import { runInTenantTransaction } from '@edutex/database';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requireSession, requireCsrf, requireRecentMfa } from '../auth/session.js';
import { authorize, contextFor } from './context.js';
import { ApplicationError } from '../../shared/errors.js';
import { releaseVersion } from '../../release.js';
/** Requires a current enabled technician grant and excludes community account categories. */
export function requireTechnician(request: FastifyRequest): Promise<void> {
  authorize(request, 'technician');
  if (['student', 'parent_guardian'].includes(requiredValue(request.identity).user.category))
    throw new ApplicationError(403, 'TECHNICIAN_REQUIRED', 'ICT access is required.');
  return Promise.resolve();
}
/** Exposes measurements without credentials, connection addresses, tokens or process environment values. */
export function registerTechnicianRoutes(server: FastifyInstance): void {
  server.get('/api/v1/technician/status', {
    preHandler: [requireSession, requireTechnician, requireRecentMfa],

    /** Handles /api/v1/technician/status using validated input and the route's authenticated authorization context. */
    handler: async (request) => {
      const start = performance.now();
      const result = await runInTenantTransaction(
        contextFor(request),

        /** Applies technician reads or writes with transaction-local tenant, actor and audit context. */
        async (client) =>
          client.query<{ status: { school: unknown; alerts: unknown; settings: unknown } }>(
            'select app.technician_status() as status',
          ),
      );
      return {
        version: releaseVersion,
        time: new Date().toISOString(),
        uptimeSeconds: Math.floor(process.uptime()),
        memoryMiB: Math.round(process.memoryUsage().rss / 1048576),
        database: { status: 'Connected', latencyMs: Math.round(performance.now() - start) },
        ...result.rows[0]?.status,
      };
    },
  });
  server.patch('/api/v1/technician/settings', {
    preHandler: [requireSession, requireTechnician, requireRecentMfa, requireCsrf],

    /** Handles /api/v1/technician/settings using validated input and the route's authenticated authorization context. */
    handler: async (request) => {
      authorize(request, 'technician', 'manage');
      const body = z
        .object({
          timezone: z.string().min(3).max(80),
          locale: z.string().min(2).max(35),
          rowVersion: z.number().int().positive(),
        })
        .strict()
        .parse(request.body);
      try {
        new Intl.DateTimeFormat(body.locale, { timeZone: body.timezone }).format(new Date());
      } catch {
        throw new ApplicationError(
          400,
          'REGION_INVALID',
          'Enter a supported timezone and language-region code.',
        );
      }
      const result = await runInTenantTransaction(
        contextFor(request),

        /** Applies technician reads or writes with transaction-local tenant, actor and audit context. */
        async (client) =>
          client.query<{ version: number }>(
            'select app.update_technical_region($1,$2,$3) as version',
            [body.timezone, body.locale, body.rowVersion],
          ),
      );
      return { rowVersion: Number(result.rows[0]?.version) };
    },
  });
}

import { requiredValue } from '@edutex/contracts';

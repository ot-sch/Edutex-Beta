/** @fileoverview Account-bound appearance and dashboard settings with optimistic concurrency and strict schemas. */
import { runInTenantTransaction } from '@edutex/database';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ApplicationError } from '../../shared/errors.js';
import { requireCsrf, requireSession } from '../auth/session.js';
import { contextFor } from './context.js';

const filters = z
  .object({
    campusIds: z.array(z.uuid()).max(100).default([]),
    yearLevels: z.array(z.string().max(30)).max(30).default([]),
    genders: z.array(z.string().max(50)).max(20).default([]),
  })
  .strict();
const schemas = {
  appearance: z.object({ theme: z.enum(['light', 'dark', 'system']) }).strict(),
  dashboard: z
    .object({
      filters,
      followUpColumn: z.enum(['movement', 'room', 'class', 'yearLevel']),
      hiddenMetrics: z
        .array(z.enum(['activeStudents', 'activeStaff', 'openAttendance', 'outstandingInvoices']))
        .max(4)
        .default([]),
    })
    .strict(),
  'record-columns': z
    .object({ columns: z.record(z.string().max(80), z.array(z.string().max(80)).max(40)) })
    .strict(),
};
const params = z.object({ namespace: z.enum(['appearance', 'dashboard', 'record-columns']) });

/** Registers preferences on the current account; user IDs are not accepted in the request. */
export function registerPreferenceRoutes(server: FastifyInstance): void {
  server.get('/api/v1/preferences/:namespace', {
    preHandler: [requireSession],

    /** Handles /api/v1/preferences/:namespace using validated input and the route's authenticated authorization context. */
    handler: async (request) => {
      const { namespace } = params.parse(request.params);
      const ctx = contextFor(request);
      const result = await runInTenantTransaction(
        ctx,

        /** Applies preferences reads or writes with transaction-local tenant, actor and audit context. */
        async (client) =>
          client.query<Record<string, unknown>>(
            'select preferences,row_version from app.user_preferences where tenant_id=$1 and user_id=$2 and namespace=$3',
            [ctx.tenantId, ctx.userId, namespace],
          ),
      );
      return {
        preferences: result.rows[0]?.['preferences'] ?? null,
        rowVersion: Number(result.rows[0]?.['row_version'] ?? 0),
      };
    },
  });
  server.put('/api/v1/preferences/:namespace', {
    preHandler: [requireSession, requireCsrf],

    /** Handles /api/v1/preferences/:namespace using validated input and the route's authenticated authorization context. */
    handler: async (request) => {
      const { namespace } = params.parse(request.params);
      const ctx = contextFor(request);
      const body = z
        .object({ preferences: z.unknown(), rowVersion: z.number().int().nonnegative() })
        .strict()
        .parse(request.body);
      const preferences = schemas[namespace].parse(body.preferences);
      const result = await runInTenantTransaction(
        ctx,

        /** Applies preferences reads or writes with transaction-local tenant, actor and audit context. */
        async (client) =>
          client.query<Record<string, unknown>>(
            `insert into app.user_preferences(tenant_id,user_id,namespace,preferences)
   select $1,$2,$3,$4::jsonb where $5::bigint=0
   on conflict(tenant_id,user_id,namespace) do nothing returning row_version`,
            [ctx.tenantId, ctx.userId, namespace, JSON.stringify(preferences), body.rowVersion],
          ),
      );
      if (body.rowVersion === 0) {
        if (!result.rows[0])
          throw new ApplicationError(
            409,
            'VERSION_CONFLICT',
            'Your preferences changed on another device. Reload before saving.',
          );
        return { preferences, rowVersion: Number(result.rows[0]['row_version']) };
      }
      const updated = await runInTenantTransaction(
        ctx,

        /** Applies preferences reads or writes with transaction-local tenant, actor and audit context. */
        async (client) =>
          client.query<Record<string, unknown>>(
            `update app.user_preferences set preferences=$4::jsonb
   where tenant_id=$1 and user_id=$2 and namespace=$3 and row_version=$5 returning row_version`,
            [ctx.tenantId, ctx.userId, namespace, JSON.stringify(preferences), body.rowVersion],
          ),
      );
      if (!updated.rows[0])
        throw new ApplicationError(
          409,
          'VERSION_CONFLICT',
          'Your preferences changed on another device. Reload before saving.',
        );
      return { preferences, rowVersion: Number(updated.rows[0]['row_version']) };
    },
  });
}

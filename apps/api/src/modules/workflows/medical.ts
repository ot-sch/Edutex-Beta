/** @fileoverview Per-child medical envelopes remain encrypted from browser to database and use scoped keys. */
import { encryptedFieldEnvelopeSchema, wrappedDataKeyRequestSchema } from '@edutex/contracts';
import { runInTenantTransaction } from '@edutex/database';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireSession, requireCsrf, requireRecentMfa } from '../auth/session.js';
import { TenantKeyService } from '../crypto/key-service.js';
import { contextFor } from './context.js';
import { ApplicationError } from '../../shared/errors.js';
/** Registers clinical reads, child-specific key exchange and versioned medical updates. */
export function registerMedicalRoutes(server: FastifyInstance): void {
  const keys = new TenantKeyService(server.configuration);
  server.post('/api/v1/medical/:studentId/key', {
    preHandler: [requireSession, requireCsrf, requireRecentMfa],
    config: {
      rateLimit: { max: 30, timeWindow: '5 minutes' },
    },

    /** Handles /api/v1/medical/:studentId/key using validated input and the route's authenticated authorization context. */
    handler: async (request) => {
      const { studentId } = z.object({ studentId: z.uuid() }).parse(request.params);
      const body = wrappedDataKeyRequestSchema.parse(request.body);
      return keys.wrapForBrowser(contextFor(request), body.clientPublicKey, body.keyId, studentId);
    },
  });
  server.get('/api/v1/medical/:studentId', {
    preHandler: [requireSession, requireRecentMfa],

    /** Handles /api/v1/medical/:studentId using validated input and the route's authenticated authorization context. */
    handler: async (request) => {
      const { studentId } = z.object({ studentId: z.uuid() }).parse(request.params);
      const ctx = contextFor(request);
      return runInTenantTransaction(
        ctx,

        /** Applies medical reads or writes with transaction-local tenant, actor and audit context. */
        async (client) => {
          const allowed = await client.query<{ read: boolean; write: boolean }>(
            'select app.medical_access($1) as read,app.medical_access($1,true) as write',
            [studentId],
          );
          if (!allowed.rows[0]?.read)
            throw new ApplicationError(
              404,
              'NOT_FOUND',
              'Medical access is unavailable or its scheduled window has ended.',
            );
          const record = (
            await client.query<Record<string, unknown>>(
              'select envelope,row_version,updated_at from app.medical_records where tenant_id=$1 and student_id=$2',
              [ctx.tenantId, studentId],
            )
          ).rows[0];
          await client.query<Record<string, unknown>>('select app.log_medical_read($1)', [
            studentId,
          ]);
          return { record: record ?? null, canEdit: allowed.rows[0].write };
        },
      );
    },
  });
  server.put('/api/v1/medical/:studentId', {
    preHandler: [requireSession, requireCsrf, requireRecentMfa],

    /** Handles /api/v1/medical/:studentId using validated input and the route's authenticated authorization context. */
    handler: async (request) => {
      const { studentId } = z.object({ studentId: z.uuid() }).parse(request.params);
      const body = z
        .object({
          envelope: encryptedFieldEnvelopeSchema,
          rowVersion: z.number().int().nonnegative(),
        })
        .strict()
        .parse(request.body);
      const ctx = contextFor(request);
      return runInTenantTransaction(
        ctx,

        /** Applies medical reads or writes with transaction-local tenant, actor and audit context. */
        async (client) => {
          const key = (
            await client.query<Record<string, unknown>>(
              'select id from app.medical_encryption_key($1,$2)',
              [studentId, body.envelope.keyId],
            )
          ).rows[0];
          if (!key)
            throw new ApplicationError(403, 'KEY_UNAVAILABLE', 'The medical key is not available.');
          const args = [
            ctx.tenantId,
            studentId,
            JSON.stringify(body.envelope),
            ctx.userId,
            body.rowVersion,
          ];
          const result =
            body.rowVersion === 0
              ? await client.query<Record<string, unknown>>(
                  'insert into app.medical_records(tenant_id,student_id,envelope,updated_by) values($1,$2,$3::jsonb,$4) on conflict do nothing returning row_version',
                  args.slice(0, 4),
                )
              : await client.query<Record<string, unknown>>(
                  'update app.medical_records set envelope=$3::jsonb,updated_by=$4 where tenant_id=$1 and student_id=$2 and row_version=$5 returning row_version',
                  args,
                );
          if (!result.rows[0])
            throw new ApplicationError(
              409,
              'VERSION_CONFLICT',
              'This medical record changed. Reload before saving.',
            );
          return { rowVersion: Number(result.rows[0]['row_version']) };
        },
      );
    },
  });
}

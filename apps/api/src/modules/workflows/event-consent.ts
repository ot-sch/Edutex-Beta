/** @fileoverview Staff paper-consent recording and printable event information retain immutable evidence and verified guardian relationships. */
import { runInTenantTransaction } from '@edutex/database';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireSession, requireCsrf, requireRecentMfa } from '../auth/session.js';
import { authorize, contextFor } from './context.js';
import { ApplicationError } from '../../shared/errors.js';
/** Registers read-only consent packs and deliberate, audited paper-consent decisions. */
export function registerEventConsentRoutes(server: FastifyInstance): void {
  server.get('/api/v1/events/:eventId/consent', {
    preHandler: [requireSession],

    /** Handles /api/v1/events/:eventId/consent using validated input and the route's authenticated authorization context. */
    handler: async (request) => {
      authorize(request, 'events');
      const { eventId } = z.object({ eventId: z.uuid() }).parse(request.params);
      const ctx = contextFor(request);
      return runInTenantTransaction(
        ctx,

        /** Applies event consent reads or writes with transaction-local tenant, actor and audit context. */
        async (client) => {
          const event = (
            await client.query<Record<string, unknown>>(
              'select id,title,starts_at,ends_at,location,description from app.events where tenant_id=$1 and id=$2',
              [ctx.tenantId, eventId],
            )
          ).rows[0];
          if (!event) throw new ApplicationError(404, 'NOT_FOUND', 'This event is unavailable.');
          const participants = await client.query<Record<string, unknown>>(
            `select p.student_id,s.first_name||' '||s.last_name as student,p.consent_status,p.consented_at from app.event_participants p join app.students s on s.tenant_id=p.tenant_id and s.id=p.student_id where p.tenant_id=$1 and p.event_id=$2 order by s.last_name,s.first_name`,
            [ctx.tenantId, eventId],
          );
          const evidence = await client.query<Record<string, unknown>>(
            'select student_id,decision,source,reference,recorded_at from app.consent_evidence where tenant_id=$1 and event_id=$2 order by recorded_at desc limit 500',
            [ctx.tenantId, eventId],
          );
          return { event, participants: participants.rows, evidence: evidence.rows };
        },
      );
    },
  });
  server.post('/api/v1/events/:eventId/paper-consent', {
    preHandler: [requireSession, requireCsrf, requireRecentMfa],

    /** Handles /api/v1/events/:eventId/paper-consent using validated input and the route's authenticated authorization context. */
    handler: async (request) => {
      authorize(request, 'events', 'edit');
      const { eventId } = z.object({ eventId: z.uuid() }).parse(request.params);
      const body = z
        .object({
          studentId: z.uuid(),
          guardianId: z.uuid(),
          decision: z.enum(['granted', 'declined', 'withdrawn']),
          reference: z.string().trim().min(5).max(500),
        })
        .strict()
        .parse(request.body);
      const ctx = contextFor(request);
      return runInTenantTransaction(
        ctx,

        /** Applies event consent reads or writes with transaction-local tenant, actor and audit context. */
        async (client) => {
          const guardian = await client.query<Record<string, unknown>>(
            `select id from app.guardian_relationships where tenant_id=$1 and student_id=$2 and guardian_id=$3 and can_consent and not restricted and valid_from<=current_date and (valid_until is null or valid_until>=current_date)`,
            [ctx.tenantId, body.studentId, body.guardianId],
          );
          if (!guardian.rows.length)
            throw new ApplicationError(
              409,
              'RELATIONSHIP_REQUIRED',
              'Verify the consenting guardian relationship and any restrictions first.',
            );
          const result = await client.query<Record<string, unknown>>(
            `update app.event_participants p set consent_status=$4,consented_by_guardian_id=$5,consented_at=clock_timestamp() from app.events e where p.tenant_id=$1 and p.event_id=$2 and p.student_id=$3 and e.tenant_id=p.tenant_id and e.id=p.event_id and e.status='published' and e.ends_at>clock_timestamp() returning p.id`,
            [ctx.tenantId, eventId, body.studentId, body.decision, body.guardianId],
          );
          if (!result.rows.length)
            throw new ApplicationError(
              409,
              'CONSENT_UNAVAILABLE',
              'Use a published, ongoing event with this student on its participant list.',
            );
          await client.query<Record<string, unknown>>(
            `insert into app.consent_evidence(tenant_id,event_id,student_id,guardian_id,decision,source,reference) values($1,$2,$3,$4,$5,'paper',$6)`,
            [ctx.tenantId, eventId, body.studentId, body.guardianId, body.decision, body.reference],
          );
          return { ok: true };
        },
      );
    },
  });
}

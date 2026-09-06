/**
 * @fileoverview Registers the audit HTTP API routes, validates untrusted requests and connects authenticated Fastify handlers to tenant-scoped services/PostgreSQL transactions.
 *
 * @remarks
 * Direct links: `@edutex/database`, `fastify`, `zod`, `../../shared/errors.js`, `../auth/session.js`, `/api/v1/audit/events`.
 * Security: Maintained source boundary; changes require strict type, test, lint, format and security review.
 */

import { runInTenantTransaction } from '@edutex/database';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { ApplicationError } from '../../shared/errors.js';
import { requirePermission, requireSession } from '../auth/session.js';

const auditQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  action: z.string().max(100).optional(),
  resourceType: z.string().max(100).optional(),
  actorUserId: z.uuid().optional(),
});

/** Registers immutable audit-log search without exposing before/after secrets. */
export function registerAuditRoutes(server: FastifyInstance): void {
  server.get('/api/v1/audit/events', {
    preHandler: [requireSession, requirePermission('audit:view')],
    /** Implements `handler` for registers the audit http api routes, validates untrusted requests and connects authenticated fastify handlers to tenant-scoped services/postgresql transactions. It receives `request`. Direct links: `auditQuerySchema.parse`, `values.push`, `predicates.push`, `runInTenantTransaction`, `result.rows.map`. */ handler:
      async (request) => {
        if (!request.identity)
          throw new ApplicationError(401, 'AUTHENTICATION_REQUIRED', 'Please sign in.');
        const identity = request.identity;
        const query = auditQuerySchema.parse(request.query);
        const values: unknown[] = [identity.user.tenantId];
        const predicates = ['tenant_id = $1'];
        if (query.action) {
          values.push(query.action);
          predicates.push(`action = $${values.length}`);
        }
        if (query.resourceType) {
          values.push(query.resourceType);
          predicates.push(`resource_type = $${values.length}`);
        }
        if (query.actorUserId) {
          values.push(query.actorUserId);
          predicates.push(`actor_user_id = $${values.length}`);
        }
        const filterValues = [...values];
        values.push(query.pageSize, (query.page - 1) * query.pageSize);
        const result = await runInTenantTransaction(
          {
            tenantId: identity.user.tenantId,
            userId: identity.user.id,
            permissions: identity.user.permissions,
            requestId: request.id,
          },
          /** Executes the `handler` database work on the same PostgreSQL client after transaction-local tenant/user/permission context is set, preserving RLS isolation. It receives `client`. Direct links: `client.query`, `predicates.join`, `Number`. */ async (
            client,
          ) => {
            const rows = await client.query<{
              id: string;
              occurred_at: Date;
              actor_user_id: string | null;
              action: string;
              resource_type: string;
              resource_id: string | null;
              request_id: string | null;
              outcome: string;
              metadata: Record<string, unknown>;
              event_hash: Buffer;
            }>(
              `select id, occurred_at, actor_user_id, action, resource_type, resource_id,
                    request_id, outcome, metadata, event_hash
             from audit.events
             where ${predicates.join(' and ')}
             order by occurred_at desc, sequence_number desc
             limit $${values.length - 1} offset $${values.length}`,
              values,
            );
            const count = await client.query<{ total: string }>(
              `select count(*)::text as total from audit.events where ${predicates.join(' and ')}`,
              filterValues,
            );
            return { rows: rows.rows, total: Number(count.rows[0]?.total ?? 0) };
          },
        );
        return {
          page: query.page,
          pageSize: query.pageSize,
          total: result.total,
          items: result.rows.map(
            /** Transforms each input item for `handler` into the derived value or React element consumed by the surrounding collection. It receives `row`. Direct links: `row.occurred_at.toISOString`, `row.event_hash.toString`. */ (
              row,
            ) => ({
              id: row.id,
              occurredAt: row.occurred_at.toISOString(),
              actorUserId: row.actor_user_id,
              action: row.action,
              resourceType: row.resource_type,
              resourceId: row.resource_id,
              requestId: row.request_id,
              outcome: row.outcome,
              metadata: row.metadata,
              eventHash: row.event_hash.toString('hex'),
            }),
          ),
        };
      },
  });
}

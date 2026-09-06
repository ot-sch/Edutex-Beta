/** @fileoverview Durable, bounded smart-alert evaluation with owner permissions, scheduled deduplication and delivery receipts. */
import { createHash } from 'node:crypto';
import { alertRuleSchema, matchesAlert, type AlertRule } from '@edutex/contracts';
import { runInTenantTransaction, type TenantDatabaseContext } from '@edutex/database';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireCsrf, requireSession } from '../auth/session.js';
import { refreshIdentity } from '../auth/identity-repository.js';
import { ApplicationError } from '../../shared/errors.js';
import { authorize, contextFor } from './context.js';
import { assertGroupShare, datasets, schoolWindow, datasetDay } from './insights.js';

const conditionFields: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  students: { status: 'r.status', yearLevel: 'r.year_level', studentId: 'r.id' },
  attendance: { status: 'r.status', classId: 's.class_id', studentId: 'r.student_id' },
  invoices: { status: 'r.status', amount: 'r.total', balanceDue: 'r.balance_due' },
  payments: { status: 'r.status', amount: 'r.amount' },
  payroll: { status: 'r.status', amount: 'r.gross_amount' },
  'purchase-orders': { status: 'r.status', amount: 'r.amount' },
  incidents: {
    status: 'r.status',
    studentId: 'r.student_id',
    category: 'r.category',
    severity: 'r.severity',
  },
  maintenance: { status: 'r.status', category: 'r.category', amount: 'r.cost' },
  'event-consent': { status: 'r.consent_status', studentId: 'r.student_id' },
  'sign-in-out': {
    status: 'r.status',
    studentId: 'r.student_id',
    parentApproved:
      "(r.requested_by_guardian_id is not null and r.status in ('approved','completed'))",
  },
};

/** Rejects unsupported field/operator combinations before rules can become active. */
function validateSource(rule: AlertRule): void {
  for (const condition of rule.conditions)
    if (!conditionFields[rule.source]?.[condition.field])
      throw new ApplicationError(
        400,
        'ALERT_FIELD_UNAVAILABLE',
        `${condition.field} is not available for ${rule.source}.`,
      );
  if (
    rule.countBy === 'distinct_days' &&
    !['attendance', 'sign-in-out', 'incidents'].includes(rule.source)
  )
    throw new ApplicationError(
      400,
      'ALERT_COUNT_UNAVAILABLE',
      'Distinct days is available for attendance, movement and incident rules.',
    );
}

/** Evaluates one rule under its owner's current permissions; large scans fail visibly instead of missing matches. */
export async function evaluateAlert(
  ctx: TenantDatabaseContext,
  id: string,
  rule: AlertRule,
  dryRun: boolean,
): Promise<{ matches: number; queued: number }> {
  validateSource(rule);
  const ds = requiredValue(datasets[rule.source]);
  if (
    !ctx.permissions.some(
      /** Selects ctx.permissions entries using the explicit ds.module view ds.module manage platform manage .includes p condition. */
      (p) => [`${ds.module}:view`, `${ds.module}:manage`, 'platform:manage'].includes(p),
    )
  )
    throw new ApplicationError(
      403,
      'ALERT_SOURCE_REVOKED',
      'The alert owner no longer has source access.',
    );
  return runInTenantTransaction(
    ctx,

    /** Applies alerts reads or writes with transaction-local tenant, actor and audit context. */
    async (client) => {
      await client.query<Record<string, unknown>>(
        'select pg_advisory_xact_lock(hashtextextended($1,71427))',
        [ctx.tenantId + ':' + id],
      );
      const window = await schoolWindow(client, rule.timeline);
      const fields = requiredValue(conditionFields[rule.source]);
      const projection = Object.entries(fields)
        .map(
          /** Transforms Object.entries fields entries into the alerts output representation. */
          ([key, sql]) => `'${key}',${sql}`,
        )
        .join(',');
      const result = await client.query<{
        id: string;
        student_id: string | null;
        day: string;
        fields: Record<string, unknown>;
      }>(
        `select ${ds.rowId ?? 'r.id::text'} as id,${ds.student ?? 'null::uuid'} as student_id,(${datasetDay(ds, '$4')})::text as day,jsonb_build_object(${projection}) as fields from ${ds.from}
   where r.tenant_id=$1 and (${datasetDay(ds, '$4')})>=$2::date and (${datasetDay(ds, '$4')})<$3::date and $4::text is not null order by ${ds.date},1 limit 10001`,
        [ctx.tenantId, window.start, window.end, window.timezone],
      );
      if (result.rows.length > 10000)
        throw new ApplicationError(
          422,
          'ALERT_SCAN_LIMIT',
          'This alert window contains too many records. Use a narrower scope.',
        );
      const buckets = new Map<string, typeof result.rows>();
      for (const row of result.rows) {
        if (!matchesAlert(rule, row.fields)) continue;
        const key = row.student_id ?? row.id;
        buckets.set(key, [...(buckets.get(key) ?? []), row]);
      }
      const matches = [...buckets.values()].filter(
        /** Selects ...buckets.values entries using the explicit rule.count By distinct days new Set rows.map row row.day .size rows.length rule.threshold condition. */
        (rows) =>
          (rule.countBy === 'distinct_days'
            ? new Set(
                rows.map(
                  /** Transforms rows entries into the alerts output representation. */
                  (row) => row.day,
                ),
              ).size
            : rows.length) >= rule.threshold,
      );
      let queued = 0;
      if (!dryRun)
        for (const rows of matches)
          for (const action of rule.actions) {
            const studentId = rows[0]?.student_id ?? null;
            const recipientRows = await client.query<{ id: string }>(
              'select * from app.alert_recipient_users($1::jsonb,$2)',
              [JSON.stringify(action), studentId],
            );
            if (recipientRows.rows.length > 500)
              throw new ApplicationError(
                400,
                'RECIPIENT_LIMIT',
                'Split this alert into smaller groups.',
              );
            const users = recipientRows.rows.map(
              /** Transforms recipient Rows.rows entries into the alerts output representation. */
              (row) => row.id,
            );
            for (const recipient of users) {
              const key = createHash('sha256')
                .update(
                  [
                    id,
                    window.start,
                    window.end,
                    rows[0]?.student_id ?? rows[0]?.id,
                    action.channel,
                    recipient,
                  ].join(':'),
                )
                .digest('hex');
              const insert = await client.query<Record<string, unknown>>(
                `insert into app.alert_deliveries(tenant_id,rule_id,recipient_user_id,student_id,channel,dedupe_key,title,detail,status)
     values($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict(tenant_id,dedupe_key) do nothing returning id`,
                [
                  ctx.tenantId,
                  id,
                  recipient,
                  studentId,
                  action.channel,
                  key,
                  'School follow-up required',
                  'A school workflow needs your attention. Open Edutex to view the records permitted for your account.',
                  action.channel === 'dashboard' ? 'sent' : 'queued',
                ],
              );
              queued += insert.rowCount ?? 0;
            }
          }
      if (!dryRun)
        await client.query<Record<string, unknown>>(
          'update app.smart_alert_rules set last_evaluated_at=clock_timestamp(),last_error_code=null where tenant_id=$1 and id=$2',
          [ctx.tenantId, id],
        );
      return { matches: matches.length, queued };
    },
  );
}

/** Registers a shortcuts-style alert definition API, safe dry runs and recipient-owned notifications. */
export function registerAlertRoutes(server: FastifyInstance): void {
  server.get('/api/v1/smart-alerts', {
    preHandler: [requireSession],

    /** Handles /api/v1/smart-alerts using validated input and the route's authenticated authorization context. */
    handler: async (request) => {
      authorize(request, 'smart-alerts');
      const ctx = contextFor(request);
      const result = await runInTenantTransaction(
        ctx,

        /** Applies alerts reads or writes with transaction-local tenant, actor and audit context. */
        async (client) =>
          client.query<Record<string, unknown>>(
            'select id,definition,owner_user_id,share_group_id,row_version,last_evaluated_at,last_error_code from app.smart_alert_rules where tenant_id=$1 order by updated_at desc limit 100',
            [ctx.tenantId],
          ),
      );
      return { items: result.rows };
    },
  });
  server.put('/api/v1/smart-alerts/:id', {
    preHandler: [requireSession, requireCsrf],

    /** Handles /api/v1/smart-alerts/:id using validated input and the route's authenticated authorization context. */
    handler: async (request) => {
      const { id } = z.object({ id: z.uuid() }).parse(request.params);
      const body = z
        .object({
          definition: alertRuleSchema,
          shareGroupId: z.uuid().nullable(),
          rowVersion: z.number().int().nonnegative(),
        })
        .strict()
        .parse(request.body);
      authorize(request, 'smart-alerts', body.rowVersion ? 'edit' : 'create');
      authorize(request, requiredValue(datasets[body.definition.source]).module);
      validateSource(body.definition);
      const ctx = contextFor(request);
      return runInTenantTransaction(
        ctx,

        /** Applies alerts reads or writes with transaction-local tenant, actor and audit context. */
        async (client) => {
          await assertGroupShare(client, ctx, body.shareGroupId);
          const args = [
            ctx.tenantId,
            id,
            ctx.userId,
            JSON.stringify(body.definition),
            body.shareGroupId,
            body.rowVersion,
          ];
          const result =
            body.rowVersion === 0
              ? await client.query<Record<string, unknown>>(
                  'insert into app.smart_alert_rules(tenant_id,id,owner_user_id,definition,share_group_id) values($1,$2,$3,$4::jsonb,$5) on conflict do nothing returning row_version',
                  args.slice(0, 5),
                )
              : await client.query<Record<string, unknown>>(
                  'update app.smart_alert_rules set definition=$4::jsonb,share_group_id=$5 where tenant_id=$1 and id=$2 and owner_user_id=$3 and row_version=$6 returning row_version',
                  args,
                );
          if (!result.rows[0])
            throw new ApplicationError(
              409,
              'VERSION_CONFLICT',
              'This alert changed elsewhere or is shared read-only.',
            );
          return { id, rowVersion: Number(result.rows[0]['row_version']) };
        },
      );
    },
  });
  server.post('/api/v1/smart-alerts/:id/evaluate', {
    preHandler: [requireSession, requireCsrf],

    /** Handles /api/v1/smart-alerts/:id/evaluate using validated input and the route's authenticated authorization context. */
    handler: async (request) => {
      authorize(request, 'smart-alerts', 'edit');
      const { id } = z.object({ id: z.uuid() }).parse(request.params);
      const { dryRun } = z
        .object({ dryRun: z.boolean().default(true) })
        .strict()
        .parse(request.body);
      const ctx = contextFor(request);
      const record = await runInTenantTransaction(
        ctx,

        /** Applies alerts reads or writes with transaction-local tenant, actor and audit context. */
        async (client) =>
          client.query<{ definition: unknown; owner_user_id: string }>(
            'select definition,owner_user_id from app.smart_alert_rules where tenant_id=$1 and id=$2 and owner_user_id=$3',
            [ctx.tenantId, id, ctx.userId],
          ),
      );
      const row = record.rows[0];
      if (!row) throw new ApplicationError(404, 'NOT_FOUND', 'This rule is not available.');
      const owner = await refreshIdentity(ctx.tenantId, ctx.userId);
      if (!owner)
        throw new ApplicationError(403, 'PERMISSION_DENIED', 'The account is not active.');
      const rule = alertRuleSchema.parse(row.definition);
      if (
        !owner.enabledModules.includes('smart-alerts') ||
        !owner.enabledModules.includes(requiredValue(datasets[rule.source]).module as never)
      )
        throw new ApplicationError(
          403,
          'MODULE_DISABLED',
          'The alert or source module is disabled.',
        );
      if (!dryRun && !rule.enabled)
        throw new ApplicationError(
          409,
          'ALERT_DISABLED',
          'Enable the saved rule before dispatching.',
        );
      return evaluateAlert({ ...ctx, permissions: owner.permissions }, id, rule, dryRun);
    },
  });
  server.get('/api/v1/notifications', {
    preHandler: [requireSession],

    /** Handles /api/v1/notifications using validated input and the route's authenticated authorization context. */
    handler: async (request) => {
      const ctx = contextFor(request);
      const result = await runInTenantTransaction(
        ctx,

        /** Applies alerts reads or writes with transaction-local tenant, actor and audit context. */
        async (client) =>
          client.query<Record<string, unknown>>(
            "select id,title,detail,created_at,read_at from app.alert_deliveries where tenant_id=$1 and recipient_user_id=$2 and channel='dashboard' order by created_at desc limit 100",
            [ctx.tenantId, ctx.userId],
          ),
      );
      return { items: result.rows };
    },
  });
  server.post('/api/v1/notifications/:id/read', {
    preHandler: [requireSession, requireCsrf],

    /** Handles /api/v1/notifications/:id/read using validated input and the route's authenticated authorization context. */
    handler: async (request) => {
      const ctx = contextFor(request);
      const { id } = z.object({ id: z.uuid() }).parse(request.params);
      await runInTenantTransaction(
        ctx,

        /** Applies alerts reads or writes with transaction-local tenant, actor and audit context. */
        async (client) =>
          client.query<Record<string, unknown>>(
            "update app.alert_deliveries set read_at=clock_timestamp(),status='read' where tenant_id=$1 and id=$2 and recipient_user_id=$3 and channel='dashboard'",
            [ctx.tenantId, id, ctx.userId],
          ),
      );
      return { ok: true };
    },
  });
}

import { requiredValue } from '@edutex/contracts';

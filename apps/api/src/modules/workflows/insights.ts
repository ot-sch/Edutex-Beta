/** @fileoverview Permission-checked, allowlisted aggregate queries and account/group dashboards. */
import {
  dashboardDefinitionSchema,
  tileSchema,
  timelineSchema,
  timelineWindow,
  metricFields,
  type InsightTile,
} from '@edutex/contracts';
import { runInTenantTransaction, type TenantDatabaseContext } from '@edutex/database';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requireCsrf, requireSession } from '../auth/session.js';
import { ApplicationError } from '../../shared/errors.js';
import { authorize, contextFor } from './context.js';

type Client = Parameters<Parameters<typeof runInTenantTransaction>[1]>[0];
export const datasets: Readonly<
  Record<
    string,
    {
      module: string;
      from: string;
      date: string;
      dateOnly?: boolean;
      rowId?: string;
      currency?: string;
      search: string;
      status: string;
      fields: Readonly<Record<string, string>>;
      student?: string;
    }
  >
> = {
  students: {
    module: 'students',
    from: 'app.students r',
    date: 'r.created_at',
    search: "r.first_name || ' ' || r.last_name",
    status: 'r.status',
    fields: { count: 'count(*)' },
    student: 'r.id',
  },
  attendance: {
    module: 'attendance',
    from: 'app.attendance_marks r join app.attendance_sessions s on s.tenant_id=r.tenant_id and s.id=r.attendance_session_id',
    date: 's.session_date',
    dateOnly: true,
    rowId: 'r.attendance_session_id::text || r.student_id::text',
    search: 's.session_label',
    status: 'r.status',
    fields: {
      count: 'count(*)',
      present: "count(*) filter(where r.status='present')",
      absent: "count(*) filter(where r.status='absent')",
      late: "count(*) filter(where r.status='late')",
    },
    student: 'r.student_id',
  },
  invoices: {
    currency: 'r.currency_code',
    module: 'finance',
    from: 'app.invoices r',
    date: 'r.issue_date',
    dateOnly: true,
    search: 'r.invoice_number',
    status: 'r.status',
    fields: {
      count: 'count(*)',
      total: 'coalesce(sum(r.total),0)',
      taxTotal: 'coalesce(sum(r.tax_total),0)',
      balanceDue: 'coalesce(sum(r.balance_due),0)',
    },
  },
  payments: {
    currency: 'r.currency_code',
    module: 'finance',
    from: 'app.payments r',
    date: 'r.received_at',
    search: 'r.payment_reference',
    status: 'r.status',
    fields: { count: 'count(*)', amount: 'coalesce(sum(r.amount),0)' },
  },
  payroll: {
    module: 'finance',
    from: 'app.payroll_lines r',
    date: 'r.period_start',
    dateOnly: true,
    search: "coalesce(r.notes,'')",
    status: 'r.status',
    fields: {
      count: 'count(*)',
      grossAmount: 'coalesce(sum(r.gross_amount),0)',
      taxTotal: 'coalesce(sum(r.tax_total),0)',
    },
  },
  'purchase-orders': {
    module: 'finance',
    from: 'app.purchase_orders r',
    date: 'r.created_at',
    search: 'r.reference',
    status: 'r.status',
    fields: {
      count: 'count(*)',
      amount: 'coalesce(sum(r.amount),0)',
      taxTotal: 'coalesce(sum(r.tax_total),0)',
    },
  },
  incidents: {
    module: 'risk',
    from: 'app.risk_incidents r',
    date: 'r.occurred_at',
    search: 'r.category',
    status: 'r.status',
    fields: { count: 'count(*)' },
    student: 'r.student_id',
  },
  maintenance: {
    module: 'maintenance',
    from: 'app.work_orders r',
    date: 'r.due_on',
    dateOnly: true,
    search: 'r.title',
    status: 'r.status',
    fields: { count: 'count(*)', cost: 'coalesce(sum(r.cost),0)' },
  },
  'event-consent': {
    module: 'events',
    from: "app.event_participants r join app.events e on e.tenant_id=r.tenant_id and e.id=r.event_id and e.status='published'",
    date: 'e.starts_at',
    search: 'e.title',
    status: 'r.consent_status',
    fields: { count: 'count(*)' },
    student: 'r.student_id',
  },
  'sign-in-out': {
    module: 'sign-in-out',
    from: 'app.sign_in_out_requests r',
    date: 'r.effective_at',
    search: 'r.request_type',
    status: 'r.status',
    fields: { count: 'count(*)' },
    student: 'r.student_id',
  },
};

/** Uses local school dates for timestamps and retains date-only values without timezone shifts. */
export function datasetDay(
  ds: { date: string; dateOnly?: boolean },
  timezoneParameter: string,
): string {
  return ds.dateOnly ? ds.date + '::date' : `(${ds.date} at time zone ${timezoneParameter})::date`;
}

/** Determines the current school date and the active term without relying on the server's UTC date. */
export async function schoolWindow(
  client: Client,
  scope: z.infer<typeof timelineSchema>,
  today?: string,
): Promise<{ start: string; end: string; timezone: string }> {
  const context = (
    await client.query<{ context: { timezone: string } }>(
      'select app.school_display_context() as context',
    )
  ).rows[0]?.context;
  const timezone = context?.timezone ?? 'Australia/Melbourne';
  const date = today ?? new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date());
  const term =
    scope === 'termly'
      ? (
          await client.query<{ startsOn: string; endsOn: string }>(
            `select starts_on::text as "startsOn",ends_on::text as "endsOn" from app.terms where tenant_id=app.current_tenant_id() and starts_on<=$1::date and ends_on>=$1::date order by starts_on desc limit 1`,
            [date],
          )
        ).rows[0]
      : undefined;
  try {
    return { ...timelineWindow(scope, date, term), timezone };
  } catch (reason) {
    throw new ApplicationError(
      400,
      'TIMELINE_UNAVAILABLE',
      reason instanceof Error ? errorMessage(reason) : 'Set up school term dates.',
    );
  }
}

/** Evaluates each tile under the viewer's current source permissions; sharing never grants source access. */
async function evaluateTile(
  request: FastifyRequest,
  tile: InsightTile,
  timeline: z.infer<typeof timelineSchema>,
  today?: string,
): Promise<unknown> {
  for (const term of tile.terms) authorize(request, requiredValue(datasets[term.source]).module);
  return runInTenantTransaction(
    contextFor(request),

    /** Applies insights reads or writes with transaction-local tenant, actor and audit context. */
    async (client) => {
      const window = await schoolWindow(
        client,
        tile.timeline === 'interchangeable' ? timeline : tile.timeline,
        today,
      );
      const points = new Map<string, number>();
      for (const term of tile.terms) {
        const ds = requiredValue(datasets[term.source]);
        const aggregate = ds.fields[term.field];
        if (!aggregate)
          throw new ApplicationError(400, 'FIELD_UNAVAILABLE', 'This field cannot be aggregated.');
        const day = datasetDay(ds, '$6');
        const monetary = !['count', 'present', 'absent', 'late'].includes(term.field);
        const result = await client.query<{ date: string; value: string }>(
          `select (${day})::text as date,(${aggregate})::text as value
    from ${ds.from} where r.tenant_id=$1 and (${day}) >= $2::date and (${day}) < $3::date and $6::text is not null
    and ($7::text is null or ${ds.currency ?? "'AUD'"}=$7::text) and (cardinality($4::text[])=0 or ${ds.status}=any($4::text[])) and (${ds.search}) ilike $5
    group by 1 order by 1`,
          [
            requiredValue(request.identity).user.tenantId,
            window.start,
            window.end,
            tile.status,
            '%' +
              tile.search.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_') +
              '%',
            window.timezone,
            monetary ? tile.currencyCode : null,
          ],
        );
        for (const point of result.rows)
          points.set(point.date, (points.get(point.date) ?? 0) + Number(point.value));
      }
      const rows = [...points]
        .sort(
          /** Coordinates insights within insights, preserving the caller's validation and error handling. */
          ([a], [b]) => a.localeCompare(b),
        )
        .map(
          /** Transforms ...points .sort a b a.locale Compare b entries into the insights output representation. */
          ([date, value]) => ({ date, value }),
        );
      return {
        id: tile.id,
        title: tile.title,
        total: rows.reduce(
          /** Coordinates insights within insights, preserving the caller's validation and error handling. */
          (sum, row) => sum + row.value,
          0,
        ),
        points: rows,
        window,
        currencyCode: tile.terms.some(
          /** Selects tile.terms entries using the explicit count present absent late .includes term.field condition. */
          (term) => !['count', 'present', 'absent', 'late'].includes(term.field),
        )
          ? tile.currencyCode
          : null,
      };
    },
  );
}

/** Checks that a dashboard owner actually manages the proposed recipient group. */
export async function assertGroupShare(
  client: Client,
  ctx: TenantDatabaseContext,
  groupId: string | null,
): Promise<void> {
  if (!groupId) return;
  const result = await client.query<{ allowed: boolean }>(
    `select exists(select 1 from app.group_members where tenant_id=$1 and group_id=$2 and user_id=$3 and role='manager' and valid_from<=clock_timestamp() and (valid_until is null or valid_until>clock_timestamp())) or app.has_permission('management:manage') as allowed`,
    [ctx.tenantId, groupId, ctx.userId],
  );
  if (!result.rows[0]?.allowed)
    throw new ApplicationError(
      403,
      'GROUP_MANAGEMENT_REQUIRED',
      'You must manage a group to publish a dashboard or alert to it.',
    );
}

/** Registers personal dashboard persistence, sharing and safe aggregate evaluation. */
export function registerInsightRoutes(server: FastifyInstance): void {
  server.get('/api/v1/insights/catalogue', {
    preHandler: [requireSession],

    /** Handles /api/v1/insights/catalogue using validated input and the route's authenticated authorization context. */
    handler: (request) => {
      authorize(request, 'insights');
      return {
        sources: Object.entries(metricFields)
          .filter(
            /** Selects Object.entries metric Fields entries using the explicit try authorize request required Value datasets source .module return true catch return false condition. */
            ([source]) => {
              try {
                authorize(request, requiredValue(datasets[source]).module);
                return true;
              } catch {
                return false;
              }
            },
          )
          .map(
            /** Transforms Object.entries metric Fields .filter source try authorize request required Value datasets source .module return true catch return false entries into the insights output representation. */
            ([source, fields]) => ({ source, fields }),
          ),
      };
    },
  });
  server.get('/api/v1/insights/dashboards', {
    preHandler: [requireSession],

    /** Handles /api/v1/insights/dashboards using validated input and the route's authenticated authorization context. */
    handler: async (request) => {
      authorize(request, 'insights');
      const ctx = contextFor(request);
      const result = await runInTenantTransaction(
        ctx,

        /** Applies insights reads or writes with transaction-local tenant, actor and audit context. */
        async (client) =>
          client.query<Record<string, unknown>>(
            'select id,owner_user_id,share_group_id,definition,row_version from app.insight_dashboards where tenant_id=$1 order by updated_at desc limit 100',
            [ctx.tenantId],
          ),
      );
      return { items: result.rows };
    },
  });
  server.put('/api/v1/insights/dashboards/:id', {
    preHandler: [requireSession, requireCsrf],

    /** Handles /api/v1/insights/dashboards/:id using validated input and the route's authenticated authorization context. */
    handler: async (request) => {
      const { id } = z.object({ id: z.uuid() }).parse(request.params);
      const body = z
        .object({
          definition: dashboardDefinitionSchema,
          shareGroupId: z.uuid().nullable(),
          rowVersion: z.number().int().nonnegative(),
        })
        .strict()
        .parse(request.body);
      authorize(request, 'insights', body.rowVersion ? 'edit' : 'create');
      for (const tile of body.definition.tiles)
        for (const term of tile.terms)
          authorize(request, requiredValue(datasets[term.source]).module);
      const ctx = contextFor(request);
      return runInTenantTransaction(
        ctx,

        /** Applies insights reads or writes with transaction-local tenant, actor and audit context. */
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
                  `insert into app.insight_dashboards(tenant_id,id,owner_user_id,definition,share_group_id) values($1,$2,$3,$4::jsonb,$5) on conflict do nothing returning row_version`,
                  args.slice(0, 5),
                )
              : await client.query<Record<string, unknown>>(
                  `update app.insight_dashboards set definition=$4::jsonb,share_group_id=$5 where tenant_id=$1 and id=$2 and owner_user_id=$3 and row_version=$6 returning row_version`,
                  args,
                );
          if (!result.rows[0])
            throw new ApplicationError(
              409,
              'VERSION_CONFLICT',
              'This dashboard changed elsewhere or is shared read-only.',
            );
          return { id, rowVersion: Number(result.rows[0]['row_version']) };
        },
      );
    },
  });
  server.post('/api/v1/insights/evaluate', {
    preHandler: [requireSession, requireCsrf],

    /** Handles /api/v1/insights/evaluate using validated input and the route's authenticated authorization context. */
    handler: async (request) => {
      authorize(request, 'insights');
      const body = z
        .object({
          tiles: z.array(tileSchema).max(30),
          timeline: timelineSchema,
          today: z.iso.date().optional(),
        })
        .strict()
        .parse(request.body);
      const items = [];
      for (const tile of body.tiles) {
        try {
          items.push(await evaluateTile(request, tile, body.timeline, body.today));
        } catch (reason) {
          if (!(reason instanceof ApplicationError)) throw reason;
          items.push({ id: tile.id, error: errorMessage(reason) });
        }
      }
      return { items };
    },
  });
}

import { requiredValue } from '@edutex/contracts';

import { errorMessage } from '@edutex/contracts';

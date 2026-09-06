/** @fileoverview Atomic, tenant-scoped finance and event workflow transitions with peer approval and version checks. */
import { grossPay, moneyToCents, workflowActions, resourceNameSchema } from '@edutex/contracts';
import { runInTenantTransaction } from '@edutex/database';
import type { FastifyInstance } from 'fastify';
type PoolClient = Parameters<Parameters<typeof runInTenantTransaction>[1]>[0];
import { z } from 'zod';
import { postWorkflowJournal } from './ledger.js';
import { ApplicationError } from '../../shared/errors.js';
import { requireCsrf, requireRecentMfa, requireSession } from '../auth/session.js';
import { resourceRegistry } from '../resources/registry.js';
import { authorize, contextFor, identifier } from './context.js';

type Row = Record<string, unknown>;
/** Rejects a failed business condition without exposing database internals. */
function ensure(condition: unknown, message: string): asserts condition {
  if (!condition) throw new ApplicationError(409, 'WORKFLOW_REQUIREMENT', message);
}

/** Evaluates the next required event-risk approval using current configured streams and membership. */
async function approveEvent(
  client: PoolClient,
  tenantId: string,
  userId: string,
  row: Row,
): Promise<boolean> {
  const risks = await client.query<Row>(
    'select residual_likelihood*residual_impact as score from app.event_risks where tenant_id=$1 and event_plan_id=$2',
    [tenantId, row['id']],
  );
  ensure(risks.rows.length > 0, 'Complete at least one specific risk assessment before approval.');
  const score = Math.max(
    ...risks.rows.map(
      /** Transforms risks.rows entries into the actions output representation. */
      (r) => Number(r['score']),
    ),
  );
  const streams = await client.query<Row>(
    `select s.id,s.approver_group_id,app.user_in_group(s.approver_group_id,$4) as eligible
  from app.approval_streams s where s.tenant_id=$1 and s.active and s.minimum_risk_score<=$3
  and (cardinality(s.hazards)=0 or s.hazards && $5::text[])
  and not exists(select 1 from app.event_approvals a where a.tenant_id=s.tenant_id and a.event_plan_id=$2 and a.stream_id=s.id)
  order by s.sequence_number,s.id`,
    [tenantId, row['id'], score, userId, row['hazards']],
  );
  const next = streams.rows[0];
  if (next)
    ensure(next['eligible'], 'The next approval belongs to a different configured risk group.');
  await client.query<Record<string, unknown>>(
    'insert into app.event_approvals(tenant_id,event_plan_id,stream_id,approved_by,plan_version) values($1,$2,$3,$4,$5)',
    [tenantId, row['id'], next?.['id'] ?? null, userId, row['row_version']],
  );
  return streams.rows.length <= 1;
}

/** Registers bounded transition actions. A generic record PATCH cannot set workflow state. */
export function registerWorkflowActions(server: FastifyInstance): void {
  server.post('/api/v1/workflows/:resource/:id/:action', {
    preHandler: [requireSession, requireCsrf, requireRecentMfa],

    /** Handles /api/v1/workflows/:resource/:id/:action using validated input and the route's authenticated authorization context. */
    handler: async (request) => {
      const { resource, id, action } = z
        .object({ resource: resourceNameSchema, id: z.uuid(), action: z.string().max(40) })
        .parse(request.params);
      const rule = workflowActions[resource]?.[action];
      ensure(rule, 'This workflow action is not supported.');
      const body = z
        .object({
          rowVersion: z.number().int().positive(),
          note: z.string().trim().min(3).max(1000),
          paymentReference: z.string().trim().max(160).optional(),
        })
        .strict()
        .parse(request.body);
      const config = resourceRegistry[resource];
      authorize(request, config.permissionModule, rule.permission);
      const ctx = contextFor(request);
      return runInTenantTransaction(
        ctx,

        /** Applies actions reads or writes with transaction-local tenant, actor and audit context. */
        async (client) => {
          const result = await client.query<Row>(
            `select * from app.${identifier(config.table)} where tenant_id=$1 and id=$2 for update`,
            [ctx.tenantId, id],
          );
          const row = result.rows[0];
          ensure(
            row && Number(row['row_version']) === body.rowVersion,
            'This record changed or is outside your access. Refresh before continuing.',
          );
          ensure(
            rule.from.includes(String(row['status'])),
            'This action is not available at the current stage.',
          );
          if (rule.peer)
            ensure(
              row['created_by'] !== ctx.userId,
              'A different authorised person must approve a record you created.',
            );
          let nextStatus = rule.to;
          let extraSql = '';
          const extra: unknown[] = [];
          if (resource === 'event-plans' && ['submit', 'approve'].includes(action)) {
            ensure(
              Number(row['staff_count']) * Number(row['students_per_staff']) >=
                Number(row['student_count']),
              'The planned supervision ratio is insufficient.',
            );
            ensure(
              row['return_to_work_checked'],
              'Confirm that authorised staff have checked supervision and return-to-work restrictions.',
            );
            const venue = await client.query<Row>(
              'select emergency_phone,hospital,police,emergency_plan from app.venues where tenant_id=$1 and id=$2',
              [ctx.tenantId, row['venue_id']],
            );
            ensure(
              venue.rows[0] &&
                ['emergency_phone', 'hospital', 'police', 'emergency_plan'].every(
                  /** Selects emergency phone hospital police emergency plan entries using the explicit scalar Text venue.rows 0 . key .trim condition. */
                  (key) => scalarText(venue.rows[0]?.[key] ?? '').trim(),
                ),
              'Complete venue emergency contacts and the emergency plan.',
            );
            if (
              action === 'approve' &&
              !(await approveEvent(client, ctx.tenantId, ctx.userId, row))
            )
              nextStatus = 'risk_review';
          }
          if (resource === 'event-plans' && action === 'reject')
            await client.query<Record<string, unknown>>(
              'delete from app.event_approvals where tenant_id=$1 and event_plan_id=$2',
              [ctx.tenantId, id],
            );
          if (resource === 'purchase-orders' && action === 'approve') {
            ensure(
              moneyToCents(row['amount']) > 0n,
              'The purchase amount must be greater than zero.',
            );
            if (row['budget_id']) {
              const budget = await client.query<Row>(
                'select amount,account_id from app.budgets where tenant_id=$1 and id=$2 for update',
                [ctx.tenantId, row['budget_id']],
              );
              ensure(
                budget.rows[0] && budget.rows[0]['account_id'] === row['account_id'],
                'The budget must match the purchase GL account.',
              );
              const committed = await client.query<Row>(
                `select coalesce(sum(amount+tax_total),0)::text as total from app.purchase_orders where tenant_id=$1 and budget_id=$2 and status in ('approved','received','invoiced','paid')`,
                [ctx.tenantId, row['budget_id']],
              );
              ensure(
                moneyToCents(committed.rows[0]?.['total'] ?? '0') +
                  moneyToCents(row['amount']) +
                  moneyToCents(row['tax_total']) <=
                  moneyToCents(budget.rows[0]['amount']),
                'This purchase exceeds the remaining budget. Review and amend the approved budget first.',
              );
            }
          }
          if (resource === 'supplier-bills' && ['match', 'approve', 'pay'].includes(action)) {
            const po = (
              await client.query<Row>(
                'select * from app.purchase_orders where tenant_id=$1 and id=$2 for update',
                [ctx.tenantId, row['purchase_order_id']],
              )
            ).rows[0];
            ensure(
              po && ['received', 'invoiced'].includes(String(po['status'])),
              'Confirm receipt of the purchase order before matching the supplier bill.',
            );
            ensure(
              po['supplier_id'] === row['supplier_id'],
              'The supplier does not match the purchase order.',
            );
            ensure(
              moneyToCents(po['amount']) === moneyToCents(row['amount']) &&
                moneyToCents(po['tax_total']) === moneyToCents(row['tax_total']),
              'The supplier bill must match the received purchase order amount and GST.',
            );
            if (action === 'pay') {
              ensure(
                body.paymentReference && body.paymentReference.length >= 3,
                'Record the verified external payment reference.',
              );
              extraSql = ',payment_reference=$5';
              extra.push(body.paymentReference);
              await client.query<Record<string, unknown>>(
                "update app.purchase_orders set status='paid' where tenant_id=$1 and id=$2",
                [ctx.tenantId, po['id']],
              );
            }
          }
          if (resource === 'invoices') {
            if (action === 'issue') extraSql = ',balance_due=subtotal+tax_total';
            if (action === 'void') {
              const paid = await client.query<Row>(
                "select id from app.payments where tenant_id=$1 and invoice_id=$2 and status='settled' limit 1",
                [ctx.tenantId, id],
              );
              ensure(
                !paid.rows.length,
                'A paid invoice requires a reviewed credit/reversal, not voiding.',
              );
              extraSql = ',balance_due=0';
            }
          }
          if (resource === 'payments' && action === 'settle') {
            ensure(moneyToCents(row['amount']) > 0n, 'A receipt must be positive.');
            if (row['invoice_id']) {
              const invoice = (
                await client.query<Row>(
                  'select * from app.invoices where tenant_id=$1 and id=$2 for update',
                  [ctx.tenantId, row['invoice_id']],
                )
              ).rows[0];
              ensure(
                invoice && ['issued', 'part_paid', 'overdue'].includes(String(invoice['status'])),
                'Select an issued invoice with an outstanding balance.',
              );
              ensure(
                invoice['currency_code'] === row['currency_code'],
                'Receipt and invoice currencies must match.',
              );
              ensure(
                moneyToCents(row['amount']) <= moneyToCents(invoice['balance_due']),
                'The receipt exceeds the invoice balance; allocate the exact amount first.',
              );
            }
          }
          if (resource === 'bank-transactions' && ['match', 'reconcile'].includes(action)) {
            ensure(row['payment_id'], 'Choose the matching receipt before reconciliation.');
            const receipt = (
              await client.query<Row>(
                'select amount,status from app.payments where tenant_id=$1 and id=$2',
                [ctx.tenantId, row['payment_id']],
              )
            ).rows[0];
            ensure(
              receipt?.['status'] === 'settled' &&
                moneyToCents(receipt['amount']) === moneyToCents(row['amount']),
              'The bank amount must match a settled receipt exactly.',
            );
          }
          if (resource === 'payroll-lines' && action === 'approve') {
            const gross = grossPay(
              Number(row['ordinary_minutes']),
              Number(row['overtime_minutes']),
              row['hourly_rate'],
              row['overtime_rate'],
            );
            ensure(
              moneyToCents(row['tax_total']) <= moneyToCents(gross),
              'Withholding cannot exceed gross pay.',
            );
            extraSql = ',gross_amount=$5';
            extra.push(gross);
          }
          if (resource === 'payroll-lines' && action === 'pay') {
            ensure(
              body.paymentReference && body.paymentReference.length >= 3,
              'Record the verified payroll payment reference.',
            );
            extraSql = ',payment_reference=$5';
            extra.push(body.paymentReference);
          }
          await postWorkflowJournal(client, ctx.tenantId, ctx.userId, resource, action, row);
          // Intermediate approvals append history without rewriting a locked plan at the same status.
          if (nextStatus !== row['status'])
            await client.query<Record<string, unknown>>(
              `update app.${identifier(config.table)} set status=$3${extraSql} where tenant_id=$1 and id=$2 and row_version=$4`,
              [ctx.tenantId, id, nextStatus, body.rowVersion, ...extra],
            );
          await client.query<Record<string, unknown>>(
            `insert into app.workflow_history(tenant_id,resource,record_id,action,from_status,to_status,actor_user_id,note) values($1,$2,$3,$4,$5,$6,$7,$8)`,
            [ctx.tenantId, resource, id, action, row['status'], nextStatus, ctx.userId, body.note],
          );
          return { status: nextStatus };
        },
      );
    },
  });
  server.get('/api/v1/workflows/:resource/:id/history', {
    preHandler: [requireSession],

    /** Handles /api/v1/workflows/:resource/:id/history using validated input and the route's authenticated authorization context. */
    handler: async (request) => {
      const { resource, id } = z
        .object({ resource: resourceNameSchema, id: z.uuid() })
        .parse(request.params);
      const config = resourceRegistry[resource];
      authorize(request, config.permissionModule);
      const ctx = contextFor(request);
      const result = await runInTenantTransaction(
        ctx,

        /** Applies actions reads or writes with transaction-local tenant, actor and audit context. */
        async (client) =>
          client.query<Record<string, unknown>>(
            `select h.action,h.from_status,h.to_status,h.occurred_at,h.note,u.display_name as actor from app.workflow_history h left join app.users u on u.tenant_id=h.tenant_id and u.id=h.actor_user_id where h.tenant_id=$1 and h.resource=$2 and h.record_id=$3 order by h.occurred_at,h.id`,
            [ctx.tenantId, resource, id],
          ),
      );
      return { items: result.rows };
    },
  });
}

import { scalarText } from '@edutex/contracts';

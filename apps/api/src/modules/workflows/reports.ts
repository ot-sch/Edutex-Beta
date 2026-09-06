/** @fileoverview Allowlisted accounting reports from authoritative balances and posted journal data. */
import { runInTenantTransaction } from '@edutex/database';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireSession, requireCsrf, requireRecentMfa } from '../auth/session.js';
import { authorize, contextFor } from './context.js';
import { ApplicationError } from '../../shared/errors.js';
export const financeReports: Readonly<Record<string, { label: string; sql: string }>> = {
  'income-statement': {
    label: 'Income statement',
    sql: `select j.currency_code,a.account_code,a.name,a.account_type,sum(l.credit_amount-l.debit_amount)::text as amount from app.journal_lines l join app.journal_entries j on j.tenant_id=l.tenant_id and j.id=l.journal_entry_id join app.chart_of_accounts a on a.tenant_id=l.tenant_id and a.id=l.account_id where l.tenant_id=$1 and j.status='posted' and j.journal_date between $2::date and $3::date and a.account_type in ('revenue','expense') group by j.currency_code,a.account_code,a.name,a.account_type order by a.account_code`,
  },
  'trial-balance': {
    label: 'Trial balance',
    sql: `select j.currency_code,a.account_code,a.name,sum(l.debit_amount)::text as debit,sum(l.credit_amount)::text as credit from app.journal_lines l join app.journal_entries j on j.tenant_id=l.tenant_id and j.id=l.journal_entry_id join app.chart_of_accounts a on a.tenant_id=l.tenant_id and a.id=l.account_id where l.tenant_id=$1 and j.status='posted' and j.journal_date between $2::date and $3::date group by j.currency_code,a.account_code,a.name order by a.account_code`,
  },
  'balance-sheet': {
    label: 'Balance sheet accounts (before period close)',
    sql: `select j.currency_code,a.account_code,a.name,a.account_type,sum(l.debit_amount-l.credit_amount)::text as net_debit from app.journal_lines l join app.journal_entries j on j.tenant_id=l.tenant_id and j.id=l.journal_entry_id join app.chart_of_accounts a on a.tenant_id=l.tenant_id and a.id=l.account_id where l.tenant_id=$1 and j.status='posted' and j.journal_date<=$3::date and $2::date is not null and a.account_type in ('asset','liability','equity') group by j.currency_code,a.account_code,a.name,a.account_type order by a.account_code`,
  },
  journal: {
    label: 'Journal',
    sql: `select j.currency_code,j.journal_number,j.journal_date,j.description,a.account_code,l.debit_amount::text,l.credit_amount::text,j.status from app.journal_entries j join app.journal_lines l on l.tenant_id=j.tenant_id and l.journal_entry_id=j.id join app.chart_of_accounts a on a.tenant_id=l.tenant_id and a.id=l.account_id where j.tenant_id=$1 and j.journal_date between $2::date and $3::date order by j.journal_date,j.journal_number,l.line_number`,
  },
  'chart-of-accounts': {
    label: 'Chart of accounts',
    sql: `select account_code,name,account_type,normal_balance,active from app.chart_of_accounts where tenant_id=$1 and $2::date<=$3::date order by account_code`,
  },
  invoices: {
    label: 'Invoices & debtors',
    sql: `select invoice_number,issue_date,due_date,status,currency_code,subtotal::text,tax_total::text,total::text,balance_due::text from app.invoices where tenant_id=$1 and issue_date between $2::date and $3::date order by due_date,invoice_number`,
  },
  'sales-payments': {
    label: 'Sales invoice payments',
    sql: `select p.payment_reference,p.received_at,i.invoice_number,p.amount::text,p.currency_code,p.method,p.status from app.payments p left join app.invoices i on i.tenant_id=p.tenant_id and i.id=p.invoice_id where p.tenant_id=$1 and p.received_at::date between $2::date and $3::date order by p.received_at`,
  },
  orders: {
    label: 'Purchase orders',
    sql: `select 'AUD' as currency_code,reference,status,due_on,amount::text,tax_total::text,(amount+tax_total)::text as total from app.purchase_orders where tenant_id=$1 and created_at::date between $2::date and $3::date order by created_at`,
  },
  budget: {
    label: 'Budget & commitments',
    sql: `select 'AUD' as currency_code,a.account_code,a.name,b.amount::text as budget,coalesce((select sum(po.amount+po.tax_total) from app.purchase_orders po where po.tenant_id=b.tenant_id and po.budget_id=b.id and po.status in ('approved','received','invoiced')),0)::text as committed,coalesce((select sum(po.amount+po.tax_total) from app.purchase_orders po where po.tenant_id=b.tenant_id and po.budget_id=b.id and po.status='paid'),0)::text as paid from app.budgets b join app.chart_of_accounts a on a.tenant_id=b.tenant_id and a.id=b.account_id join app.academic_years y on y.tenant_id=b.tenant_id and y.id=b.academic_year_id where b.tenant_id=$1 and y.starts_on<=$3::date and y.ends_on>=$2::date order by a.account_code`,
  },
  gst: {
    label: 'GST working paper (review before BAS)',
    sql: `select 'Sales invoices' as category,currency_code,coalesce(sum(subtotal),0)::text as net,coalesce(sum(tax_total),0)::text as tax from app.invoices where tenant_id=$1 and status not in ('draft','void') and issue_date between $2::date and $3::date group by currency_code union all select 'Approved supplier bills','AUD' as currency_code,coalesce(sum(amount),0)::text,coalesce(sum(tax_total),0)::text from app.supplier_bills where tenant_id=$1 and status in ('approved','paid') and issue_date between $2::date and $3::date`,
  },
  reconciliation: {
    label: 'Reconciliation',
    sql: `select b.currency_code,b.name,t.transaction_date,t.reference,t.description,t.amount::text,t.status from app.bank_transactions t join app.bank_accounts b on b.tenant_id=t.tenant_id and b.id=t.bank_account_id where t.tenant_id=$1 and t.transaction_date between $2::date and $3::date order by b.name,t.transaction_date`,
  },
  cashflow: {
    label: 'Recorded cash movements',
    sql: `select b.currency_code,t.transaction_date,t.description,t.amount::text,t.status from app.bank_transactions t join app.bank_accounts b on b.tenant_id=t.tenant_id and b.id=t.bank_account_id where t.tenant_id=$1 and t.transaction_date between $2::date and $3::date and t.status='reconciled' order by t.transaction_date`,
  },
  payroll: {
    label: 'Payroll review',
    sql: `select 'AUD' as currency_code,s.staff_number,s.first_name || ' ' || s.last_name as staff,p.period_start,p.period_end,p.ordinary_minutes,p.overtime_minutes,p.gross_amount::text,p.tax_total::text,p.status from app.payroll_lines p join app.staff s on s.tenant_id=p.tenant_id and s.id=p.staff_id where p.tenant_id=$1 and p.period_start between $2::date and $3::date order by p.period_start,s.staff_number`,
  },
  'income-analysis': {
    label: 'Income analysis',
    sql: `select date_trunc('month',issue_date)::date as month,currency_code,sum(total)::text as invoiced,sum(balance_due)::text as outstanding from app.invoices where tenant_id=$1 and status not in ('draft','void') and issue_date between $2::date and $3::date group by 1,currency_code order by 1`,
  },
};
/** Registers reports with a visible row cap and separately permissioned initial GL templates. */
export function registerReportRoutes(server: FastifyInstance): void {
  server.get('/api/v1/finance/reports', {
    preHandler: [requireSession],

    /** Handles /api/v1/finance/reports using validated input and the route's authenticated authorization context. */
    handler: (request) => {
      authorize(request, 'finance');
      return {
        reports: Object.entries(financeReports).map(
          /** Transforms Object.entries finance Reports entries into the reports output representation. */
          ([key, value]) => ({ key, label: value.label }),
        ),
      };
    },
  });
  server.get('/api/v1/finance/reports/:report', {
    preHandler: [requireSession],

    /** Handles /api/v1/finance/reports/:report using validated input and the route's authenticated authorization context. */
    handler: async (request) => {
      authorize(request, 'finance');
      const { report } = z.object({ report: z.string().max(50) }).parse(request.params);
      const entry = financeReports[report];
      if (!entry) throw new ApplicationError(404, 'NOT_FOUND', 'The report is not available.');
      const { start, end } = z
        .object({ start: z.iso.date(), end: z.iso.date() })
        .refine(
          /** Coordinates reports within reports, preserving the caller's validation and error handling. */
          (value) => value.end >= value.start,
        )
        .parse(request.query);
      const ctx = contextFor(request);
      const result = await runInTenantTransaction(
        ctx,

        /** Applies reports reads or writes with transaction-local tenant, actor and audit context. */
        async (client) =>
          client.query<Record<string, unknown>>(entry.sql + ' limit 10001', [
            ctx.tenantId,
            start,
            end,
          ]),
      );
      return {
        title: entry.label,
        items: result.rows.slice(0, 10000),
        truncated: result.rows.length > 10000,
        start,
        end,
        generatedAt: new Date().toISOString(),
      };
    },
  });
  server.post('/api/v1/finance/gl-template', {
    preHandler: [requireSession, requireCsrf, requireRecentMfa],

    /** Handles /api/v1/finance/gl-template using validated input and the route's authenticated authorization context. */
    handler: async (request) => {
      authorize(request, 'finance', 'manage');
      z.object({ template: z.literal('australian-school') })
        .strict()
        .parse(request.body);
      const ctx = contextFor(request);
      const template = [
        ['1200', 'GST input credits', 'asset', 'debit'],
        ['2300', 'Unallocated customer receipts', 'liability', 'credit'],
        ['1000', 'Operating bank', 'asset', 'debit'],
        ['1100', 'Accounts receivable', 'asset', 'debit'],
        ['2000', 'Accounts payable', 'liability', 'credit'],
        ['2100', 'GST payable', 'liability', 'credit'],
        ['2200', 'PAYG withholding', 'liability', 'credit'],
        ['3000', 'Accumulated funds', 'equity', 'credit'],
        ['4000', 'Tuition fees', 'revenue', 'credit'],
        ['4100', 'Donations', 'revenue', 'credit'],
        ['5000', 'Teaching salaries', 'expense', 'debit'],
        ['5100', 'Student activities', 'expense', 'debit'],
        ['5200', 'Facilities', 'expense', 'debit'],
      ];
      await runInTenantTransaction(
        ctx,

        /** Applies reports reads or writes with transaction-local tenant, actor and audit context. */
        async (client) => {
          for (const row of template)
            await client.query<Record<string, unknown>>(
              'insert into app.chart_of_accounts(tenant_id,account_code,name,account_type,normal_balance) values($1,$2,$3,$4,$5) on conflict(tenant_id,account_code) do nothing',
              [ctx.tenantId, ...row],
            );
        },
      );
      return { ok: true };
    },
  });
}

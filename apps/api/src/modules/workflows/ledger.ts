/** @fileoverview Balanced, currency-labelled journal postings connect verified finance transitions to reports. */
import { randomUUID } from 'node:crypto';
import { moneyToCents, centsToMoney } from '@edutex/contracts';
import { type runInTenantTransaction } from '@edutex/database';
import { ApplicationError } from '../../shared/errors.js';
type Client = Parameters<Parameters<typeof runInTenantTransaction>[1]>[0];
interface Line {
  code?: string;
  accountId?: string;
  debit?: bigint;
  credit?: bigint;
}
/** Posts all lines atomically and rejects missing or inactive GL accounts instead of inventing balances. */
export async function postJournal(
  client: Client,
  tenantId: string,
  userId: string,
  source: string,
  reference: string,
  currency: string,
  lines: Line[],
): Promise<string> {
  const retained = lines.filter(
    /** Selects lines entries using the explicit line.debit 0n 0n line.credit 0n 0n condition. */
    (line) => (line.debit ?? 0n) > 0n || (line.credit ?? 0n) > 0n,
  );
  const debit = retained.reduce(
    /** Coordinates ledger within ledger, preserving the caller's validation and error handling. */
    (sum, line) => sum + (line.debit ?? 0n),
    0n,
  );
  const credit = retained.reduce(
    /** Coordinates ledger within ledger, preserving the caller's validation and error handling. */
    (sum, line) => sum + (line.credit ?? 0n),
    0n,
  );
  if (retained.length < 2 || debit !== credit || debit === 0n)
    throw new ApplicationError(
      409,
      'JOURNAL_UNBALANCED',
      'The journal must contain equal, positive debits and credits.',
    );
  const resolved = [];
  for (const line of retained) {
    const account = (
      await client.query<{ id: string }>(
        'select id from app.chart_of_accounts where tenant_id=$1 and active and ($2::uuid is not null and id=$2 or $2::uuid is null and account_code=$3)',
        [tenantId, line.accountId ?? null, line.code ?? null],
      )
    ).rows[0];
    if (!account)
      throw new ApplicationError(
        409,
        'GL_SETUP_REQUIRED',
        'Configure the school GL template and active accounts before posting finance records.',
      );
    resolved.push({ ...line, accountId: account.id });
  }
  const id = randomUUID();
  await client.query<Record<string, unknown>>(
    `insert into app.journal_entries(tenant_id,id,journal_number,journal_date,description,source_type,source_reference,currency_code,created_by) values($1,$2,$3,current_date,$4,$4,$5,$6,$7)`,
    [tenantId, id, 'RC6-' + id, source, reference, currency, userId],
  );
  for (const [index, line] of resolved.entries())
    await client.query<Record<string, unknown>>(
      'insert into app.journal_lines(tenant_id,journal_entry_id,account_id,line_number,debit_amount,credit_amount) values($1,$2,$3,$4,$5,$6)',
      [
        tenantId,
        id,
        line.accountId,
        index + 1,
        centsToMoney(line.debit ?? 0n),
        centsToMoney(line.credit ?? 0n),
      ],
    );
  await client.query<Record<string, unknown>>(
    "update app.journal_entries set status='posted',posted_by=$3,posted_at=clock_timestamp() where tenant_id=$1 and id=$2",
    [tenantId, id, userId],
  );
  return id;
}
/** Posts the accounting consequences of one already-validated workflow action in its original transaction. */
export async function postWorkflowJournal(
  client: Client,
  tenantId: string,
  userId: string,
  resource: string,
  action: string,
  row: Record<string, unknown>,
): Promise<void> {
  const currency = scalarText(row['currency_code'] ?? 'AUD');
  const reference = String(row['id']) + ':' + action;
  if (resource === 'invoices' && action === 'issue')
    await postJournal(client, tenantId, userId, 'invoice.issue', reference, currency, [
      { code: '1100', debit: moneyToCents(row['total']) },
      { code: '4000', credit: moneyToCents(row['subtotal']) },
      { code: '2100', credit: moneyToCents(row['tax_total']) },
    ]);
  if (resource === 'invoices' && action === 'void' && row['status'] !== 'draft')
    await postJournal(client, tenantId, userId, 'invoice.void', reference, currency, [
      { code: '1100', credit: moneyToCents(row['total']) },
      { code: '4000', debit: moneyToCents(row['subtotal']) },
      { code: '2100', debit: moneyToCents(row['tax_total']) },
    ]);
  if (resource === 'payments' && action === 'settle')
    await postJournal(client, tenantId, userId, 'receipt.settle', reference, currency, [
      { code: '1000', debit: moneyToCents(row['amount']) },
      { code: row['invoice_id'] ? '1100' : '2300', credit: moneyToCents(row['amount']) },
    ]);
  if (resource === 'supplier-bills' && action === 'approve') {
    const po = requiredValue(
      (
        await client.query<{ account_id: string }>(
          'select account_id from app.purchase_orders where tenant_id=$1 and id=$2',
          [tenantId, row['purchase_order_id']],
        )
      ).rows[0],
    );
    await postJournal(client, tenantId, userId, 'supplier.approve', reference, currency, [
      { accountId: po.account_id, debit: moneyToCents(row['amount']) },
      { code: '1200', debit: moneyToCents(row['tax_total']) },
      { code: '2000', credit: moneyToCents(row['amount']) + moneyToCents(row['tax_total']) },
    ]);
  }
  if (resource === 'supplier-bills' && action === 'pay') {
    const amount = moneyToCents(row['amount']) + moneyToCents(row['tax_total']);
    await postJournal(client, tenantId, userId, 'supplier.pay', reference, currency, [
      { code: '2000', debit: amount },
      { code: '1000', credit: amount },
    ]);
  }
  if (resource === 'payroll-lines' && action === 'pay') {
    const gross = moneyToCents(row['gross_amount']);
    const tax = moneyToCents(row['tax_total']);
    await postJournal(client, tenantId, userId, 'payroll.pay', reference, currency, [
      { code: '5000', debit: gross },
      { code: '1000', credit: gross - tax },
      { code: '2200', credit: tax },
    ]);
  }
}

import { requiredValue } from '@edutex/contracts';

import { scalarText } from '@edutex/contracts';

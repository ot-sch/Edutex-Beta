/** @fileoverview Pure workflow rules shared by API validation and the permitted action interface. */
export interface WorkflowAction {
  readonly from: readonly string[];
  readonly to: string;
  readonly label: string;
  readonly permission: string;
  readonly peer?: boolean;
}
export const workflowActions: Readonly<Record<string, Readonly<Record<string, WorkflowAction>>>> = {
  'purchase-orders': {
    submit: {
      from: ['draft', 'rejected'],
      to: 'submitted',
      label: 'Submit for approval',
      permission: 'edit',
    },
    approve: {
      from: ['submitted'],
      to: 'approved',
      label: 'Approve purchase order',
      permission: 'approve',
      peer: true,
    },
    reject: {
      from: ['submitted'],
      to: 'rejected',
      label: 'Return purchase order',
      permission: 'approve',
      peer: true,
    },
    receive: {
      from: ['approved'],
      to: 'received',
      label: 'Confirm goods received',
      permission: 'edit',
    },
    cancel: {
      from: ['draft', 'submitted', 'approved'],
      to: 'cancelled',
      label: 'Cancel purchase order',
      permission: 'approve',
    },
  },
  'supplier-bills': {
    match: {
      from: ['draft'],
      to: 'matched',
      label: 'Match to received purchase order',
      permission: 'edit',
    },
    approve: {
      from: ['matched'],
      to: 'approved',
      label: 'Approve supplier bill',
      permission: 'approve',
      peer: true,
    },
    pay: {
      from: ['approved'],
      to: 'paid',
      label: 'Record verified supplier payment',
      permission: 'approve',
      peer: true,
    },
    dispute: {
      from: ['draft', 'matched'],
      to: 'disputed',
      label: 'Mark as disputed',
      permission: 'edit',
    },
  },
  'event-plans': {
    submit: {
      from: ['draft', 'rejected'],
      to: 'submitted',
      label: 'Submit event proposal',
      permission: 'edit',
    },
    review: {
      from: ['submitted'],
      to: 'risk_review',
      label: 'Begin risk review',
      permission: 'approve',
      peer: true,
    },
    approve: {
      from: ['risk_review'],
      to: 'approved',
      label: 'Approve assigned risk stage',
      permission: 'approve',
      peer: true,
    },
    reject: {
      from: ['submitted', 'risk_review'],
      to: 'rejected',
      label: 'Return for revision',
      permission: 'approve',
      peer: true,
    },
    complete: {
      from: ['approved'],
      to: 'completed',
      label: 'Complete event plan',
      permission: 'edit',
    },
  },
  'bank-transactions': {
    match: { from: ['unmatched'], to: 'matched', label: 'Match receipt', permission: 'edit' },
    reconcile: {
      from: ['matched'],
      to: 'reconciled',
      label: 'Reconcile transaction',
      permission: 'approve',
      peer: true,
    },
  },
  payments: {
    settle: {
      from: ['pending'],
      to: 'settled',
      label: 'Confirm settled receipt',
      permission: 'approve',
      peer: true,
    },
  },
  invoices: {
    issue: { from: ['draft'], to: 'issued', label: 'Issue invoice', permission: 'approve' },
    void: {
      from: ['draft', 'issued', 'overdue'],
      to: 'void',
      label: 'Void unpaid invoice',
      permission: 'approve',
    },
  },
  'payroll-lines': {
    submit: { from: ['draft'], to: 'submitted', label: 'Submit payroll line', permission: 'edit' },
    approve: {
      from: ['submitted'],
      to: 'approved',
      label: 'Approve payroll line',
      permission: 'approve',
      peer: true,
    },
    pay: {
      from: ['approved'],
      to: 'paid',
      label: 'Record verified payroll payment',
      permission: 'approve',
      peer: true,
    },
  },
};

/** Parses a decimal amount as integer cents, avoiding binary floating-point accounting errors. */
export function moneyToCents(value: unknown): bigint {
  const text = String(value);
  if (!/^-?\d{1,10}(\.\d{1,2})?$/.test(text))
    throw new Error('Enter an amount with no more than two decimal places.');
  const negative = text.startsWith('-');
  const [whole, fraction = ''] = text.replace('-', '').split('.');
  const result = BigInt(requiredValue(whole)) * 100n + BigInt(fraction.padEnd(2, '0'));
  return negative ? -result : result;
}
/** Serializes integer cents to a database-safe decimal string. */
export function centsToMoney(value: bigint): string {
  const positive = value < 0n ? -value : value;
  return `${value < 0n ? '-' : ''}${positive / 100n}.${String(positive % 100n).padStart(2, '0')}`;
}
/** Calculates reviewed gross pay from minutes and rates, rounded once to the nearest cent. */
export function grossPay(
  ordinaryMinutes: number,
  overtimeMinutes: number,
  ordinaryRate: unknown,
  overtimeRate: unknown,
): string {
  if (
    !Number.isSafeInteger(ordinaryMinutes) ||
    !Number.isSafeInteger(overtimeMinutes) ||
    ordinaryMinutes < 0 ||
    overtimeMinutes < 0
  )
    throw new Error('Invalid paid minutes.');
  return centsToMoney(
    (BigInt(ordinaryMinutes) * moneyToCents(ordinaryRate) +
      BigInt(overtimeMinutes) * moneyToCents(overtimeRate) +
      30n) /
      60n,
  );
}

import { requiredValue } from './values.js';

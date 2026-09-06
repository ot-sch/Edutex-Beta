/** @fileoverview Bounded dashboard and alert definitions; expressions are data and never executable code. */
import { z } from 'zod';
export const timelineSchema = z.enum([
  'daily',
  'weekly',
  'fortnightly',
  'monthly',
  'quarterly',
  'termly',
  'yearly',
]);
export const metricSourceSchema = z.enum([
  'students',
  'attendance',
  'invoices',
  'payments',
  'payroll',
  'purchase-orders',
  'incidents',
  'maintenance',
  'event-consent',
]);
export const metricFields: Readonly<Record<z.infer<typeof metricSourceSchema>, readonly string[]>> =
  {
    students: ['count'],
    attendance: ['count', 'present', 'absent', 'late'],
    invoices: ['count', 'total', 'taxTotal', 'balanceDue'],
    payments: ['count', 'amount'],
    payroll: ['count', 'grossAmount', 'taxTotal'],
    'purchase-orders': ['count', 'amount', 'taxTotal'],
    incidents: ['count'],
    maintenance: ['count', 'cost'],
    'event-consent': ['count'],
  };
export const metricTermSchema = z
  .object({ source: metricSourceSchema, field: z.string().max(40) })
  .strict()
  .refine(
    /** Rejects fields outside the selected dataset's safe aggregate catalogue. */ (term) =>
      metricFields[term.source].includes(term.field),
    'This field is not available in the selected dataset.',
  );
export const tileSchema = z
  .object({
    id: z.uuid(),
    title: z.string().trim().min(1).max(100),
    visual: z.enum(['kpi', 'bar', 'table']),
    currencyCode: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .default('AUD'),
    colour: z.enum(['blue', 'green', 'purple', 'amber', 'red']),
    timeline: z.enum(['interchangeable', ...timelineSchema.options]),
    terms: z.array(metricTermSchema).min(1).max(8),
    status: z
      .array(z.string().regex(/^[a-z_]{1,40}$/))
      .max(20)
      .default([]),
    search: z.string().max(100).default(''),
  })
  .strict()
  .refine(
    /** Keeps incompatible currencies and headcounts from being silently added together. */ (
      tile,
    ) =>
      tile.terms.every(
        /** Selects tile.terms entries using the explicit term.field count condition. */
        (term) => term.field === 'count',
      ) ||
      tile.terms.every(
        /** Selects tile.terms entries using the explicit count present absent late .includes term.field condition. */
        (term) => !['count', 'present', 'absent', 'late'].includes(term.field),
      ) ||
      tile.terms.length === 1,
    'Combine counts with counts, or financial amounts with financial amounts.',
  );
export const dashboardDefinitionSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    timeline: timelineSchema,
    tiles: z.array(tileSchema).max(30),
    search: z.string().max(100).default(''),
  })
  .strict();
export type DashboardDefinition = z.infer<typeof dashboardDefinitionSchema>;
export type InsightTile = z.infer<typeof tileSchema>;

export const alertConditionSchema = z
  .object({
    field: z.enum([
      'status',
      'yearLevel',
      'classId',
      'studentId',
      'amount',
      'balanceDue',
      'category',
      'severity',
      'parentApproved',
    ]),
    operator: z.enum(['equals', 'not_equals', 'contains', 'greater_than', 'less_than', 'in']),
    value: z.union([
      z.string().max(150),
      z.number(),
      z.boolean(),
      z.array(z.string().max(100)).max(30),
    ]),
  })
  .strict();
export const alertRuleSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    source: metricSourceSchema.or(z.literal('sign-in-out')),
    logic: z.enum(['all', 'any']),
    conditions: z.array(alertConditionSchema).min(1).max(20),
    threshold: z.number().int().min(1).max(10000),
    countBy: z.enum(['records', 'distinct_days']),
    timeline: timelineSchema,
    actions: z
      .array(
        z
          .object({
            channel: z.enum(['dashboard', 'email', 'sms']),
            userIds: z.array(z.uuid()).max(100),
            groupIds: z.array(z.uuid()).max(30),
            includeParents: z.boolean().default(false),
          })
          .strict(),
      )
      .min(1)
      .max(10),
    enabled: z.boolean().default(false),
  })
  .strict();
export type AlertRule = z.infer<typeof alertRuleSchema>;

/** Evaluates a bounded condition tree against an already authorised row. */
export function matchesAlert(
  rule: Pick<AlertRule, 'logic' | 'conditions'>,
  row: Readonly<Record<string, unknown>>,
): boolean {
  const checks = rule.conditions.map(
    /** Renders rule.conditions entries with their stable identifiers and visible labels. */
    (condition) => {
      const actual = row[condition.field];
      const expected = condition.value;
      switch (condition.operator) {
        case 'equals':
          return scalarText(actual) === String(expected);
        case 'not_equals':
          return scalarText(actual) !== String(expected);
        case 'contains':
          return scalarText(actual).toLowerCase().includes(String(expected).toLowerCase());
        case 'in':
          return Array.isArray(expected) && expected.includes(String(actual));
        case 'greater_than':
          return Number.isFinite(Number(actual)) && Number(actual) > Number(expected);
        case 'less_than':
          return Number.isFinite(Number(actual)) && Number(actual) < Number(expected);
      }
    },
  );
  return rule.logic === 'all' ? checks.every(Boolean) : checks.some(Boolean);
}

/** Returns a school-local date window; fortnight anchors never drift with the caller's weekday. */
export function timelineWindow(
  scope: z.infer<typeof timelineSchema>,
  today: string,
  term?: { startsOn: string; endsOn: string },
): { start: string; end: string } {
  const date = new Date(today + 'T00:00:00Z');
  if (!Number.isFinite(date.valueOf())) throw new Error('Invalid school date.');
  let start = new Date(date);
  let end = new Date(date);
  if (scope === 'daily') end.setUTCDate(end.getUTCDate() + 1);
  if (scope === 'weekly') {
    start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
    end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 7);
  }
  if (scope === 'fortnightly') {
    const anchor = Date.UTC(2020, 0, 6);
    const period = Math.floor((date.getTime() - anchor) / (14 * 86400000));
    start = new Date(anchor + period * 14 * 86400000);
    end = new Date(start.getTime() + 14 * 86400000);
  }
  if (scope === 'monthly' || scope === 'quarterly') {
    start.setUTCDate(1);
    if (scope === 'quarterly') start.setUTCMonth(Math.floor(start.getUTCMonth() / 3) * 3);
    end = new Date(start);
    end.setUTCMonth(end.getUTCMonth() + (scope === 'quarterly' ? 3 : 1));
  }
  if (scope === 'yearly') {
    start = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    end = new Date(Date.UTC(date.getUTCFullYear() + 1, 0, 1));
  }
  if (scope === 'termly') {
    if (!term) throw new Error('No term contains the selected school date.');
    start = new Date(term.startsOn + 'T00:00:00Z');
    end = new Date(term.endsOn + 'T00:00:00Z');
    end.setUTCDate(end.getUTCDate() + 1);
  }
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

import { scalarText } from './values.js';

/** Restricts the builder to the same public field names supported by each server dataset. */
export const alertSourceFields: Readonly<
  Record<AlertRule['source'], readonly z.infer<typeof alertConditionSchema>['field'][]>
> = {
  students: ['status', 'yearLevel', 'studentId'],
  attendance: ['status', 'classId', 'studentId'],
  invoices: ['status', 'amount', 'balanceDue'],
  payments: ['status', 'amount'],
  payroll: ['status', 'amount'],
  'purchase-orders': ['status', 'amount'],
  incidents: ['status', 'studentId', 'category', 'severity'],
  maintenance: ['status', 'category', 'amount'],
  'event-consent': ['status', 'studentId'],
  'sign-in-out': ['status', 'studentId', 'parentApproved'],
};

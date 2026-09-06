/** @fileoverview Real PostgreSQL engine regression tests for migrations, tenant isolation and new HTTP workflows. */
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import { moduleIdSchema, requiredValue, type AlertRule, type SessionUser } from '@edutex/contracts';
interface FixtureState {
  transaction: (ctx: unknown, work: (client: unknown) => Promise<unknown>) => Promise<unknown>;
  system: (work: (client: unknown) => Promise<unknown>) => Promise<unknown>;
  identity: SessionUser;
}
const state = vi.hoisted(
  /** Coordinates workflows.integration.test within workflows.integration.test, preserving the caller's validation and error handling. */
  (): FixtureState => ({
    /** Coordinates transaction within workflows.integration.test, preserving the caller's validation and error handling. */
    transaction: () => Promise.reject(new Error('Fixture not started.')),

    /** Coordinates system within workflows.integration.test, preserving the caller's validation and error handling. */
    system: () => Promise.reject(new Error('Fixture not started.')),
    identity: {
      id: '',
      tenantId: '',
      displayName: '',
      email: '',
      category: 'it_staff',
      campusIds: [],
      roleNames: [],
      permissions: [],
      enabledModules: [],
      authenticationMethods: [],
      mfaSatisfiedAt: null,
    },
  }),
);
vi.mock(
  '@edutex/database',

  /** Coordinates workflows.integration.test within workflows.integration.test, preserving the caller's validation and error handling. */
  () => ({
    /** Coordinates run In Tenant Transaction within workflows.integration.test, preserving the caller's validation and error handling. */
    runInTenantTransaction: (ctx: unknown, work: (client: unknown) => Promise<unknown>) =>
      state.transaction(ctx, work),

    /** Coordinates run In System Transaction within workflows.integration.test, preserving the caller's validation and error handling. */
    runInSystemTransaction: (work: (client: unknown) => Promise<unknown>) => state.system(work),
  }),
);
vi.mock(
  '../auth/session.js',

  /** Coordinates workflows.integration.test within workflows.integration.test, preserving the caller's validation and error handling. */
  () => ({
    /** Coordinates require Session within workflows.integration.test, preserving the caller's validation and error handling. */
    requireSession: () => Promise.resolve(undefined),

    /** Coordinates require Csrf within workflows.integration.test, preserving the caller's validation and error handling. */
    requireCsrf: () => Promise.resolve(undefined),

    /** Coordinates require Recent Mfa within workflows.integration.test, preserving the caller's validation and error handling. */
    requireRecentMfa: () => Promise.resolve(undefined),
  }),
);
vi.mock(
  '../auth/identity-repository.js',

  /** Coordinates workflows.integration.test within workflows.integration.test, preserving the caller's validation and error handling. */
  () => ({
    /** Coordinates refresh Identity within workflows.integration.test, preserving the caller's validation and error handling. */
    refreshIdentity: () => Promise.resolve(state.identity),
  }),
);
import { resourceRegistry } from '../resources/registry.js';
import { registerResourceRoutes } from '../resources/routes.js';
import { registerLookupRoutes } from './lookups.js';
import { registerEventConsentRoutes } from './event-consent.js';
import { registerWorkflowActions } from './actions.js';
import { registerPortalRoutes } from './portals.js';
import { registerDashboardRoutes } from '../dashboard/routes.js';
import { registerInsightRoutes } from './insights.js';
import { registerAlertRoutes, evaluateAlert } from './alerts.js';
import { registerReportRoutes } from './reports.js';
import { registerMedicalRoutes } from './medical.js';
import { registerPreferenceRoutes } from './preferences.js';
import { registerTechnicianRoutes } from './technician.js';
import { loadConfiguration } from '../../config.js';
import type {} from '../../types.js';
import { sendError } from '../../shared/errors.js';
let db: PGlite;
let server: FastifyInstance;
const tenant = randomUUID(),
  otherTenant = randomUUID(),
  admin = randomUUID(),
  peer = randomUUID(),
  parent = randomUUID(),
  outsider = randomUUID(),
  studentUser = randomUUID(),
  student = randomUUID(),
  otherStudent = randomUUID(),
  campus = randomUUID(),
  year = randomUUID(),
  klass = randomUUID(),
  guardian = randomUUID(),
  family = randomUUID();
/** Sets the actor used by the HTTP fixture; authentication itself is covered by the existing security-boundary tests. */
function actor(
  id = admin,
  category: SessionUser['category'] = 'it_staff',
  permissions: SessionUser['permissions'] = ['platform:manage'],
): void {
  state.identity = {
    id,
    tenantId: tenant,
    category,
    permissions,
    enabledModules: [...moduleIdSchema.options],
    displayName: 'Synthetic reviewer',
    email: 'reviewer@example.invalid',
    campusIds: [],
    roleNames: ['Synthetic role'],
    authenticationMethods: ['totp'],
    mfaSatisfiedAt: new Date().toISOString(),
  };
}
/** Supplies PostgreSQL results through the same parameterized query interface used by production pg clients. */
function clientAdapter() {
  return {
    /** Coordinates query within workflows.integration.test, preserving the caller's validation and error handling. */
    query: async (sql: string, args: unknown[] = []) => {
      const result = await db.query(sql, args);
      return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length };
    },
  };
}
/** Runs each fixture transaction as the non-owner runtime role with production transaction-local security context. */
async function scoped(
  ctx: unknown,
  work: (client: ReturnType<typeof clientAdapter>) => Promise<unknown>,
): Promise<unknown> {
  const c = ctx as { tenantId: string; userId: string; permissions: string[]; requestId: string };
  await db.exec('begin; set local role edutex_app;');
  try {
    await db.query(
      "select set_config('app.tenant_id',$1,true),set_config('app.user_id',$2,true),set_config('app.permissions',$3,true),set_config('app.request_id',$4,true)",
      [c.tenantId, c.userId, JSON.stringify(c.permissions), c.requestId],
    );
    const result = await work(clientAdapter());
    await db.exec('commit');
    return result;
  } catch (error) {
    await db.exec('rollback');
    throw error;
  }
}
/** Uses the current synthetic account for a direct RLS assertion. */
function query(sql: string, args: unknown[] = []): Promise<unknown> {
  return scoped(
    {
      ...state.identity,
      userId: state.identity.id,
      requestId: 'integration',
    },

    /** Coordinates workflows.integration.test within workflows.integration.test, preserving the caller's validation and error handling. */
    async (client) => client.query(sql, args),
  );
}

beforeAll(
  /** Coordinates resolve within workflows.integration.test, preserving the caller's validation and error handling. */
  async () => {
    db = new PGlite({ extensions: { citext, pgcrypto } });
    const migrations = resolve(import.meta.dirname, '../../../../../packages/database/migrations');
    for (const filename of (await readdir(migrations)).sort())
      await db.exec(await readFile(resolve(migrations, filename), 'utf8'));
    await db.query("select set_config('app.permissions','[\"platform:manage\"]',false)");
    for (const [id, slug] of [
      [tenant, 'test-school'],
      [otherTenant, 'other-school'],
    ])
      await db.query(
        "insert into app.tenants(id,slug,legal_name,display_name,status) values($1,$2::text,$2::text,$2::text,'active')",
        [id, slug],
      );
    for (const [id, category] of [
      [admin, 'it_staff'],
      [peer, 'it_staff'],
      [parent, 'parent_guardian'],
      [outsider, 'parent_guardian'],
      [studentUser, 'student'],
    ])
      await db.query(
        "insert into app.users(tenant_id,id,cognito_subject,email,display_name,category,status) values($1,$2::uuid,$2::text,$3,'Synthetic fixture',$4,'active')",
        [tenant, id, id + '@example.invalid', category],
      );
    await db.query(
      "select set_config('app.tenant_id',$1,false),set_config('app.user_id',$2,false)",
      [tenant, admin],
    );
    await db.query(
      'insert into app.tenant_modules(tenant_id,module_key,display_order) select $1,m,ordinality from unnest($2::text[]) with ordinality as x(m,ordinality)',
      [tenant, [...moduleIdSchema.options]],
    );
    await db.query(
      "insert into app.campuses(tenant_id,id,code,name,timezone) values($1,$2,'MAIN','Main campus','Australia/Melbourne')",
      [tenant, campus],
    );
    await db.query(
      "insert into app.academic_years(tenant_id,id,name,starts_on,ends_on,status) values($1,$2,'2026','2026-01-01','2026-12-31','active')",
      [tenant, year],
    );
    await db.query(
      "insert into app.classes(tenant_id,id,campus_id,academic_year_id,code,name,year_level) values($1,$2,$3,$4,'MATH6','Year 6 Maths','6')",
      [tenant, klass, campus, year],
    );
    for (const [id, code, user] of [
      [student, 'S1', studentUser],
      [otherStudent, 'S2', null],
    ])
      await db.query(
        "insert into app.students(tenant_id,id,campus_id,student_number,first_name,last_name,year_level,user_id) values($1,$2,$3,$4,'Synthetic','Student','6',$5)",
        [tenant, id, campus, code, user],
      );
    await db.query(
      "insert into app.guardians(tenant_id,id,user_id,first_name,last_name) values($1,$2,$3,'Test','Guardian')",
      [tenant, guardian, parent],
    );
    await db.query(
      "insert into app.guardian_relationships(tenant_id,student_id,guardian_id,relationship,can_consent,can_view_medical,can_view_finance,valid_from,created_by) values($1,$2,$3,'parent',true,true,true,'2020-01-01',$4)",
      [tenant, student, guardian, admin],
    );
    await db.query(
      "insert into app.families(tenant_id,id,family_number,display_name) values($1,$2,'F1','Synthetic family')",
      [tenant, family],
    );
    await db.query(
      'insert into app.student_families(tenant_id,student_id,family_id) values($1,$2,$3)',
      [tenant, student, family],
    );
    await db.query(
      "insert into app.class_students(tenant_id,class_id,student_id,enrolled_from) values($1,$2,$3,'2020-01-01')",
      [tenant, klass, student],
    );
    await db.exec(
      "select set_config('app.permissions','[]',false),set_config('app.tenant_id','',false),set_config('app.user_id','',false)",
    );
    state.transaction = scoped;
    state.system =
      /** Coordinates work within workflows.integration.test, preserving the caller's validation and error handling. */
      async (work) => work(clientAdapter());
    actor();
    server = Fastify();
    server.decorate('configuration', loadConfiguration({ NODE_ENV: 'test' }));
    server.addHook(
      'onRequest',

      /** Coordinates workflows.integration.test within workflows.integration.test, preserving the caller's validation and error handling. */
      (request) => {
        request.identity = {
          user: state.identity,
          sessionHash: 'synthetic',
          csrfToken: 'synthetic',
          deviceHash: 'synthetic',
          expiresAt: '2099-01-01T00:00:00Z',
        };
        return Promise.resolve();
      },
    );
    server.setErrorHandler(
      /** Coordinates String within workflows.integration.test, preserving the caller's validation and error handling. */
      (error, request, reply) => {
        if (process.env.EDUTEX_TEST_DEBUG) process.stderr.write(String(error) + '\n');
        sendError(error, request, reply);
      },
    );
    registerResourceRoutes(server);
    registerLookupRoutes(server);
    registerWorkflowActions(server);
    registerEventConsentRoutes(server);
    registerPortalRoutes(server);
    registerDashboardRoutes(server);
    registerInsightRoutes(server);
    registerAlertRoutes(server);
    registerReportRoutes(server);
    registerMedicalRoutes(server);
    registerPreferenceRoutes(server);
    registerTechnicianRoutes(server);
    await server.ready();
  },
  60000,
);
afterAll(
  /** Coordinates workflows.integration.test within workflows.integration.test, preserving the caller's validation and error handling. */
  async () => {
    await server.close();
    await db.close();
  },
);

describe('RC6 database and workflow integration', /** Verifies RC6 database and workflow integration. */ () => {
  it('maps every registered resource to real SQL columns and standard metadata', /** Verifies maps every registered resource to real SQL columns and standard metadata. */ async () => {
    const errors = [];
    for (const [name, config] of Object.entries(resourceRegistry)) {
      const result = await db.query<{ column_name: string }>(
        "select column_name from information_schema.columns where table_schema='app' and table_name=$1",
        [config.table],
      );
      const columns = new Set(
        result.rows.map(
          /** Transforms result.rows entries into the workflows.integration.test output representation. */
          (row) => row.column_name,
        ),
      );
      for (const column of [
        'tenant_id',
        'id',
        'created_at',
        'updated_at',
        'row_version',
        ...Object.values(config.fields).map(
          /** Transforms Object.values config.fields entries into the workflows.integration.test output representation. */
          (field) => field.column,
        ),
      ])
        if (!columns.has(column)) errors.push(name + ':' + column);
    }
    expect(errors).toEqual([]);
  });
  it('allows multiple people without optional usernames, barcodes or emails', /** Verifies allows multiple people without optional usernames, barcodes or emails. */ async () => {
    actor();
    const result = await query('select count(*)::int as n from app.students');
    expect((result as { rows: { n: number }[] }).rows[0]?.n).toBe(2);
  });
  it('does not leak rows from a different tenant even to a platform manager', /** Verifies does not leak rows from a different tenant even to a platform manager. */ async () => {
    actor();
    const result = await scoped(
      {
        tenantId: otherTenant,
        userId: admin,
        permissions: ['platform:manage'],
        requestId: 'cross-tenant',
      },

      /** Coordinates workflows.integration.test within workflows.integration.test, preserving the caller's validation and error handling. */
      async (client) => client.query('select id from app.students'),
    );
    expect((result as { rows: unknown[] }).rows).toHaveLength(0);
  });
  it('shows a parent only explicitly linked children', /** Verifies shows a parent only explicitly linked children. */ async () => {
    actor(parent, 'parent_guardian', ['parent-portal:view']);
    const result = await server.inject('/api/v1/portal/children');
    expect(result.statusCode, result.body).toBe(200);
    expect(
      result.json<{ children: { id: string }[] }>().children.map(
        /** Transforms result.json children id string .children entries into the workflows.integration.test output representation. */
        (row: { id: string }) => row.id,
      ),
    ).toEqual([student]);
  });
  it('rejects another guardian accessing an unlinked child or medical record', /** Verifies rejects another guardian accessing an unlinked child or medical record. */ async () => {
    actor(outsider, 'parent_guardian', ['parent-portal:view']);
    expect((await server.inject('/api/v1/portal/students/' + student)).statusCode).toBe(404);
    expect((await server.inject('/api/v1/medical/' + student)).statusCode).toBe(404);
  });
  it('loads published portal sections without schema or RLS recursion errors', /** Verifies loads published portal sections without schema or RLS recursion errors. */ async () => {
    actor(parent, 'parent_guardian', ['parent-portal:view']);
    const result = await server.inject('/api/v1/portal/students/' + student);
    expect(result.statusCode, result.body).toBe(200);
    expect(result.json()).toHaveProperty('timetable');
  });
  it('allows a linked parent to submit an absence but rejects a different child', /** Verifies allows a linked parent to submit an absence but rejects a different child. */ async () => {
    actor(parent, 'parent_guardian', ['parent-portal:view']);
    const body = {
      studentId: student,
      requestType: 'absence',
      effectiveAt: '2026-09-05T00:00:00Z',
      reason: 'Synthetic test only',
    };
    expect(
      (await server.inject({ method: 'POST', url: '/api/v1/portal/absences', payload: body }))
        .statusCode,
    ).toBe(200);
    expect(
      (
        await server.inject({
          method: 'POST',
          url: '/api/v1/portal/absences',
          payload: { ...body, studentId: otherStudent },
        })
      ).statusCode,
    ).toBe(403);
  });
  it('runs the dashboard and every allowlisted report against PostgreSQL', /** Verifies runs the dashboard and every allowlisted report against PostgreSQL. */ async () => {
    actor();
    const dashboard = await server.inject('/api/v1/dashboard');
    expect(dashboard.statusCode, dashboard.body).toBe(200);
    const catalogue = (await server.inject('/api/v1/finance/reports')).json<{
      reports: { key: string }[];
    }>();
    for (const report of catalogue.reports) {
      const result = await server.inject(
        `/api/v1/finance/reports/${report.key}?start=2026-01-01&end=2026-12-31`,
      );
      expect(result.statusCode, report.key + ': ' + result.body).toBe(200);
    }
  });
  it('persists preferences on the account and prevents cross-account reads', /** Verifies persists preferences on the account and prevents cross-account reads. */ async () => {
    actor();
    const saved = await server.inject({
      method: 'PUT',
      url: '/api/v1/preferences/appearance',
      payload: { preferences: { theme: 'dark' }, rowVersion: 0 },
    });
    expect(saved.statusCode, saved.body).toBe(200);
    actor(peer);
    const other = await server.inject('/api/v1/preferences/appearance');
    expect(other.body).not.toContain('dark');
  });
  it('creates and issues an invoice with a balanced journal, then prevents duplicate posting', /** Verifies creates and issues an invoice with a balanced journal, then prevents duplicate posting. */ async () => {
    actor();
    expect(
      (
        await server.inject({
          method: 'POST',
          url: '/api/v1/finance/gl-template',
          payload: { template: 'australian-school' },
        })
      ).statusCode,
    ).toBe(200);
    const created = await server.inject({
      method: 'POST',
      url: '/api/v1/resources/invoices',
      payload: {
        fields: {
          familyId: family,
          invoiceNumber: 'TEST-1',
          issueDate: '2026-09-01',
          dueDate: '2026-09-20',
          currencyCode: 'AUD',
          subtotal: 100,
          taxTotal: 10,
        },
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const invoice = created.json<{ id: string; rowVersion: number }>();
    actor(peer);
    const action = {
      method: 'POST' as const,
      url: '/api/v1/workflows/invoices/' + invoice.id + '/issue',
      payload: { rowVersion: invoice.rowVersion, note: 'Reviewed synthetic invoice' },
    };
    const posted = await server.inject(action);
    expect(posted.statusCode, posted.body).toBe(200);
    expect((await server.inject(action)).statusCode).toBe(409);
    const sums = await query(
      "select sum(l.debit_amount)::text as debit,sum(l.credit_amount)::text as credit from app.journal_lines l join app.journal_entries j on j.id=l.journal_entry_id and j.tenant_id=l.tenant_id where j.source_type='invoice.issue'",
    );
    expect((sums as { rows: unknown[] }).rows).toEqual([{ debit: '110.00', credit: '110.00' }]);
  });
  it('prevents a creator from settling their own receipt', /** Verifies prevents a creator from settling their own receipt. */ async () => {
    actor();
    const created = await server.inject({
      method: 'POST',
      url: '/api/v1/resources/payments',
      payload: {
        fields: {
          paymentReference: 'TEST-PEER',
          amount: '10.00',
          currencyCode: 'AUD',
          method: 'bank_transfer',
          receivedAt: '2026-09-01T01:00:00Z',
        },
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const row = created.json<{ id: string; rowVersion: number }>();
    const result = await server.inject({
      method: 'POST',
      url: `/api/v1/workflows/payments/${row.id}/settle`,
      payload: { rowVersion: row.rowVersion, note: 'Synthetic approval' },
    });
    expect(result.statusCode, result.body).toBe(409);
  });
  it('evaluates date-only insight data without losing the first local day', /** Verifies evaluates date-only insight data without losing the first local day. */ async () => {
    actor();
    const tile = {
      id: randomUUID(),
      title: 'Invoices',
      visual: 'kpi',
      colour: 'blue',
      timeline: 'monthly',
      terms: [{ source: 'invoices', field: 'total' }],
      status: [],
      search: '',
    };
    const result = await server.inject({
      method: 'POST',
      url: '/api/v1/insights/evaluate',
      payload: { tiles: [tile], timeline: 'monthly', today: '2026-09-05' },
    });
    expect(result.statusCode, result.body).toBe(200);
    expect(result.json<{ items: { total: number }[] }>().items[0]?.total).toBe(110);
  });
  it('can evaluate attendance alerts whose marks use compound primary keys', /** Verifies can evaluate attendance alerts whose marks use compound primary keys. */ async () => {
    actor();
    const rule: AlertRule = {
      name: 'Absent days',
      source: 'attendance',
      logic: 'all',
      conditions: [{ field: 'status', operator: 'equals', value: 'absent' }],
      countBy: 'distinct_days',
      threshold: 3,
      timeline: 'weekly',
      actions: [{ channel: 'dashboard', userIds: [peer], groupIds: [], includeParents: false }],
      enabled: false,
    };
    const result = await evaluateAlert(
      {
        tenantId: tenant,
        userId: admin,
        permissions: ['platform:manage'],
        requestId: 'test-alert',
      },
      randomUUID(),
      rule,
      true,
    );
    expect(result).toEqual({ matches: 0, queued: 0 });
  });
  it('refuses a parent opening the separate technician endpoint', /** Verifies refuses a parent opening the separate technician endpoint. */ async () => {
    actor(parent, 'parent_guardian', ['parent-portal:view']);
    expect((await server.inject('/api/v1/technician/status')).statusCode).toBe(403);
    actor();
    const result = await server.inject('/api/v1/technician/status');
    expect(result.statusCode, result.body).toBe(200);
    expect(result.body).not.toContain('DB_PASSWORD');
  });
  it('settles repeated partial receipts without allowing overpayment or currency mixing', /** Verifies settles repeated partial receipts without allowing overpayment or currency mixing. */ async () => {
    actor();
    const row = (await query("select id from app.invoices where invoice_number='TEST-1'")) as {
      rows: { id: string }[];
    };
    const invoiceId = requiredValue(row.rows[0]).id;
    for (const [reference, amount, currency, expected] of [
      ['PART-1', '20.00', 'AUD', 200],
      ['PART-2', '20.00', 'AUD', 200],
      ['OVER', '999.00', 'AUD', 409],
      ['WRONG-CURRENCY', '5.00', 'USD', 409],
      ['FINAL', '70.00', 'AUD', 200],
    ] as const) {
      actor(peer);
      const created = await server.inject({
        method: 'POST',
        url: '/api/v1/resources/payments',
        payload: {
          fields: {
            invoiceId,
            paymentReference: reference,
            amount,
            currencyCode: currency,
            method: 'bank_transfer',
            receivedAt: '2026-09-05T02:00:00Z',
          },
        },
      });
      expect(created.statusCode, created.body).toBe(201);
      const receipt = created.json<{ id: string; rowVersion: number }>();
      actor(admin);
      const settled = await server.inject({
        method: 'POST',
        url: `/api/v1/workflows/payments/${receipt.id}/settle`,
        payload: { rowVersion: receipt.rowVersion, note: 'Verified synthetic bank receipt' },
      });
      expect(settled.statusCode, settled.body).toBe(expected);
    }
    const result = await query('select balance_due::text,status from app.invoices where id=$1', [
      invoiceId,
    ]);
    expect((result as { rows: unknown[] }).rows).toEqual([{ balance_due: '0.00', status: 'paid' }]);
  });
  it('rejects direct changes to posted journals', /** Verifies rejects direct changes to posted journals. */ async () => {
    actor();
    await expect(
      query("update app.journal_entries set description='Tampered' where status='posted'"),
    ).rejects.toThrow();
  });
  it('shows only a guardian allocation and its own receipts, even for a shared student', /** Verifies shows only a guardian allocation and its own receipts, even for a shared student. */ async () => {
    actor();
    const secondGuardian = randomUUID();
    await query(
      "insert into app.guardians(tenant_id,id,user_id,first_name,last_name) values(app.current_tenant_id(),$1,$2,'Second','Guardian')",
      [secondGuardian, outsider],
    );
    await query(
      "insert into app.guardian_relationships(tenant_id,guardian_id,student_id,relationship,can_view_finance,valid_from) values(app.current_tenant_id(),$1,$2,'parent',true,'2020-01-01')",
      [secondGuardian, student],
    );
    const created = await server.inject({
      method: 'POST',
      url: '/api/v1/resources/invoices',
      payload: {
        fields: {
          familyId: family,
          invoiceNumber: 'SPLIT-1',
          issueDate: '2026-09-01',
          dueDate: '2026-09-20',
          currencyCode: 'AUD',
          subtotal: 100,
          taxTotal: 0,
        },
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const invoice = created.json<{ id: string; rowVersion: number }>();
    for (const [guardianId, amount] of [
      [guardian, '40.00'],
      [secondGuardian, '60.00'],
    ]) {
      const allocation = await server.inject({
        method: 'POST',
        url: '/api/v1/resources/invoice-allocations',
        payload: { fields: { invoiceId: invoice.id, guardianId, studentId: student, amount } },
      });
      expect(allocation.statusCode, allocation.body).toBe(201);
    }
    const issued = await server.inject({
      method: 'POST',
      url: `/api/v1/workflows/invoices/${invoice.id}/issue`,
      payload: { rowVersion: invoice.rowVersion, note: 'Verified cost responsibility' },
    });
    expect(issued.statusCode, issued.body).toBe(200);
    actor(parent, 'parent_guardian', ['parent-portal:view']);
    const first = (await server.inject(`/api/v1/portal/students/${student}`)).json<{
      fees: { total: string; balance_due: string }[];
    }>();
    expect(first.fees).toHaveLength(1);
    expect(first.fees[0]?.total).toBe('40.00');
    expect(first.fees[0]?.balance_due).toBe('40.00');
    actor(outsider, 'parent_guardian', ['parent-portal:view']);
    const second = (await server.inject(`/api/v1/portal/students/${student}`)).json<{
      fees: { total: string }[];
    }>();
    expect(second.fees).toHaveLength(1);
    expect(second.fees[0]?.total).toBe('60.00');
    actor();
    await expect(
      query('update app.invoice_allocations set amount=1 where invoice_id=$1', [invoice.id]),
    ).rejects.toThrow();
  });
  it('locks repeat alert delivery to one notification per recipient and scope', /** Verifies locks repeat alert delivery to one notification per recipient and scope. */ async () => {
    actor();
    const id = randomUUID();
    const rule: AlertRule = {
      name: 'Receipt follow-up',
      source: 'payments',
      logic: 'all',
      conditions: [{ field: 'status', operator: 'equals', value: 'settled' }],
      threshold: 1,
      countBy: 'records',
      timeline: 'yearly',
      actions: [{ channel: 'dashboard', userIds: [peer], groupIds: [], includeParents: false }],
      enabled: true,
    };
    await query(
      'insert into app.smart_alert_rules(tenant_id,id,owner_user_id,definition) values(app.current_tenant_id(),$1,app.current_user_id(),$2::jsonb)',
      [id, JSON.stringify(rule)],
    );
    const ctx = {
      tenantId: tenant,
      userId: admin,
      permissions: ['platform:manage'],
      requestId: 'dedupe-test',
    };
    const first = await evaluateAlert(ctx, id, rule, false);
    const second = await evaluateAlert(ctx, id, rule, false);
    expect(first.matches).toBe(3);
    expect(first.queued).toBe(3);
    expect(second.queued).toBe(0);
  });
  it('separates financial insight amounts by the selected currency', /** Verifies separates financial insight amounts by the selected currency. */ async () => {
    actor();
    const tile = {
      id: randomUUID(),
      title: 'USD receipts',
      visual: 'kpi',
      colour: 'blue',
      currencyCode: 'USD',
      timeline: 'monthly',
      terms: [{ source: 'payments', field: 'amount' }],
      status: ['settled'],
      search: '',
    };
    const result = await server.inject({
      method: 'POST',
      url: '/api/v1/insights/evaluate',
      payload: { tiles: [tile], timeline: 'monthly', today: '2026-09-05' },
    });
    expect(result.statusCode, result.body).toBe(200);
    expect(result.json<{ items: { total: number }[] }>().items[0]?.total).toBe(0);
  });
  it('enforces no-class calendar actions at attendance creation', /** Verifies enforces no-class calendar actions at attendance creation. */ async () => {
    actor();
    await query(
      "insert into app.important_dates(tenant_id,title,starts_on,ends_on,action) values(app.current_tenant_id(),'School holiday','2026-10-01','2026-10-01','no_classes')",
    );
    const result = await server.inject({
      method: 'POST',
      url: '/api/v1/resources/attendance-sessions',
      payload: {
        fields: {
          campusId: campus,
          classId: klass,
          sessionDate: '2026-10-01',
          sessionLabel: 'Period 1',
          status: 'open',
        },
      },
    });
    expect(result.statusCode, result.body).toBe(400);
  });
  it('retains paper consent separately from portal consent in immutable evidence', /** Verifies retains paper consent separately from portal consent in immutable evidence. */ async () => {
    actor();
    const eventId = randomUUID();
    await query(
      "insert into app.events(tenant_id,id,title,starts_at,ends_at,location,status) values(app.current_tenant_id(),$1,'Synthetic trip','2099-09-10T00:00:00Z','2099-09-10T08:00:00Z','Synthetic venue','published')",
      [eventId],
    );
    await query(
      "insert into app.event_participants(tenant_id,event_id,student_id,consent_status) values(app.current_tenant_id(),$1,$2,'pending')",
      [eventId, student],
    );
    const response = await server.inject({
      method: 'POST',
      url: `/api/v1/events/${eventId}/paper-consent`,
      payload: {
        studentId: student,
        guardianId: guardian,
        decision: 'granted',
        reference: 'Synthetic signed document PAPER-001',
      },
    });
    expect(response.statusCode, response.body).toBe(200);
    const pack = await server.inject(`/api/v1/events/${eventId}/consent`);
    expect(pack.statusCode, pack.body).toBe(200);
    expect(pack.body).toContain('PAPER-001');
    expect(pack.body).toContain('paper');
    await query('delete from app.consent_evidence where event_id=$1', [eventId]);
    const kept = await query(
      'select count(*)::int as n from app.consent_evidence where event_id=$1',
      [eventId],
    );
    expect((kept as { rows: unknown[] }).rows).toEqual([{ n: 1 }]);
  });

  it('contains legacy and accidental staff grants on community accounts at the database boundary', /** Verifies contains legacy and accidental staff grants on community accounts at the database boundary. */ async () => {
    actor(parent, 'parent_guardian', [
      'parent-portal:view',
      'students:view',
      'students:sensitive-view',
      'finance:view',
      'platform:manage',
    ]);
    const rows = await query('select id from app.students order by id');
    expect((rows as { rows: { id: string }[] }).rows).toEqual([{ id: student }]);
    const permissions = await query(
      "select app.has_permission('students:view') as staff,app.has_permission('parent-portal:view') as portal",
    );
    expect((permissions as { rows: unknown[] }).rows).toEqual([{ staff: false, portal: true }]);
    actor(studentUser, 'student', ['student-portal:view', 'platform:manage']);
    const own = await query('select id from app.students');
    expect((own as { rows: { id: string }[] }).rows).toEqual([{ id: student }]);
  });

  it('loads exact linked-record labels and checks individual record reads under RLS', /** Verifies loads exact linked-record labels and checks individual record reads under RLS. */ async () => {
    actor();
    const labels = await server.inject('/api/v1/lookups/campuses?ids=' + campus);
    expect(labels.statusCode, labels.body).toBe(200);
    expect(labels.body).toContain('Main campus');
    const people = await server.inject('/api/v1/lookups/users?ids=' + admin);
    expect(people.statusCode, people.body).toBe(200);
    expect(people.body).toContain('Synthetic fixture');
    expect((await server.inject('/api/v1/resources/students/' + student)).statusCode).toBe(200);
    actor(parent, 'parent_guardian', ['students:view', 'parent-portal:view']);
    expect((await server.inject('/api/v1/resources/students/' + otherStudent)).statusCode).toBe(
      404,
    );
  });
  it('does not publish internal staff forms to students or guardians', /** Verifies does not publish internal staff forms to students or guardians. */ async () => {
    actor();
    for (const mode of ['internal', 'parent_portal', 'student_portal'])
      await query(
        'insert into app.forms(tenant_id,form_key,title,form_type,collection_mode,definition,status) values(app.current_tenant_id(),$1::public.citext,$1::text,\'survey\',$1::text,\'{"questions":[{"key":"answer","label":"Response"}]}\'::jsonb,\'published\')',
        [mode],
      );
    actor(studentUser, 'student', ['student-portal:view']);
    const studentForms = await server.inject('/api/v1/portal/forms');
    expect(studentForms.statusCode, studentForms.body).toBe(200);
    expect(studentForms.body).toContain('student_portal');
    expect(studentForms.body).not.toContain('internal');
    expect(studentForms.body).not.toContain('parent_portal');
    actor(parent, 'parent_guardian', ['parent-portal:view']);
    const parentForms = await server.inject('/api/v1/portal/forms');
    expect(parentForms.body).toContain('parent_portal');
    expect(parentForms.body).not.toContain('student_portal');
  });
  it('removes child access at the database immediately when an account is disabled', /** Verifies removes child access at the database immediately when an account is disabled. */ async () => {
    actor();
    await query("update app.users set status='disabled' where tenant_id=$1 and id=$2", [
      tenant,
      parent,
    ]);
    actor(parent, 'parent_guardian', ['parent-portal:view', 'platform:manage']);
    const rows = await query('select id from app.students');
    expect((rows as { rows: unknown[] }).rows).toEqual([]);
    actor();
    await query("update app.users set status='active' where tenant_id=$1 and id=$2", [
      tenant,
      parent,
    ]);
  });
  it('provisions new schools with portal-only community roles', /** Verifies provisions new schools with portal-only community roles. */ async () => {
    await db.query(
      "select set_config('app.tenant_id',$1,false),set_config('app.permissions','[\"platform:manage\"]',false)",
      [tenant],
    );
    await db.query('select app.provision_tenant_defaults($1,$2)', [tenant, admin]);
    await db.exec(
      "select set_config('app.tenant_id','',false),set_config('app.permissions','[]',false)",
    );
    const roles = await db.query<{ key: string; permission_key: string }>(
      "select r.key,p.permission_key from app.roles r join app.role_permissions p on p.tenant_id=r.tenant_id and p.role_id=r.id where r.tenant_id=$1 and r.key in ('parent-guardian','student') order by r.key",
      [tenant],
    );
    expect(roles.rows).toEqual([
      { key: 'parent-guardian', permission_key: 'parent-portal:view' },
      { key: 'student', permission_key: 'student-portal:view' },
    ]);
  });

  it('upgrades a populated RC5 database while preserving tenant identity and correcting community grants', /** Verifies upgrades a populated RC5 database while preserving tenant identity and correcting community grants. */ async () => {
    const upgrade = new PGlite({ extensions: { citext, pgcrypto } });
    const directory = resolve(import.meta.dirname, '../../../../../packages/database/migrations');
    const files = (await readdir(directory)).sort();
    const school = randomUUID(),
      account = randomUUID();
    try {
      for (const file of files.filter(
        /** Selects files entries using the explicit file 0010 condition. */
        (file) => file < '0010',
      ))
        await upgrade.exec(await readFile(resolve(directory, file), 'utf8'));
      await upgrade.query(
        "select set_config('app.permissions','[\"platform:manage\"]',false),set_config('app.tenant_id',$1,false)",
        [school],
      );
      await upgrade.query(
        "insert into app.tenants(id,slug,legal_name,display_name,status) values($1,'existing-school','Existing School','Existing School','active')",
        [school],
      );
      await upgrade.query(
        "insert into app.users(tenant_id,id,cognito_subject,email,display_name,category,status) values($1,$2,'existing-subject','existing@example.invalid','Existing administrator','it_staff','active')",
        [school, account],
      );
      await upgrade.query('select app.provision_tenant_defaults($1,$2)', [school, account]);
      for (const file of files.filter(
        /** Selects files entries using the explicit file 0010 condition. */
        (file) => file >= '0010',
      )) {
        await upgrade.exec('begin');
        await upgrade.query(
          "select set_config('app.tenant_id','',true),set_config('app.user_id','',true),set_config('app.permissions','[\"platform:manage\"]',true),set_config('app.request_id',$1,true)",
          ['migration:' + file],
        );
        await upgrade.exec(await readFile(resolve(directory, file), 'utf8'));
        await upgrade.exec('commit');
      }
      const retained = await upgrade.query(
        'select id,cognito_subject from app.users where tenant_id=$1',
        [school],
      );
      expect(retained.rows).toEqual([{ id: account, cognito_subject: 'existing-subject' }]);
      const permissions = await upgrade.query(
        "select p.permission_key from app.role_permissions p join app.roles r on r.tenant_id=p.tenant_id and r.id=p.role_id where r.tenant_id=$1 and r.key='parent-guardian'",
        [school],
      );
      expect(permissions.rows).toEqual([{ permission_key: 'parent-portal:view' }]);
    } finally {
      await upgrade.close();
    }
  }, 60000);
  it('keeps GST working-paper currencies separate', /** Prevents a foreign-currency invoice from inflating the AUD tax working paper. */ async () => {
    actor();
    const created = await server.inject({
      method: 'POST',
      url: '/api/v1/resources/invoices',
      payload: {
        fields: {
          familyId: family,
          invoiceNumber: 'USD-TAX',
          issueDate: '2026-09-01',
          dueDate: '2026-09-20',
          currencyCode: 'USD',
          subtotal: 20,
          taxTotal: 2,
        },
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const invoice = created.json<{ id: string; rowVersion: number }>();
    actor(peer);
    const posted = await server.inject({
      method: 'POST',
      url: '/api/v1/workflows/invoices/' + invoice.id + '/issue',
      payload: { rowVersion: invoice.rowVersion, note: 'Reviewed USD synthetic invoice' },
    });
    expect(posted.statusCode, posted.body).toBe(200);
    const report = await server.inject(
      '/api/v1/finance/reports/gst?start=2026-01-01&end=2026-12-31',
    );
    expect(report.statusCode, report.body).toBe(200);
    const rows = report.json<{
      items: { category: string; currency_code: string; tax: string }[];
    }>().items;
    expect(rows).toContainEqual({
      category: 'Sales invoices',
      currency_code: 'USD',
      net: '20.00',
      tax: '2.00',
    });
    expect(
      rows.some(
        /** Confirms the existing AUD tax records retain a separate denomination. */
        (row) => row.category === 'Sales invoices' && row.currency_code === 'AUD',
      ),
    ).toBe(true);
  });
});

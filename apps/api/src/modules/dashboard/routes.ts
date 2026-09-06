/** @fileoverview Dashboard queries with account-saved multi-filters and source-permission-aware metrics. */
import { runInTenantTransaction } from '@edutex/database';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireSession } from '../auth/session.js';
import { authorize, contextFor } from '../workflows/context.js';
const filterSchema = z.object({
  campusIds: z.array(z.uuid()).max(100).default([]),
  yearLevels: z.array(z.string().max(30)).max(30).default([]),
  genders: z.array(z.string().max(50)).max(20).default([]),
});

/** Registers school overview data; dashboard access does not imply access to source modules. */
export function registerDashboardRoutes(server: FastifyInstance): void {
  server.get('/api/v1/dashboard', {
    preHandler: [requireSession],

    /** Handles /api/v1/dashboard using validated input and the route's authenticated authorization context. */
    handler: async (request) => {
      authorize(request, 'dashboard');
      const ctx =
        contextFor(
          request,
        ); /** Coordinates can within routes, preserving the caller's validation and error handling. */
      const can = (module: string): boolean => {
        try {
          authorize(request, module);
          return true;
        } catch {
          return false;
        }
      };
      return runInTenantTransaction(
        ctx,

        /** Applies routes reads or writes with transaction-local tenant, actor and audit context. */
        async (client) => {
          const saved = await client.query<{ preferences: { filters?: unknown } }>(
            "select preferences from app.user_preferences where tenant_id=$1 and user_id=$2 and namespace='dashboard'",
            [ctx.tenantId, ctx.userId],
          );
          const filters = filterSchema.parse(saved.rows[0]?.preferences.filters ?? {});
          const args = [ctx.tenantId, filters.campusIds, filters.yearLevels, filters.genders];
          const studentFilter = `s.tenant_id=$1 and (cardinality($2::uuid[])=0 or s.campus_id=any($2::uuid[])) and (cardinality($3::text[])=0 or s.year_level=any($3::text[])) and (cardinality($4::text[])=0 or s.gender_identity=any($4::text[]))`;
          const school = (
            await client.query<{ school: { name: string; timezone: string } }>(
              'select app.school_display_context() as school',
            )
          ).rows[0]?.school;
          const today = new Intl.DateTimeFormat('en-CA', {
            timeZone: school?.timezone ?? 'Australia/Melbourne',
          }).format(new Date());
          const students = can('students')
            ? await client.query<{ count: string }>(
                `select count(*)::text as count from app.students s where ${studentFilter} and s.status='current'`,
                args,
              )
            : null;
          const staff = can('staff')
            ? await client.query<{ count: string }>(
                `select count(*)::text as count from app.staff s where s.tenant_id=$1 and s.employment_status='active' and (cardinality($2::uuid[])=0 or exists(select 1 from app.staff_campuses c where c.tenant_id=s.tenant_id and c.staff_id=s.id and c.campus_id=any($2::uuid[])))`,
                args.slice(0, 2),
              )
            : null;
          const rolls = can('attendance')
            ? await client.query<{ count: string }>(
                `select count(*)::text as count from app.attendance_sessions a where a.tenant_id=$1 and a.status in ('planned','open') and (cardinality($2::uuid[])=0 or a.campus_id=any($2::uuid[])) and (cardinality($3::text[])+cardinality($4::text[])=0 or exists(select 1 from app.attendance_marks m join app.students s on s.tenant_id=m.tenant_id and s.id=m.student_id where m.tenant_id=a.tenant_id and m.attendance_session_id=a.id and ${studentFilter}))`,
                args,
              )
            : null;
          const invoices = can('finance')
            ? await client.query<{ count: string }>(
                `select count(*)::text as count from app.invoices i where i.tenant_id=$1 and i.status in ('issued','part_paid','overdue') and (cardinality($2::uuid[])+cardinality($3::text[])+cardinality($4::text[])=0 or exists(select 1 from app.student_families sf join app.students s on s.tenant_id=sf.tenant_id and s.id=sf.student_id where sf.family_id=i.family_id and ${studentFilter}))`,
                args,
              )
            : null;
          const trend =
            can('attendance') && can('students')
              ? await client.query<{ date: string; percentage: string | null }>(
                  `select a.session_date::text as date,round(100.0*count(*) filter(where m.status in ('present','late'))/nullif(count(*),0),1)::text as percentage from app.attendance_marks m join app.attendance_sessions a on a.tenant_id=m.tenant_id and a.id=m.attendance_session_id join app.students s on s.tenant_id=m.tenant_id and s.id=m.student_id where ${studentFilter} and a.session_date between $5::date-6 and $5::date and a.status in ('submitted','reopened') group by a.session_date order by a.session_date`,
                  [...args, today],
                )
              : null;
          const followups =
            can('attendance') && can('students')
              ? await client.query(
                  `select m.attendance_session_id::text||m.student_id::text as id,s.first_name || ' ' || s.last_name as student,s.year_level as "yearLevel",a.session_label as session,m.status as movement,c.name as class,room.name as room from app.attendance_marks m join app.attendance_sessions a on a.tenant_id=m.tenant_id and a.id=m.attendance_session_id join app.students s on s.tenant_id=m.tenant_id and s.id=m.student_id left join app.classes c on c.tenant_id=a.tenant_id and c.id=a.class_id left join lateral(select r.name from app.timetable_entries te join app.rooms r on r.tenant_id=te.tenant_id and r.id=te.room_id where te.tenant_id=a.tenant_id and te.class_id=a.class_id and te.period_id=a.period_id order by te.id limit 1) room on true where ${studentFilter} and a.session_date=$5::date and m.status in ('absent','late') order by s.last_name,a.session_label limit 100`,
                  [...args, today],
                )
              : null;
          const activity = can('audit')
            ? await client.query(
                `select occurred_at as "occurredAt",action,resource_type as "resourceType",outcome from audit.events where tenant_id=$1 order by occurred_at desc,sequence_number desc limit 8`,
                [ctx.tenantId],
              )
            : null;
          return {
            school,
            today,
            filters,
            metrics: {
              activeStudents: students ? Number(students.rows[0]?.count ?? 0) : null,
              activeStaff: staff ? Number(staff.rows[0]?.count ?? 0) : null,
              openAttendance: rolls ? Number(rolls.rows[0]?.count ?? 0) : null,
              outstandingInvoices: invoices ? Number(invoices.rows[0]?.count ?? 0) : null,
            },
            attendanceTrend:
              trend?.rows.map(
                /** Transforms trend .rows entries into the routes output representation. */
                (row) => ({
                  date: row.date,
                  percentage: row.percentage === null ? null : Number(row.percentage),
                }),
              ) ?? [],
            followUps: followups?.rows ?? [],
            activity: activity?.rows ?? [],
          };
        },
      );
    },
  });
}

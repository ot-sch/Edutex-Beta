/**
 * @fileoverview Registers the attendance HTTP API routes, validates untrusted requests and connects authenticated Fastify handlers to tenant-scoped services/PostgreSQL transactions.
 *
 * @remarks
 * Direct links: `@edutex/database`, `fastify`, `zod`, `../../shared/errors.js`, `../auth/session.js`, `/api/v1/attendance/sessions/:sessionId/roll`, `/api/v1/attendance/sessions/:sessionId/marks`, `/api/v1/attendance/sessions/:sessionId/submit`.
 * Security: Maintained source boundary; changes require strict type, test, lint, format and security review.
 */

import { runInTenantTransaction } from '@edutex/database';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { ApplicationError } from '../../shared/errors.js';
import { requireCsrf, requirePermission, requireSession } from '../auth/session.js';

const sessionParametersSchema = z.object({ sessionId: z.uuid() });
const markSchema = z
  .object({
    studentId: z.uuid(),
    status: z.enum(['present', 'absent', 'late', 'excused', 'unknown']),
    minutesLate: z.number().int().min(0).max(720).nullable().default(null),
    comment: z.string().trim().max(2_000).default(''),
    rowVersion: z.number().int().nonnegative().nullable().default(null),
  })
  .superRefine(
    /** Performs the local `z .object({ studentId: z.uuid(), status: z.enum(['present', ` operation inside `routes` and returns control to the surrounding feature only after this body completes. It receives `value`, `context`. Direct links: `context.addIssue`. */ (
      value,
      context,
    ) => {
      if (value.status === 'late' && value.minutesLate === null) {
        context.addIssue({
          code: 'custom',
          path: ['minutesLate'],
          message: 'Minutes late is required for a late mark.',
        });
      }
      if (value.status !== 'late' && value.minutesLate !== null) {
        context.addIssue({
          code: 'custom',
          path: ['minutesLate'],
          message: 'Minutes late is only valid for a late mark.',
        });
      }
    },
  );
const marksBodySchema = z.object({ marks: z.array(markSchema).min(1).max(500) });
const submitBodySchema = z.object({ rowVersion: z.number().int().nonnegative() });

/** Registers atomic attendance marking and submission workflows. */
export function registerAttendanceRoutes(server: FastifyInstance): void {
  server.get('/api/v1/attendance/sessions/:sessionId/roll', {
    preHandler: [requireSession, requirePermission('attendance:view')],
    /** Implements `handler` for registers the attendance http api routes, validates untrusted requests and connects authenticated fastify handlers to tenant-scoped services/postgresql transactions. It receives `request`. Direct links: `sessionParametersSchema.parse`, `runInTenantTransaction`. */ handler:
      async (request) => {
        const identity = request.identity;
        if (!identity)
          throw new ApplicationError(401, 'AUTHENTICATION_REQUIRED', 'Please sign in.');
        const { sessionId } = sessionParametersSchema.parse(request.params);
        return runInTenantTransaction(
          {
            tenantId: identity.user.tenantId,
            userId: identity.user.id,
            permissions: identity.user.permissions,
            requestId: request.id,
          },
          /** Executes the `handler` database work on the same PostgreSQL client after transaction-local tenant/user/permission context is set, preserving RLS isolation. It receives `client`. Direct links: `client.query`, `header.session_date.toISOString().slice`, `header.session_date.toISOString`, `Number`, `students.rows.map`. */ async (
            client,
          ) => {
            const session = await client.query<{
              id: string;
              session_date: Date;
              session_label: string;
              status: string;
              row_version: string;
            }>(
              `select id, session_date, session_label, status, row_version
             from app.attendance_sessions
             where tenant_id = $1 and id = $2`,
              [identity.user.tenantId, sessionId],
            );
            if (!session.rows[0]) {
              throw new ApplicationError(
                404,
                'ATTENDANCE_SESSION_NOT_FOUND',
                'The attendance session was not found.',
              );
            }
            const students = await client.query<{
              student_id: string;
              first_name: string;
              preferred_name: string | null;
              last_name: string;
              student_number: string;
              status: string | null;
              minutes_late: number | null;
              comment: string | null;
              row_version: string | null;
            }>(
              `with session_students as (
               select class_students.tenant_id, class_students.student_id
               from app.attendance_sessions
               join app.class_students
                 on class_students.tenant_id = attendance_sessions.tenant_id
                and class_students.class_id = attendance_sessions.class_id
                and class_students.status = 'active'
               where attendance_sessions.tenant_id = $1 and attendance_sessions.id = $2
               union
               select activity_participants.tenant_id, activity_participants.student_id
               from app.attendance_sessions
               join app.activity_participants
                 on activity_participants.tenant_id = attendance_sessions.tenant_id
                and activity_participants.activity_id = attendance_sessions.activity_id
                and activity_participants.status = 'active'
               where attendance_sessions.tenant_id = $1 and attendance_sessions.id = $2
             )
             select students.id as student_id, students.first_name, students.preferred_name,
                    students.last_name, students.student_number,
                    marks.status, marks.minutes_late, marks.comment, marks.row_version
             from session_students
             join app.students
               on students.tenant_id = session_students.tenant_id
              and students.id = session_students.student_id
             left join app.attendance_marks marks
               on marks.tenant_id = session_students.tenant_id
              and marks.attendance_session_id = $2
              and marks.student_id = students.id
             order by students.last_name, students.first_name, students.id`,
              [identity.user.tenantId, sessionId],
            );
            const header = session.rows[0];
            return {
              session: {
                id: header.id,
                date: header.session_date.toISOString().slice(0, 10),
                label: header.session_label,
                status: header.status,
                rowVersion: Number(header.row_version),
              },
              students: students.rows.map(
                /** Transforms each input item for `handler` into the derived value or React element consumed by the surrounding collection. It receives `student`. Direct links: `Number`. */ (
                  student,
                ) => ({
                  id: student.student_id,
                  studentNumber: student.student_number,
                  displayName: `${student.preferred_name ?? student.first_name} ${student.last_name}`,
                  mark: student.status
                    ? {
                        status: student.status,
                        minutesLate: student.minutes_late,
                        comment: student.comment ?? '',
                        rowVersion: Number(student.row_version),
                      }
                    : null,
                }),
              ),
            };
          },
        );
      },
  });

  server.put('/api/v1/attendance/sessions/:sessionId/marks', {
    preHandler: [requireSession, requirePermission('attendance:edit'), requireCsrf],
    /** Implements `handler` for registers the attendance http api routes, validates untrusted requests and connects authenticated fastify handlers to tenant-scoped services/postgresql transactions. It receives `request`. Direct links: `sessionParametersSchema.parse`, `marksBodySchema.parse`, `body.marks.find`, `runInTenantTransaction`. */ handler:
      async (request) => {
        const identity = request.identity;
        if (!identity)
          throw new ApplicationError(401, 'AUTHENTICATION_REQUIRED', 'Please sign in.');
        const { sessionId } = sessionParametersSchema.parse(request.params);
        const body = marksBodySchema.parse(request.body);
        const duplicate = body.marks.find(
          /** Selects the first input item matching this lookup condition for `handler`; no match deliberately returns undefined. It receives `mark`, `index`. Direct links: `body.marks.findIndex`. */ (
            mark,
            index,
          ) =>
            body.marks.findIndex(
              /** Returns the first matching item position for `handler`, allowing the caller to reject or update the exact reviewed record. It receives `candidate`. It uses only the local values shown in its body. */ (
                candidate,
              ) => candidate.studentId === mark.studentId,
            ) !== index,
        );
        if (duplicate) {
          throw new ApplicationError(
            400,
            'DUPLICATE_ATTENDANCE_MARK',
            'Each student may be marked only once per request.',
          );
        }

        return runInTenantTransaction(
          {
            tenantId: identity.user.tenantId,
            userId: identity.user.id,
            permissions: identity.user.permissions,
            requestId: request.id,
          },
          /** Executes the `handler` database work on the same PostgreSQL client after transaction-local tenant/user/permission context is set, preserving RLS isolation. It receives `client`. Direct links: `client.query`, `['planned', 'open', 'reopened'].includes`, `Number`. */ async (
            client,
          ) => {
            const locked = await client.query<{ status: string }>(
              `select status from app.attendance_sessions
             where tenant_id = $1 and id = $2 for update`,
              [identity.user.tenantId, sessionId],
            );
            if (!locked.rows[0]) {
              throw new ApplicationError(
                404,
                'ATTENDANCE_SESSION_NOT_FOUND',
                'The attendance session was not found.',
              );
            }
            if (!['planned', 'open', 'reopened'].includes(locked.rows[0].status)) {
              throw new ApplicationError(
                409,
                'ATTENDANCE_SESSION_CLOSED',
                'Submitted attendance cannot be edited.',
              );
            }

            for (const mark of body.marks) {
              const result = await client.query<{ row_version: string }>(
                `insert into app.attendance_marks (
                 tenant_id, attendance_session_id, student_id, status,
                 minutes_late, comment, source, marked_by
               ) values ($1, $2, $3, $4, $5, $6, 'teacher', $7)
               on conflict (tenant_id, attendance_session_id, student_id) do update
                 set status = excluded.status,
                     minutes_late = excluded.minutes_late,
                     comment = excluded.comment,
                     source = excluded.source,
                     marked_by = excluded.marked_by,
                     marked_at = clock_timestamp()
                 where $8::bigint is not null
                   and app.attendance_marks.row_version = $8::bigint
               returning row_version`,
                [
                  identity.user.tenantId,
                  sessionId,
                  mark.studentId,
                  mark.status,
                  mark.minutesLate,
                  mark.comment,
                  identity.user.id,
                  mark.rowVersion,
                ],
              );
              if (!result.rows[0]) {
                throw new ApplicationError(
                  409,
                  'VERSION_CONFLICT',
                  'An attendance mark changed elsewhere. Refresh before saving.',
                );
              }
            }
            const sessionResult = await client.query<{ row_version: string }>(
              `update app.attendance_sessions
             set status = case when status = 'planned' then 'open' else status end,
                 opened_by = coalesce(opened_by, $3), opened_at = coalesce(opened_at, clock_timestamp())
             where tenant_id = $1 and id = $2
             returning row_version`,
              [identity.user.tenantId, sessionId, identity.user.id],
            );
            return {
              updated: body.marks.length,
              rowVersion: Number(sessionResult.rows[0]?.row_version),
            };
          },
        );
      },
  });

  server.post('/api/v1/attendance/sessions/:sessionId/submit', {
    preHandler: [requireSession, requirePermission('attendance:approve'), requireCsrf],
    /** Implements `handler` for registers the attendance http api routes, validates untrusted requests and connects authenticated fastify handlers to tenant-scoped services/postgresql transactions. It receives `request`. Direct links: `sessionParametersSchema.parse`, `submitBodySchema.parse`, `runInTenantTransaction`, `Number`. */ handler:
      async (request) => {
        const identity = request.identity;
        if (!identity)
          throw new ApplicationError(401, 'AUTHENTICATION_REQUIRED', 'Please sign in.');
        const { sessionId } = sessionParametersSchema.parse(request.params);
        const body = submitBodySchema.parse(request.body);
        const result = await runInTenantTransaction(
          {
            tenantId: identity.user.tenantId,
            userId: identity.user.id,
            permissions: identity.user.permissions,
            requestId: request.id,
          },
          /** Executes the `handler` database work on the same PostgreSQL client after transaction-local tenant/user/permission context is set, preserving RLS isolation. It receives `client`. Direct links: `client.query`, `Number`. */ async (
            client,
          ) => {
            const missing = await client.query<{ count: string }>(
              `with session_students as (
               select class_students.tenant_id, class_students.student_id
               from app.attendance_sessions
               join app.class_students
                 on class_students.tenant_id = attendance_sessions.tenant_id
                and class_students.class_id = attendance_sessions.class_id
                and class_students.status = 'active'
               where attendance_sessions.tenant_id = $1 and attendance_sessions.id = $2
               union
               select activity_participants.tenant_id, activity_participants.student_id
               from app.attendance_sessions
               join app.activity_participants
                 on activity_participants.tenant_id = attendance_sessions.tenant_id
                and activity_participants.activity_id = attendance_sessions.activity_id
                and activity_participants.status = 'active'
               where attendance_sessions.tenant_id = $1 and attendance_sessions.id = $2
             )
             select count(*)::text as count
             from session_students
             left join app.attendance_marks marks
               on marks.tenant_id = session_students.tenant_id
              and marks.attendance_session_id = $2
              and marks.student_id = session_students.student_id
             where marks.student_id is null`,
              [identity.user.tenantId, sessionId],
            );
            if (Number(missing.rows[0]?.count ?? 0) > 0) {
              throw new ApplicationError(
                409,
                'ATTENDANCE_INCOMPLETE',
                'Every student must have a mark before submission.',
              );
            }
            return client.query<{ row_version: string }>(
              `update app.attendance_sessions
             set status = 'submitted', submitted_by = $4, submitted_at = clock_timestamp()
             where tenant_id = $1 and id = $2 and row_version = $3
               and status in ('open', 'reopened')
             returning row_version`,
              [identity.user.tenantId, sessionId, body.rowVersion, identity.user.id],
            );
          },
        );
        if (!result.rows[0]) {
          throw new ApplicationError(
            409,
            'VERSION_CONFLICT',
            'The attendance session changed elsewhere. Refresh before submitting.',
          );
        }
        return { status: 'submitted', rowVersion: Number(result.rows[0].row_version) };
      },
  });
}

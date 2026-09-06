/** @fileoverview Parent and student routes resolve verified relationships and published records under RLS. */
import { runInTenantTransaction } from '@edutex/database';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requireCsrf, requireSession } from '../auth/session.js';
import { contextFor, authorize } from './context.js';
import { ApplicationError } from '../../shared/errors.js';
/** Restricts portal endpoints to the matching authenticated category and explicit portal grant. */
function portalAccess(request: FastifyRequest, category: 'parent_guardian' | 'student'): void {
  if (request.identity?.user.category !== category)
    throw new ApplicationError(
      403,
      'PORTAL_CATEGORY_REQUIRED',
      'Use the portal assigned to your account.',
    );
  authorize(request, category === 'student' ? 'student-portal' : 'parent-portal');
}
/** Registers published learning data, own contact updates, consent evidence and student submissions. */
export function registerPortalRoutes(server: FastifyInstance): void {
  server.get('/api/v1/portal/children', {
    preHandler: [requireSession],

    /** Handles /api/v1/portal/children using validated input and the route's authenticated authorization context. */
    handler: async (request) => {
      const category =
        request.identity?.user.category === 'student' ? 'student' : 'parent_guardian';
      portalAccess(request, category);
      const ctx = contextFor(request);
      return runInTenantTransaction(
        ctx,

        /** Applies portals reads or writes with transaction-local tenant, actor and audit context. */
        async (client) => {
          const children = await client.query<Record<string, unknown>>(
            `select id,first_name,last_name,year_level,campus_id from app.students where tenant_id=$1 and (app.is_student_self(id) or app.parent_student_access(id)) order by first_name`,
            [ctx.tenantId],
          );
          const contacts = await client.query<Record<string, unknown>>(
            'select role,display_name,email,phone,campus_id from app.portal_contacts where tenant_id=$1 order by role,display_name',
            [ctx.tenantId],
          );
          return { children: children.rows, contacts: contacts.rows };
        },
      );
    },
  });
  server.get('/api/v1/portal/students/:studentId', {
    preHandler: [requireSession],

    /** Handles /api/v1/portal/students/:studentId using validated input and the route's authenticated authorization context. */
    handler: async (request) => {
      const category =
        request.identity?.user.category === 'student' ? 'student' : 'parent_guardian';
      portalAccess(request, category);
      const { studentId } = z.object({ studentId: z.uuid() }).parse(request.params);
      const ctx = contextFor(request);
      return runInTenantTransaction(
        ctx,

        /** Applies portals reads or writes with transaction-local tenant, actor and audit context. */
        async (client) => {
          const allowed = await client.query<{ ok: boolean }>(
            'select app.is_student_self($1) or app.parent_student_access($1) as ok',
            [studentId],
          );
          if (!allowed.rows[0]?.ok)
            throw new ApplicationError(
              404,
              'NOT_FOUND',
              'This student is not linked to your account.',
            );
          const timetable = await client.query<Record<string, unknown>>(
            `select c.name as class,p.weekday,p.period_code,p.starts_at,p.ends_at,r.name as room from app.class_students cs join app.classes c on c.tenant_id=cs.tenant_id and c.id=cs.class_id join app.timetable_entries te on te.tenant_id=c.tenant_id and te.class_id=c.id join app.timetable_sets ts on ts.tenant_id=te.tenant_id and ts.id=te.timetable_set_id join app.timetable_periods p on p.tenant_id=te.tenant_id and p.id=te.period_id left join app.rooms r on r.tenant_id=te.tenant_id and r.id=te.room_id where cs.tenant_id=$1 and cs.student_id=$2 and cs.status='active' and cs.enrolled_from<=current_date and (cs.enrolled_until is null or cs.enrolled_until>=current_date) and ts.mode='published' and exists(select 1 from app.academic_years y where y.tenant_id=ts.tenant_id and y.id=ts.academic_year_id and current_date between y.starts_on and y.ends_on) order by p.weekday,p.starts_at,c.name`,
            [ctx.tenantId, studentId],
          );
          const grades = await client.query<Record<string, unknown>>(
            `select a.title,g.score,g.grade_code,g.feedback,g.published_at from app.grade_results g join app.assessments a on a.tenant_id=g.tenant_id and a.id=g.assessment_id where g.tenant_id=$1 and g.student_id=$2 and g.status='published' order by g.published_at desc`,
            [ctx.tenantId, studentId],
          );
          const dates = await client.query<Record<string, unknown>>(
            `select title,starts_on,ends_on,action,year_levels from app.important_dates where tenant_id=$1 and ends_on>=current_date and audience in ('all',$2) and (cardinality(year_levels)=0 or (select year_level from app.students where tenant_id=$1 and id=$3)=any(year_levels)) and (campus_id is null or campus_id=(select campus_id from app.students where tenant_id=$1 and id=$3)) order by starts_on limit 100`,
            [ctx.tenantId, category === 'student' ? 'students' : 'parents', studentId],
          );
          const events =
            category === 'parent_guardian'
              ? await client.query<Record<string, unknown>>(
                  `select e.id,e.title,e.starts_at,e.ends_at,e.location,p.consent_status from app.events e join app.event_participants p on p.tenant_id=e.tenant_id and p.event_id=e.id where e.tenant_id=$1 and p.student_id=$2 and e.status='published' order by e.starts_at`,
                  [ctx.tenantId, studentId],
                )
              : null;
          const fees =
            category === 'parent_guardian'
              ? await client.query<Record<string, unknown>>(
                  'select * from app.portal_allocated_fees($1)',
                  [studentId],
                )
              : null;
          const materials =
            category === 'student'
              ? await client.query<Record<string, unknown>>(
                  `select m.id,m.title,m.description,m.content,m.language,m.subject,m.licence,m.resource_type from app.course_materials m join app.class_students cs on cs.tenant_id=m.tenant_id and cs.class_id=m.class_id where m.tenant_id=$1 and cs.student_id=$2 and cs.status='active' and m.status='published' order by m.title`,
                  [ctx.tenantId, studentId],
                )
              : null;
          const assignments =
            category === 'student'
              ? await client.query<Record<string, unknown>>(
                  `select a.id,a.title,a.instructions,a.due_at,s.submitted_at from app.assignments a join app.class_students cs on cs.tenant_id=a.tenant_id and cs.class_id=a.class_id left join app.assignment_submissions s on s.tenant_id=a.tenant_id and s.assignment_id=a.id and s.student_id=cs.student_id where a.tenant_id=$1 and cs.student_id=$2 and cs.status='active' and a.status in ('published','closed') order by a.due_at`,
                  [ctx.tenantId, studentId],
                )
              : null;
          return {
            timetable: timetable.rows,
            grades: grades.rows,
            dates: dates.rows,
            events: events?.rows ?? [],
            fees: fees?.rows ?? [],
            materials: materials?.rows ?? [],
            assignments: assignments?.rows ?? [],
          };
        },
      );
    },
  });
  server.get('/api/v1/portal/contact', {
    preHandler: [requireSession],

    /** Handles /api/v1/portal/contact using validated input and the route's authenticated authorization context. */
    handler: async (request) => {
      portalAccess(request, 'parent_guardian');
      const ctx = contextFor(request);
      const result = await runInTenantTransaction(
        ctx,

        /** Applies portals reads or writes with transaction-local tenant, actor and audit context. */
        async (client) =>
          client.query<Record<string, unknown>>(
            'select first_name,last_name,contact_email,mobile_phone,postal_address,row_version from app.guardians where tenant_id=$1 and user_id=$2',
            [ctx.tenantId, ctx.userId],
          ),
      );
      return result.rows[0] ?? null;
    },
  });
  server.patch('/api/v1/portal/contact', {
    preHandler: [requireSession, requireCsrf],

    /** Handles /api/v1/portal/contact using validated input and the route's authenticated authorization context. */
    handler: async (request) => {
      portalAccess(request, 'parent_guardian');
      const body = z
        .object({
          contactEmail: z.email(),
          mobilePhone: z.string().trim().min(5).max(40),
          postalAddress: z.string().trim().min(5).max(1000),
          rowVersion: z.number().int().positive(),
        })
        .strict()
        .parse(request.body);
      const ctx = contextFor(request);
      const result = await runInTenantTransaction(
        ctx,

        /** Applies portals reads or writes with transaction-local tenant, actor and audit context. */
        async (client) =>
          client.query<Record<string, unknown>>(
            'update app.guardians set contact_email=$3,mobile_phone=$4,postal_address=$5 where tenant_id=$1 and user_id=$2 and row_version=$6 returning row_version',
            [
              ctx.tenantId,
              ctx.userId,
              body.contactEmail,
              body.mobilePhone,
              body.postalAddress,
              body.rowVersion,
            ],
          ),
      );
      if (!result.rows[0])
        throw new ApplicationError(
          409,
          'VERSION_CONFLICT',
          'Your contact record changed. Reload before saving.',
        );
      return { rowVersion: Number(result.rows[0]['row_version']) };
    },
  });
  server.post('/api/v1/portal/absences', {
    preHandler: [requireSession, requireCsrf],

    /** Handles /api/v1/portal/absences using validated input and the route's authenticated authorization context. */
    handler: async (request) => {
      portalAccess(request, 'parent_guardian');
      const body = z
        .object({
          studentId: z.uuid(),
          requestType: z.enum(['absence', 'early_departure', 'late_arrival']),
          effectiveAt: z.iso.datetime(),
          reason: z.string().trim().min(3).max(2000),
        })
        .strict()
        .parse(request.body);
      const ctx = contextFor(request);
      const result = await runInTenantTransaction(
        ctx,

        /** Applies portals reads or writes with transaction-local tenant, actor and audit context. */
        async (client) =>
          client.query<Record<string, unknown>>(
            `insert into app.sign_in_out_requests(tenant_id,campus_id,student_id,requested_by_guardian_id,request_type,effective_at,reason,status)
   select $1,s.campus_id,s.id,g.id,$4,$5,$6,'submitted' from app.students s cross join app.guardians g where s.tenant_id=$1 and s.id=$2 and g.tenant_id=$1 and g.user_id=$3 and app.parent_student_access(s.id,'consent') returning id`,
            [
              ctx.tenantId,
              body.studentId,
              ctx.userId,
              body.requestType,
              body.effectiveAt,
              body.reason,
            ],
          ),
      );
      if (!result.rows[0])
        throw new ApplicationError(
          403,
          'RELATIONSHIP_REQUIRED',
          'You cannot submit an absence for this student.',
        );
      return { id: result.rows[0]['id'], status: 'submitted' };
    },
  });
  server.post('/api/v1/portal/consent', {
    preHandler: [requireSession, requireCsrf],

    /** Handles /api/v1/portal/consent using validated input and the route's authenticated authorization context. */
    handler: async (request) => {
      portalAccess(request, 'parent_guardian');
      const body = z
        .object({
          studentId: z.uuid(),
          eventId: z.uuid(),
          decision: z.enum(['granted', 'declined', 'withdrawn']),
        })
        .strict()
        .parse(request.body);
      const ctx = contextFor(request);
      return runInTenantTransaction(
        ctx,

        /** Applies portals reads or writes with transaction-local tenant, actor and audit context. */
        async (client) => {
          const result = await client.query<Record<string, unknown>>(
            `update app.event_participants p set consent_status=$4,consented_by_guardian_id=g.id,consented_at=clock_timestamp() from app.guardians g,app.events e where p.tenant_id=$1 and p.student_id=$2 and p.event_id=$3 and g.tenant_id=p.tenant_id and g.user_id=$5 and e.tenant_id=p.tenant_id and e.id=p.event_id and e.status='published' and e.ends_at>clock_timestamp() and app.parent_student_access($2,'consent') returning g.id`,
            [ctx.tenantId, body.studentId, body.eventId, body.decision, ctx.userId],
          );
          if (!result.rows[0])
            throw new ApplicationError(
              403,
              'CONSENT_UNAVAILABLE',
              'Consent is not available for this event and student.',
            );
          await client.query<Record<string, unknown>>(
            "insert into app.consent_evidence(tenant_id,event_id,student_id,decision,source,guardian_id) values($1,$2,$3,$4,'parent_portal',$5)",
            [ctx.tenantId, body.eventId, body.studentId, body.decision, result.rows[0]['id']],
          );
          return { ok: true };
        },
      );
    },
  });
  server.post('/api/v1/portal/assignments/:id', {
    preHandler: [requireSession, requireCsrf],

    /** Handles /api/v1/portal/assignments/:id using validated input and the route's authenticated authorization context. */
    handler: async (request) => {
      portalAccess(request, 'student');
      const { id } = z.object({ id: z.uuid() }).parse(request.params);
      const body = z
        .object({ studentId: z.uuid(), content: z.string().trim().min(1).max(100000) })
        .strict()
        .parse(request.body);
      const ctx = contextFor(request);
      const result = await runInTenantTransaction(
        ctx,

        /** Applies portals reads or writes with transaction-local tenant, actor and audit context. */
        async (client) =>
          client.query<Record<string, unknown>>(
            `insert into app.assignment_submissions(tenant_id,assignment_id,student_id,content)
   select $1,a.id,$3,$4 from app.assignments a join app.class_students cs on cs.tenant_id=a.tenant_id and cs.class_id=a.class_id where a.tenant_id=$1 and a.id=$2 and cs.student_id=$3 and cs.status='active' and a.status='published' and app.is_student_self($3) on conflict(tenant_id,assignment_id,student_id) do nothing returning id`,
            [ctx.tenantId, id, body.studentId, body.content],
          ),
      );
      if (!result.rows[0])
        throw new ApplicationError(
          409,
          'SUBMISSION_UNAVAILABLE',
          'This assignment is unavailable or already submitted.',
        );
      return { id: result.rows[0]['id'] };
    },
  });
  server.get('/api/v1/portal/messages', {
    preHandler: [requireSession],

    /** Handles /api/v1/portal/messages using validated input and the route's authenticated authorization context. */
    handler: async (request) => {
      const ctx = contextFor(request);
      const result = await runInTenantTransaction(
        ctx,

        /** Applies portals reads or writes with transaction-local tenant, actor and audit context. */
        async (client) =>
          client.query<Record<string, unknown>>(
            `select c.id,c.subject,c.body,c.sent_at from app.communications c where c.tenant_id=$1 and c.status='sent' and exists(select 1 from app.communication_recipients r where r.tenant_id=c.tenant_id and r.communication_id=c.id and r.user_id=$2) order by c.sent_at desc limit 100`,
            [ctx.tenantId, ctx.userId],
          ),
      );
      return { items: result.rows };
    },
  });
  server.get('/api/v1/portal/forms', {
    preHandler: [requireSession],

    /** Handles /api/v1/portal/forms using validated input and the route's authenticated authorization context. */
    handler: async (request) => {
      const category =
        request.identity?.user.category === 'student' ? 'student' : 'parent_guardian';
      portalAccess(request, category);
      const ctx = contextFor(request);
      const result = await runInTenantTransaction(
        ctx,

        /** Applies portals reads or writes with transaction-local tenant, actor and audit context. */
        async (client) =>
          client.query<Record<string, unknown>>(
            `select id,title,description,definition from app.forms where tenant_id=$1 and status='published' and collection_mode=any($2::text[]) and jsonb_typeof(definition->'questions')='array' order by title limit 100`,
            [
              ctx.tenantId,
              category === 'student' ? ['student_portal', 'any'] : ['parent_portal', 'any'],
            ],
          ),
      );
      return { items: result.rows };
    },
  });
  server.post('/api/v1/portal/forms/:id', {
    preHandler: [requireSession, requireCsrf],

    /** Handles /api/v1/portal/forms/:id using validated input and the route's authenticated authorization context. */
    handler: async (request) => {
      const category =
        request.identity?.user.category === 'student' ? 'student' : 'parent_guardian';
      portalAccess(request, category);
      const { id } = z.object({ id: z.uuid() }).parse(request.params);
      const body = z
        .object({
          studentId: z.uuid(),
          answers: z.record(
            z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/),
            z.string().max(10000),
          ),
        })
        .strict()
        .parse(request.body);
      const ctx = contextFor(request);
      return runInTenantTransaction(
        ctx,

        /** Applies portals reads or writes with transaction-local tenant, actor and audit context. */
        async (client) => {
          const row = (
            await client.query<{ definition: unknown }>(
              `select definition from app.forms where tenant_id=$1 and id=$2 and status='published' and collection_mode=any($3::text[]) for share`,
              [
                ctx.tenantId,
                id,
                category === 'student' ? ['student_portal', 'any'] : ['parent_portal', 'any'],
              ],
            )
          ).rows[0];
          if (!row)
            throw new ApplicationError(
              404,
              'FORM_UNAVAILABLE',
              'This form is no longer available.',
            );
          const definition = z
            .object({
              questions: z
                .array(
                  z.object({
                    key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/),
                    label: z.string(),
                    type: z.enum(['text', 'textarea', 'select']).default('text'),
                    required: z.boolean().default(false),
                    options: z.array(z.string()).optional(),
                  }),
                )
                .min(1)
                .max(100),
            })
            .parse(row.definition);
          if (
            new Set(
              definition.questions.map(
                /** Transforms definition.questions entries into the portals output representation. */
                (q) => q.key,
              ),
            ).size !== definition.questions.length ||
            Object.keys(body.answers).some(
              /** Selects Object.keys body.answers entries using the explicit definition.questions.some q q.key key condition. */
              (key) =>
                !definition.questions.some(
                  /** Selects definition.questions entries using the explicit q.key key condition. */
                  (q) => q.key === key,
                ),
            )
          )
            throw new ApplicationError(
              400,
              'INVALID_ANSWERS',
              'This form contains invalid answer fields.',
            );
          for (const question of definition.questions) {
            const answer = body.answers[question.key] ?? '';
            if (
              (question.required && !answer.trim()) ||
              (question.type === 'select' && answer && !question.options?.includes(answer))
            )
              throw new ApplicationError(
                400,
                'ANSWER_REQUIRED',
                `Check your answer for ${question.label}.`,
              );
          }
          const submission = await client.query<{ id: string }>(
            `insert into app.form_submissions(tenant_id,form_id,student_id,submitted_by,source,status) values($1,$2,$3,$4,$5,'submitted') returning id`,
            [
              ctx.tenantId,
              id,
              body.studentId,
              ctx.userId,
              category === 'student' ? 'internal' : 'parent_portal',
            ],
          );
          const submissionId = requiredValue(submission.rows[0]).id;
          for (const question of definition.questions)
            await client.query<Record<string, unknown>>(
              'insert into app.form_answers(tenant_id,submission_id,question_key,answer_text) values($1,$2,$3,$4)',
              [ctx.tenantId, submissionId, question.key, body.answers[question.key] ?? ''],
            );
          return { id: submissionId };
        },
      );
    },
  });
}

import { requiredValue } from '@edutex/contracts';

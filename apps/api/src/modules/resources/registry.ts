/**
 * @fileoverview Implements the Fastify backend application boundary, runtime configuration or shared server behavior consumed by Edutex API modules.
 *
 * @remarks
 * Direct links: `zod`, `@edutex/contracts`.
 * Security: Tenant-data boundary; parameterisation, same-client transaction context, RLS and relational constraints must remain intact.
 */

import { z } from 'zod';

import { roadmapResources, roadmapFieldSchema, type ResourceName } from '@edutex/contracts';

export interface ResourceField {
  readonly column: string;
  readonly schema: z.ZodType;
  readonly writable: boolean;
}

export interface ResourceConfiguration {
  readonly table: string;
  readonly permissionModule: string;
  readonly defaultSort: string;
  readonly searchColumns: readonly string[];
  readonly requiredOnCreate: readonly string[];
  readonly fields: Readonly<Record<string, ResourceField>>;
  readonly workflow?: boolean;
  readonly adminOnly?: boolean;
}

const shortText = z.string().trim().max(160);
const longText = z.string().trim().max(20_000);
const optionalShortText = shortText.nullable();
const optionalUuid = z.uuid().nullable();
const date = z.iso.date();
const dateTime = z.iso.datetime();
const status = z.string().regex(/^[a-z][a-z0-9_]{1,40}$/);

/** Defines one allowlisted API-to-SQL field mapping and rejects unsafe identifiers at startup. */
function field(column: string, schema: z.ZodType, writable = true): ResourceField {
  if (!/^[a-z][a-z0-9_]*$/.test(column)) throw new Error(`Unsafe registry column: ${column}`);
  return { column, schema, writable };
}

/**
 * This allowlist is the API's property-level authorization boundary. Request
 * fields never select database columns dynamically and unknown fields fail.
 */
export const resourceRegistry: Readonly<Record<ResourceName, ResourceConfiguration>> = {
  ...(Object.fromEntries(
    roadmapResources.map(
      /** Maps trusted shared metadata into SQL field allowlists. */ (resource) => [
        resource.name,
        {
          table: resource.table,
          permissionModule: resource.module,
          defaultSort: requiredValue(resource.fields[0]).key,
          searchColumns: resource.fields.some(
            /** Selects resource.fields entries using the explicit text textarea select .includes item.type condition. */
            (item) => ['text', 'textarea', 'select'].includes(item.type),
          )
            ? resource.fields
                .filter(
                  /** Searches only permitted scalar labels. */ (item) =>
                    ['text', 'textarea', 'select'].includes(item.type),
                )
                .map(
                  /** Uses trusted column names rather than request strings. */ (item) =>
                    item.column,
                )
            : ['id'],
          requiredOnCreate: resource.fields
            .filter(
              /** Collects required business inputs. */ (item) =>
                item.required && !(resource.workflow && item.key === 'status'),
            )
            .map(/** Returns the stable API field identifier. */ (item) => item.key),
          fields: Object.fromEntries(
            resource.fields.map(
              /** Compiles each bounded field validator. */ (item) => [
                item.key,
                field(
                  item.column,
                  roadmapFieldSchema(item),
                  !(resource.workflow && item.key === 'status'),
                ),
              ],
            ),
          ),
          ...(resource.workflow ? { workflow: true } : {}),
          ...(resource.adminOnly ? { adminOnly: true } : {}),
        },
      ],
    ),
  ) as unknown as Record<ResourceName, ResourceConfiguration>),
  students: {
    table: 'students',
    permissionModule: 'students',
    defaultSort: 'lastName',
    searchColumns: [
      'student_number',
      'first_name',
      'preferred_name',
      'last_name',
      'email',
      'year_level',
    ],
    requiredOnCreate: ['campusId', 'studentNumber', 'firstName', 'lastName', 'yearLevel'],
    fields: {
      campusId: field('campus_id', z.uuid()),
      houseId: field('house_id', optionalUuid),
      studentNumber: field('student_number', shortText),
      userId: field('user_id', optionalUuid),
      barcode: field('barcode', optionalShortText),
      firstName: field('first_name', shortText),
      preferredName: field('preferred_name', optionalShortText),
      lastName: field('last_name', shortText),
      email: field('email', z.email().nullable()),
      dateOfBirth: field('date_of_birth', date.nullable()),
      genderIdentity: field('gender_identity', optionalShortText),
      yearLevel: field('year_level', shortText),
      status: field('status', status),
    },
  },
  staff: {
    table: 'staff',
    permissionModule: 'staff',
    defaultSort: 'lastName',
    searchColumns: [
      'staff_number',
      'first_name',
      'preferred_name',
      'last_name',
      'email',
      'job_title',
    ],
    requiredOnCreate: ['staffNumber', 'firstName', 'lastName', 'email', 'jobTitle'],
    fields: {
      staffNumber: field('staff_number', shortText),
      userId: field('user_id', optionalUuid),
      firstName: field('first_name', shortText),
      preferredName: field('preferred_name', optionalShortText),
      lastName: field('last_name', shortText),
      email: field('email', z.email()),
      phone: field('phone', optionalShortText),
      jobTitle: field('job_title', shortText),
      employmentType: field('employment_type', status),
      employmentStatus: field('employment_status', status),
      teachingStaff: field('teaching_staff', z.boolean()),
      casualRelief: field('casual_relief', z.boolean()),
    },
  },
  families: {
    table: 'families',
    permissionModule: 'families',
    defaultSort: 'displayName',
    searchColumns: ['family_number', 'display_name', 'primary_email', 'primary_phone'],
    requiredOnCreate: ['familyNumber', 'displayName'],
    fields: {
      familyNumber: field('family_number', shortText),
      displayName: field('display_name', shortText),
      primaryEmail: field('primary_email', z.email().nullable()),
      primaryPhone: field('primary_phone', optionalShortText),
      suburb: field('suburb', optionalShortText),
      stateRegion: field('state_region', optionalShortText),
      postalCode: field('postal_code', optionalShortText),
      status: field('status', status),
    },
  },
  classes: {
    table: 'classes',
    permissionModule: 'classes',
    defaultSort: 'code',
    searchColumns: ['code', 'name', 'year_level'],
    requiredOnCreate: ['campusId', 'academicYearId', 'code', 'name'],
    fields: {
      campusId: field('campus_id', z.uuid()),
      academicYearId: field('academic_year_id', z.uuid()),
      timetableSetId: field('timetable_set_id', optionalUuid),
      subjectId: field('subject_id', optionalUuid),
      code: field('code', shortText),
      name: field('name', shortText),
      yearLevel: field('year_level', optionalShortText),
      capacity: field('capacity', z.number().int().positive().max(1000).nullable()),
      status: field('status', status),
    },
  },
  activities: {
    table: 'activities',
    permissionModule: 'activities',
    defaultSort: 'name',
    searchColumns: ['code', 'name', 'category'],
    requiredOnCreate: ['campusId', 'code', 'name', 'category'],
    fields: {
      campusId: field('campus_id', z.uuid()),
      timetableSetId: field('timetable_set_id', optionalUuid),
      code: field('code', shortText),
      name: field('name', shortText),
      category: field('category', shortText),
      coordinatorStaffId: field('coordinator_staff_id', optionalUuid),
      status: field('status', status),
    },
  },
  timetables: {
    table: 'timetable_sets',
    permissionModule: 'timetables',
    defaultSort: 'name',
    searchColumns: ['name', 'mode'],
    requiredOnCreate: ['campusId', 'academicYearId', 'name'],
    fields: {
      campusId: field('campus_id', z.uuid()),
      academicYearId: field('academic_year_id', z.uuid()),
      name: field('name', shortText),
      mode: field('mode', status),
      publishedAt: field('published_at', dateTime.nullable(), false),
    },
  },
  'attendance-sessions': {
    table: 'attendance_sessions',
    permissionModule: 'attendance',
    defaultSort: 'sessionDate',
    searchColumns: ['session_label', 'status'],
    requiredOnCreate: ['campusId', 'sessionDate', 'sessionLabel'],
    fields: {
      campusId: field('campus_id', z.uuid()),
      sessionDate: field('session_date', date),
      periodId: field('period_id', optionalUuid),
      classId: field('class_id', optionalUuid),
      activityId: field('activity_id', optionalUuid),
      sessionLabel: field('session_label', shortText),
      status: field('status', status),
      submittedAt: field('submitted_at', dateTime.nullable(), false),
    },
  },
  enrolments: {
    table: 'enrolment_applications',
    permissionModule: 'enrolments',
    defaultSort: 'applicationNumber',
    searchColumns: [
      'application_number',
      'applicant_first_name',
      'applicant_last_name',
      'primary_contact_email',
    ],
    requiredOnCreate: [
      'campusId',
      'applicationNumber',
      'applicantFirstName',
      'applicantLastName',
      'requestedYearLevel',
      'requestedStartYear',
      'primaryContactName',
      'primaryContactEmail',
    ],
    fields: {
      campusId: field('campus_id', z.uuid()),
      applicationNumber: field('application_number', shortText),
      applicantFirstName: field('applicant_first_name', shortText),
      applicantLastName: field('applicant_last_name', shortText),
      dateOfBirth: field('date_of_birth', date.nullable()),
      requestedYearLevel: field('requested_year_level', shortText),
      requestedStartYear: field('requested_start_year', z.number().int().min(2000).max(2200)),
      primaryContactName: field('primary_contact_name', shortText),
      primaryContactEmail: field('primary_contact_email', z.email()),
      primaryContactPhone: field('primary_contact_phone', optionalShortText),
      status: field('status', status),
    },
  },
  events: {
    table: 'events',
    permissionModule: 'events',
    defaultSort: 'startsAt',
    searchColumns: ['title', 'description', 'location'],
    requiredOnCreate: ['title', 'startsAt', 'endsAt'],
    fields: {
      campusId: field('campus_id', optionalUuid),
      title: field('title', shortText),
      description: field('description', longText),
      location: field('location', optionalShortText),
      startsAt: field('starts_at', dateTime),
      endsAt: field('ends_at', dateTime),
      capacity: field('capacity', z.number().int().positive().max(100_000).nullable()),
      consentRequired: field('consent_required', z.boolean()),
      status: field('status', status),
    },
  },
  forms: {
    table: 'forms',
    permissionModule: 'forms',
    defaultSort: 'title',
    searchColumns: ['form_key', 'title', 'description', 'form_type'],
    requiredOnCreate: ['formKey', 'title', 'formType', 'collectionMode', 'definition'],
    fields: {
      formKey: field('form_key', shortText),
      title: field('title', shortText),
      description: field('description', longText),
      formType: field('form_type', shortText),
      collectionMode: field('collection_mode', status),
      definition: field(
        'definition',
        z
          .record(z.string(), z.unknown())
          .refine(
            /** Performs the cross-field/domain validation that the surrounding Zod schema cannot express with individual field rules. It receives `value`. Direct links: `Buffer.byteLength`, `JSON.stringify`. */ (
              value,
            ) => Buffer.byteLength(JSON.stringify(value), 'utf8') <= 1_048_576,
            'Form definition is too large.',
          ),
      ),
      status: field('status', status),
      publishedAt: field('published_at', dateTime.nullable(), false),
    },
  },
  communications: {
    table: 'communications',
    permissionModule: 'communications',
    defaultSort: 'subject',
    searchColumns: ['subject', 'body', 'channel', 'status'],
    requiredOnCreate: ['channel', 'body'],
    fields: {
      templateId: field('template_id', optionalUuid),
      channel: field('channel', status),
      subject: field('subject', optionalShortText),
      body: field('body', longText),
      status: field('status', status),
      scheduledAt: field('scheduled_at', dateTime.nullable()),
      sentAt: field('sent_at', dateTime.nullable(), false),
    },
  },
  alumni: {
    table: 'alumni_profiles',
    permissionModule: 'alumni',
    defaultSort: 'lastName',
    searchColumns: [
      'first_name',
      'last_name',
      'preferred_email',
      'current_organisation',
      'current_position',
    ],
    requiredOnCreate: ['firstName', 'lastName'],
    fields: {
      studentId: field('student_id', optionalUuid),
      firstName: field('first_name', shortText),
      lastName: field('last_name', shortText),
      preferredEmail: field('preferred_email', z.email().nullable()),
      phone: field('phone', optionalShortText),
      graduationYear: field('graduation_year', z.number().int().min(1900).max(2200).nullable()),
      currentOrganisation: field('current_organisation', optionalShortText),
      currentRole: field('current_position', optionalShortText),
      mentoringAvailable: field('mentoring_available', z.boolean()),
      communicationConsent: field('communication_consent', z.boolean()),
    },
  },
  assessments: {
    table: 'assessments',
    permissionModule: 'grades',
    defaultSort: 'title',
    searchColumns: ['title', 'description', 'assessment_type', 'status'],
    requiredOnCreate: ['classId', 'title', 'assessmentType', 'maximumScore'],
    fields: {
      classId: field('class_id', z.uuid()),
      title: field('title', shortText),
      description: field('description', longText),
      assessmentType: field('assessment_type', shortText),
      maximumScore: field('maximum_score', z.number().positive().max(1_000_000)),
      weightPercent: field('weight_percent', z.number().min(0).max(100).nullable()),
      dueAt: field('due_at', dateTime.nullable()),
      status: field('status', status),
    },
  },
  'finance-accounts': {
    table: 'chart_of_accounts',
    permissionModule: 'finance',
    defaultSort: 'accountCode',
    searchColumns: ['account_code', 'name', 'account_type'],
    requiredOnCreate: ['accountCode', 'name', 'accountType', 'normalBalance'],
    fields: {
      parentAccountId: field('parent_account_id', optionalUuid),
      accountCode: field('account_code', shortText),
      name: field('name', shortText),
      accountType: field('account_type', status),
      normalBalance: field('normal_balance', z.enum(['debit', 'credit'])),
      active: field('active', z.boolean()),
    },
  },
  invoices: {
    table: 'invoices',
    workflow: true,
    permissionModule: 'finance',
    defaultSort: 'issueDate',
    searchColumns: ['invoice_number', 'status', 'notes'],
    requiredOnCreate: ['invoiceNumber', 'issueDate', 'dueDate'],
    fields: {
      familyId: field('family_id', optionalUuid),
      invoiceNumber: field('invoice_number', shortText),
      issueDate: field('issue_date', date),
      dueDate: field('due_date', date),
      status: field('status', status, false),
      currencyCode: field('currency_code', z.string().regex(/^[A-Z]{3}$/)),
      subtotal: field('subtotal', z.number().nonnegative().max(1_000_000_000)),
      taxTotal: field('tax_total', z.number().nonnegative().max(1_000_000_000)),
      balanceDue: field('balance_due', z.number().nonnegative().max(1_000_000_000), false),
      notes: field('notes', longText),
    },
  },
  'knowledge-articles': {
    table: 'knowledge_articles',
    permissionModule: 'knowledge-base',
    defaultSort: 'title',
    searchColumns: ['slug', 'title', 'summary', 'body_markdown'],
    requiredOnCreate: ['slug', 'title', 'bodyMarkdown'],
    fields: {
      slug: field('slug', z.string().regex(/^[a-z0-9][a-z0-9-]{1,120}$/)),
      title: field('title', shortText),
      summary: field('summary', z.string().max(1000)),
      bodyMarkdown: field('body_markdown', z.string().max(2_000_000)),
      audience: field('audience', status),
      status: field('status', status),
      publishedAt: field('published_at', dateTime.nullable(), false),
    },
  },
  'sign-in-out-requests': {
    table: 'sign_in_out_requests',
    permissionModule: 'sign-in-out',
    defaultSort: 'effectiveAt',
    searchColumns: ['request_type', 'reason', 'status'],
    requiredOnCreate: ['campusId', 'studentId', 'requestType', 'effectiveAt', 'reason'],
    fields: {
      campusId: field('campus_id', z.uuid()),
      studentId: field('student_id', z.uuid()),
      requestedByGuardianId: field('requested_by_guardian_id', optionalUuid),
      requestType: field('request_type', status),
      requestedAt: field('requested_at', dateTime, false),
      effectiveAt: field('effective_at', dateTime),
      reason: field('reason', z.string().max(2000)),
      status: field('status', status),
      reviewedAt: field('reviewed_at', dateTime.nullable(), false),
    },
  },
};

/** Validates a mutation and rejects unknown/read-only properties before SQL generation. */
export function validateMutationFields(
  configuration: ResourceConfiguration,
  input: Readonly<Record<string, unknown>>,
  requireAll: boolean,
): readonly (readonly [string, ResourceField, unknown])[] {
  const entries: (readonly [string, ResourceField, unknown])[] = [];
  for (const key of Object.keys(input)) {
    const definition = configuration.fields[key];
    if (!definition?.writable) {
      throw new z.ZodError([
        {
          code: 'unrecognized_keys',
          keys: [key],
          path: [],
          message: `Unknown or read-only field: ${key}`,
        },
      ]);
    }
    entries.push([key, definition, definition.schema.parse(input[key])]);
  }
  if (requireAll) {
    const missing = configuration.requiredOnCreate.filter(
      /** Keeps only input items that satisfy this predicate before `validateMutationFields` continues its lookup, render or request construction. It receives `key`. It uses only the local values shown in its body. */ (
        key,
      ) => !(key in input),
    );
    if (missing.length > 0) {
      throw new z.ZodError([
        { code: 'custom', path: [], message: `Missing required fields: ${missing.join(', ')}` },
      ]);
    }
  }
  return entries;
}

import { requiredValue } from '@edutex/contracts';

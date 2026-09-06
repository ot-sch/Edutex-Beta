/**
 * @fileoverview Implements a controlled operator, provisioning, migration, deployment or quality-assurance utility executed outside the long-running API.
 *
 * @remarks
 * Direct links: `node:crypto`, `node:fs/promises`, `@aws-sdk/client-s3`, `@edutex/database`, `zod`, `./legacy-values.js`.
 * Security: Privileged operator boundary; fail closed, keep secrets out of arguments/files/logs and retain approved evidence.
 */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { closeDatabase, createDatabasePool, runInSystemTransaction } from '@edutex/database';
import { z } from 'zod';

import { booleanValue, choiceValue, positiveIntegerValue } from './legacy-values.js';

const rowSchema = z.object({
  id: z.string().min(1).max(500),
  position: z.number().int().optional(),
  data: z.record(z.string(), z.unknown()),
  updated_at: z.string().optional(),
  updated_by: z.string().optional(),
});
const snapshotSchema = z.record(z.string(), z.array(rowSchema));

/** Selects the first non-empty legacy text alias and applies a deterministic fallback. */
function text(record: Record<string, unknown>, keys: readonly string[], fallback = ''): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return fallback;
}

interface MigrationContext {
  readonly tenantId: string;
  readonly campusId: string;
  readonly academicYearId: string;
}

/** Maps prototype JSON documents into typed relational columns and stable foreign keys. */
async function applySnapshot(
  snapshot: z.infer<typeof snapshotSchema>,
  context: MigrationContext,
): Promise<Record<string, number>> {
  return runInSystemTransaction(
    /** Executes the `applySnapshot` privileged database work on one controlled PostgreSQL transaction reserved for bootstrap/identity system operations. It receives `client`. Direct links: `client.query`, `client .query<{ id: string }>( 'insert into a`, `client .query`, `text`, `choiceValue`. */ async (
      client,
    ) => {
      await client.query(
        `select set_config('app.migration_mode', 'legacy-supabase', true),
              set_config('app.tenant_id', $1, true),
              set_config('app.permissions', '["platform:manage"]', true),
              set_config('app.request_id', 'legacy-migration', true)`,
        [context.tenantId],
      );
      const counts: Record<string, number> = {};
      for (const row of snapshot.edutex_students ?? []) {
        const data = row.data;
        await client
          .query<{ id: string }>(
            `insert into app.students (
           id, tenant_id, campus_id, student_number, first_name, preferred_name,
           last_name, email, date_of_birth, year_level, status
         ) values (
           coalesce((select new_id from migration.legacy_identifiers where tenant_id = $1 and entity_type = 'student' and legacy_id = $2), gen_random_uuid()),
           $1, $3, $4, $5, nullif($6, ''), $7, nullif($8, '')::public.citext,
           nullif($9, '')::date, $10, $11
         ) on conflict (tenant_id, student_number) do update set
           first_name = excluded.first_name, preferred_name = excluded.preferred_name,
           last_name = excluded.last_name, email = excluded.email,
           date_of_birth = excluded.date_of_birth, year_level = excluded.year_level
         returning id`,
            [
              context.tenantId,
              row.id,
              context.campusId,
              text(data, ['studentNumber', 'studentId', 'id'], row.id),
              text(data, ['firstName', 'first_name'], 'Unknown'),
              text(data, ['preferredName', 'preferred_name']),
              text(data, ['lastName', 'last_name', 'surname'], 'Unknown'),
              text(data, ['email']),
              text(data, ['dateOfBirth', 'dob']),
              text(data, ['yearLevel', 'year', 'grade'], 'Unknown'),
              choiceValue(
                data,
                ['status'],
                ['prospective', 'enrolled', 'current', 'leaver', 'alumni', 'archived'] as const,
                'current',
                {
                  active: 'current',
                  inactive: 'archived',
                  withdrawn: 'leaver',
                  graduated: 'alumni',
                },
              ),
            ],
          )
          .then(
            /** Performs the local `client .query<{ id: string }>( 'insert into app.students ( i` operation inside `applySnapshot` and returns control to the surrounding feature only after this body completes. It receives `result`. Direct links: `client.query`. */ async (
              result,
            ) => {
              const id = result.rows[0]?.id;
              if (id)
                await client.query(
                  `insert into migration.legacy_identifiers (tenant_id, entity_type, legacy_id, new_id)
           values ($1, 'student', $2, $3) on conflict do nothing`,
                  [context.tenantId, row.id, id],
                );
            },
          );
        counts.students = (counts.students ?? 0) + 1;
      }
      for (const row of snapshot.edutex_families ?? []) {
        const data = row.data;
        await client.query(
          `insert into app.families (tenant_id, family_number, display_name, primary_email, primary_phone, suburb, state_region, postal_code, status)
         values ($1, $2, $3, nullif($4, '')::public.citext, nullif($5, ''), nullif($6, ''), nullif($7, ''), nullif($8, ''), $9)
         on conflict (tenant_id, family_number) do update set display_name = excluded.display_name,
           primary_email = excluded.primary_email, primary_phone = excluded.primary_phone`,
          [
            context.tenantId,
            text(data, ['familyNumber', 'familyId', 'id'], row.id),
            text(data, ['displayName', 'familyName', 'name'], 'Unknown family'),
            text(data, ['primaryEmail', 'email']),
            text(data, ['primaryPhone', 'phone']),
            text(data, ['suburb']),
            text(data, ['state', 'stateRegion']),
            text(data, ['postcode', 'postalCode']),
            choiceValue(data, ['status'], ['active', 'inactive', 'archived'] as const, 'active', {
              current: 'active',
            }),
          ],
        );
        counts.families = (counts.families ?? 0) + 1;
      }
      for (const row of snapshot.edutex_staff ?? []) {
        const data = row.data;
        await client.query(
          `insert into app.staff (
           tenant_id, staff_number, first_name, preferred_name, last_name, email,
           phone, job_title, employment_type, employment_status, teaching_staff, casual_relief
         ) values ($1, $2, $3, nullif($4, ''), $5, $6::public.citext, nullif($7, ''), $8, $9, $10, $11, $12)
         on conflict (tenant_id, staff_number) do update set first_name = excluded.first_name,
           preferred_name = excluded.preferred_name, last_name = excluded.last_name,
           email = excluded.email, job_title = excluded.job_title`,
          [
            context.tenantId,
            text(data, ['staffNumber', 'staffId', 'id'], row.id),
            text(data, ['firstName', 'first_name'], 'Unknown'),
            text(data, ['preferredName']),
            text(data, ['lastName', 'surname'], 'Unknown'),
            text(data, ['email'], `${row.id}@legacy.invalid`),
            text(data, ['phone']),
            text(data, ['jobTitle', 'role'], 'Staff member'),
            choiceValue(
              data,
              ['employmentType'],
              ['ongoing', 'fixed_term', 'casual', 'contractor'] as const,
              'ongoing',
              {
                permanent: 'ongoing',
                full_time: 'ongoing',
                part_time: 'ongoing',
                fixedterm: 'fixed_term',
              },
            ),
            choiceValue(
              data,
              ['employmentStatus', 'status'],
              ['active', 'leave', 'inactive', 'archived'] as const,
              'active',
              { current: 'active', on_leave: 'leave' },
            ),
            booleanValue(data, ['teachingStaff', 'isTeacher']),
            booleanValue(data, ['casualRelief']),
          ],
        );
        counts.staff = (counts.staff ?? 0) + 1;
      }
      for (const row of snapshot.edutex_classes ?? []) {
        const data = row.data;
        await client.query(
          `insert into app.classes (tenant_id, campus_id, academic_year_id, code, name, year_level, capacity, status)
         values ($1, $2, $3, $4, $5, nullif($6, ''), $7, $8)
         on conflict (tenant_id, academic_year_id, code) do update set name = excluded.name,
           year_level = excluded.year_level, capacity = excluded.capacity`,
          [
            context.tenantId,
            context.campusId,
            context.academicYearId,
            text(data, ['code', 'classCode', 'id'], row.id),
            text(data, ['name', 'className'], row.id),
            text(data, ['yearLevel', 'year']),
            positiveIntegerValue(data, ['capacity']),
            choiceValue(
              data,
              ['status'],
              ['planned', 'active', 'completed', 'archived'] as const,
              'active',
              { current: 'active', inactive: 'archived' },
            ),
          ],
        );
        counts.classes = (counts.classes ?? 0) + 1;
      }
      await client.query(
        `select audit.append_event($1, null, 'migration.legacy_snapshot', 'migration', null,
         'success', null, null, jsonb_build_object('counts', $2::jsonb))`,
        [context.tenantId, JSON.stringify(counts)],
      );
      return counts;
    },
  );
}

/** Reads a local protected file or an encrypted private S3 staging object. */
async function readSnapshot(location: string): Promise<string> {
  if (!location.startsWith('s3://')) return readFile(location, 'utf8');
  const url = new URL(location);
  const bucket = url.hostname;
  const key = url.pathname.replace(/^\//, '');
  if (!bucket || !key.startsWith('migration-input/')) {
    throw new Error('S3 snapshots must use the approved migration-input/ prefix.');
  }
  const result = await new S3Client({
    ...(process.env.AWS_REGION ? { region: process.env.AWS_REGION } : {}),
  }).send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!result.Body) throw new Error('S3 did not return the migration snapshot body.');
  return result.Body.transformToString('utf8');
}

/** Validates and either plans or applies an offline Supabase JSON export. */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const file = args.find(
    /** Selects the first input item matching this lookup condition for `main`; no match deliberately returns undefined. It receives `value`. Direct links: `value.endsWith`. */ (
      value,
    ) => value.endsWith('.json'),
  );
  if (!file) throw new Error('Supply a local or s3:// JSON export location.');
  const tenantId = args[args.indexOf('--tenant-id') + 1];
  const campusId = args[args.indexOf('--campus-id') + 1];
  const academicYearId = args[args.indexOf('--academic-year-id') + 1];
  const input = await readSnapshot(file);
  const snapshot = snapshotSchema.parse(JSON.parse(input) as unknown);
  const summary = Object.fromEntries(
    Object.entries(snapshot).map(
      /** Transforms each input item for `main` into the derived value or React element consumed by the surrounding collection. It receives `[table, rows]`. It uses only the local values shown in its body. */ ([
        table,
        rows,
      ]) => [table, rows.length],
    ),
  );
  const digest = createHash('sha256').update(input).digest('hex');
  process.stdout.write(
    `Validated legacy snapshot ${digest}.\n${JSON.stringify(summary, null, 2)}\n`,
  );
  if (!apply) {
    process.stdout.write(
      'Plan only: no database rows were changed. Review unsupported tables and field mappings before --apply.\n',
    );
    return;
  }
  const context = z
    .object({ tenantId: z.uuid(), campusId: z.uuid(), academicYearId: z.uuid() })
    .parse({ tenantId, campusId, academicYearId });
  await createDatabasePool();
  const counts = await applySnapshot(snapshot, context);
  process.stdout.write(`Migration committed: ${JSON.stringify(counts)}\n`);
}

try {
  await main();
} finally {
  await closeDatabase();
}

# Prototype-to-production migration matrix

Release baseline: 1.0.0-rc.5 / 2026-08-12

The uploaded prototype used sequential patch scripts, duplicated portal logic, browser storage and
Supabase JSON document rows. Production does not execute or ship those files. Preserve the original
export read-only until school owners sign reconciliation and the legal retention decision.

## Automated legacy import coverage

`scripts/migrate-legacy.ts` validates an offline JSON snapshot, hashes it, supports plan-only mode
and uses one transaction with a stable legacy-ID registry. Production invokes it through a private
one-shot Fargate task that can read only a KMS-encrypted `migration-input/` object in the files
bucket; current and noncurrent staging versions expire after eight days. **Only these collections
are automatically mapped:**

| Prototype collection | Production tables                          | Coverage                                     |
| -------------------- | ------------------------------------------ | -------------------------------------------- |
| `edutex_students`    | `students`, `migration.legacy_identifiers` | Core identity/demographic fields             |
| `edutex_families`    | `families`                                 | Core family contact fields                   |
| `edutex_staff`       | `staff`                                    | Core employment/contact fields               |
| `edutex_classes`     | `classes`                                  | Core class fields using supplied campus/year |

Unknown fields are not silently put back into a generic JSON blob. They must receive an approved
typed mapping, transformation/default rule and reconciliation check.

## Required mapping/reconciliation by module

| Module                             | Production model exists | Import status                       | Required migration decision                                                    |
| ---------------------------------- | ----------------------- | ----------------------------------- | ------------------------------------------------------------------------------ |
| Tenancy, campuses, years and terms | Yes                     | Bootstrap creates current structure | Map historical calendars/campuses explicitly                                   |
| Users, roles and permissions       | Yes                     | New identity seed only              | Re-provision users through Cognito/SSO; never import password/session material |
| Students                           | Yes                     | Core automated                      | Map tags, houses, families, photos, sensitive fields and status values         |
| Families and guardians             | Yes                     | Families core only                  | Map guardians and relationship join tables with consent/contact validation     |
| Staff and departments              | Yes                     | Staff core only                     | Map departments, campus assignment and staff roles                             |
| Classes and subjects               | Yes                     | Classes core only                   | Map subject, teacher/student joins and capacities                              |
| Timetables, rooms and periods      | Yes                     | Not automated                       | Normalize sets, periods, rooms and entries; verify collisions                  |
| Activities                         | Yes                     | Not automated                       | Map coordinators, participants, dates and statuses                             |
| Attendance, movements and alerts   | Yes                     | Not automated                       | Preserve source timestamps/reasons and reconcile daily totals                  |
| Assessments and grades             | Yes                     | Not automated                       | Validate scale, maximums, weighting and per-student results                    |
| Enrolments                         | Yes                     | Not automated                       | Map applicant/contact fields and workflow status history                       |
| Finance                            | Yes                     | Not automated                       | Accountant-approved chart/journal/invoice/payment mapping; prove balances      |
| Forms and submissions              | Yes                     | Not automated                       | Version form definitions; normalize answers; sanitize legacy dynamic content   |
| Communications                     | Yes                     | Not automated                       | Map templates/messages/recipients; preserve consent and delivery status        |
| Events                             | Yes                     | Not automated                       | Map time zones, participants, capacity and consent                             |
| Alumni                             | Yes                     | Not automated                       | Validate consent and relationship to former student                            |
| Photos and files                   | Yes                     | Re-upload required                  | Re-encode through production pipeline; do not copy unscanned object keys       |
| Knowledge base                     | Yes                     | Not automated                       | Treat legacy HTML/Markdown as untrusted; sanitize before publish               |
| Sign-in and sign-out               | Yes                     | Not automated                       | Map requests/reviews with immutable timestamps                                 |
| Module and home layout             | Yes                     | Defaults created                    | School admin reviews module visibility/order; no legacy executable layout      |
| Audit and history                  | New hash chain          | Do not merge into chain             | Retain legacy logs separately with provenance; new chain begins at cutover     |

## Migration process

1. Freeze prototype writes and export through an approved, logged process.
2. Hash and store the original encrypted export; work on a sanitized copy where possible.
3. Run plan validation and inventory collection/field counts, nulls, enums and relationships.
4. Approve mapping/default/rejection rules per school/data owner.
5. Extend the migrator with typed transformations and tests; never fallback unknown data to JSONB.
6. Rehearse in an isolated production-like database and measure locks/duration/storage.
7. Import in the cutover transaction/window; record digest and counts in audit evidence.
8. Reconcile counts, key totals, sampled records, relationships, finance balances, attendance totals
   and file hashes. Obtain business-owner sign-off.
9. Keep prototype read-only for the approved verification/retention period, then securely dispose
   under legal hold/records policy.

Do not use Supabase API keys or a browser to move production data. The migrator consumes a
controlled offline export and writes as the private migrator role.

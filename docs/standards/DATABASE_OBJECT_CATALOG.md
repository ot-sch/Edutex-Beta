# PostgreSQL object catalogue

Release baseline: 1.0.0-rc.5 / 2026-08-12

Owner: Data Engineering  
Reviewers: Database Engineering, Application Security and the relevant domain owner

## How to use this catalogue

This index explains the responsibility and link of every immutable migration. Applied migration
files are checksum-controlled by `packages/database/src/migrate.ts` and must never be edited to add
or improve comments. New explanations correct this catalogue; behavior changes use a new numbered
migration, a rehearsal, rollback/roll-forward decision and review.

Every application query enters through `packages/database/src/client.ts`, which opens a transaction,
sets transaction-local tenant/user/request/permission context and executes parameterized SQL. The
browser never reaches these objects. Runtime access uses the restricted `edutex_app` role through
RDS Proxy with IAM authentication and verified TLS. Migration/provisioning roles are separate.

## Migration map

| Migration                                       | Responsibility                                                                                                                                                   | Direct links and security effect                                                                                                                                               |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `0001_core_identity.sql`                        | Creates schemas/roles and the tenant, domain, campus, year, user, role, permission, authentication-policy, provider, mapping, invitation and encryption-key core | Supplies identity/tenant keys used by every later migration; exposes transaction-context helpers and the shared update trigger; composite tenant keys block cross-school links |
| `0002_people_academics.sql`                     | Normalises files, houses, departments, families, guardians, students, staff, subjects, rooms, timetables, classes and activities                                 | Links every relationship through `tenant_id`; isolates encrypted student-field ciphertext from ordinary student rows                                                           |
| `0003_school_operations.sql`                    | Adds attendance, movement, assessments, finance, enrolment, forms, events, communications, alumni, knowledge, sign-in/out and module layout                      | Uses typed/check-constrained relational records; keeps genuinely dynamic form/evidence shapes in bounded JSONB only                                                            |
| `0004_security_audit_rls.sql`                   | Adds permission resolution, idempotency, exports/webhooks, append-only audit, finance guards, public hostname resolution and RLS                                 | Enables/forces tenant policies on application tables, hash-chains/redacts audit state and prevents audit or posted-journal mutation                                            |
| `0005_governance_provisioning.sql`              | Adds retention, holds, DSR, incidents, access reviews, restore tests, risk acceptance and default tenant provisioning                                            | Provides operating evidence objects and one transaction-safe default-provisioning function used by school bootstrap                                                            |
| `0006_authentication_runtime.sql`               | Resolves public branding/auth policy and establishes/refreshes a tenant identity from verified broker claims                                                     | Converts trusted Cognito/federation identity into internal user/role state; handles bracketed claims and fails closed on invalid/no mapping                                    |
| `0007_legacy_migration_registry.sql`            | Records a stable mapping from prototype identifiers to new relational UUIDs                                                                                      | Makes rehearsal/apply idempotent and prevents an old identifier from silently mapping to another tenant/entity                                                                 |
| `0008_tenant_module_visibility.sql`             | Stores per-school home/module visibility with row versions, RLS and audit                                                                                        | Connects the admin module and portal menu while preserving server authorization even when a module is hidden                                                                   |
| `0009_federated_entitlement_reconciliation.sql` | Replaces the identity-session function with current provider-scoped entitlement reconciliation                                                                   | Removes stale directory-managed grants on sign-in and denies no-match/conflicting unapproved access                                                                            |

## Core functions and triggers

| Object                                  | Called by / points to                | Exact responsibility and failure boundary                                                                                                   |
| --------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `app.current_tenant_id()`               | RLS policies and authorization SQL   | Reads `app.tenant_id` set locally by the API transaction; returns no tenant outside that transaction rather than sharing pool state         |
| `app.current_user_id()`                 | RLS/audit functions                  | Reads the transaction-local actor UUID for policy and attribution                                                                           |
| `app.current_request_id()`              | audit capture                        | Reads the transaction-local request identifier for traceability                                                                             |
| `app.has_permission(text)`              | policy/authorization functions       | Tests only the transaction-local, source-allowlisted permission set supplied after API authorization                                        |
| `app.authorized(text,text)`             | RLS policies                         | Combines current tenant/permission/module rules; denial is the default                                                                      |
| `app.resolve_user_permissions(uuid)`    | API identity refresh                 | Returns effective permission strings for the exact tenant user                                                                              |
| `app.set_updated_metadata()`            | update triggers                      | Advances update timestamp and row version for optimistic concurrency                                                                        |
| `audit.redact_state(jsonb)`             | audit append/capture                 | Removes configured secret/ciphertext fields before audit persistence                                                                        |
| `audit.append_event(...)`               | explicit audit calls                 | Appends a tenant/actor/request event and links its hash to the previous event                                                               |
| `audit.reject_mutation()`               | `audit_events_immutable`             | Rejects UPDATE/DELETE on append-only audit rows                                                                                             |
| `audit.capture_row_change()`            | table audit triggers                 | Converts INSERT/UPDATE/DELETE state into a redacted chained event                                                                           |
| `app.reject_posted_journal_mutation()`  | journal trigger                      | Rejects mutation of posted financial entries                                                                                                |
| `app.validate_posted_journal_balance()` | journal posting trigger              | Rejects an unbalanced entry at the database boundary                                                                                        |
| `app.resolve_public_tenant(text)`       | unauthenticated branding/login start | Resolves only an active exact hostname and returns a narrow non-secret tenant view                                                          |
| `app.provision_tenant_defaults(...)`    | private school-bootstrap task        | Seeds default roles, permissions, modules and related baseline rows inside one tenant transaction                                           |
| `app.resolve_auth_runtime(uuid)`        | authentication BFF                   | Returns bounded tenant authentication/provider runtime configuration                                                                        |
| `app.resolve_public_branding(text,...)` | public auth client                   | Returns replaceable login branding/method choices without protected portal data                                                             |
| `app.claim_contains(text,text)`         | federated mapping                    | Decodes/compares Cognito's bounded multi-value claim representation exactly                                                                 |
| `app.establish_identity_session(...)`   | OAuth callback                       | Creates/updates the internal identity and reconciles only enabled, exact provider mappings; the 0009 definition supersedes 0006             |
| `app.refresh_session_identity(...)`     | authenticated session hook           | Refreshes active/status/roles/permissions so disabled users and removed directory grants stop taking effect within the bounded cache window |
| `app.resolve_enabled_modules(uuid)`     | portal/admin API                     | Returns only modules enabled for the exact tenant; it does not grant permission to use them                                                 |

## Relational table domains

All listed application tables have a primary key. Tenant-owned relationships use tenant-aware
unique/composite foreign keys where required so a valid UUID from another school cannot satisfy a
relationship.

| Domain             | Tables                                                                                                                                                                                                              | Responsibility                                                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Tenant/identity    | `tenants`, `tenant_domains`, `campuses`, `academic_years`, `terms`, `users`, `roles`, `permissions`, `role_permissions`, `user_roles`, `user_campuses`                                                              | School scope, organisational calendar and deny-by-default internal identity/permission graph                                     |
| Authentication     | `authentication_policies`, `identity_providers`, `directory_role_mappings`, `bootstrap_invitations`, `tenant_encryption_keys`                                                                                       | Per-school login methods, staged providers, exact claim mapping, initial-admin invitation state and tenant KMS envelope metadata |
| People             | `files`, `houses`, `departments`, `families`, `guardians`, `family_guardians`, `students`, `student_families`, `student_tags`, `student_sensitive_fields`, `staff`, `staff_campuses`, `staff_departments`           | Normalised student/staff/family structures and separately encrypted high-sensitivity fields                                      |
| Academics          | `subjects`, `rooms`, `timetable_sets`, `timetable_periods`, `classes`, `class_staff`, `class_students`, `activities`, `activity_participants`, `timetable_entries`, `assessments`, `grade_results`                  | Teaching, allocation, schedules, assessment definitions and results                                                              |
| Attendance/welfare | `attendance_sessions`, `attendance_marks`, `student_movements`, `attendance_alerts`, `sign_in_out_requests`                                                                                                         | Time-bound attendance/movement evidence and workflow state                                                                       |
| Enrolment/finance  | `enrolment_applications`, `chart_of_accounts`, `journal_entries`, `journal_lines`, `invoices`, `invoice_lines`, `payments`, `budgets`                                                                               | Typed applications and balanced/immutable-after-posting financial records                                                        |
| Forms/workflow     | `forms`, `form_submissions`, `form_answers`, `form_review_log`                                                                                                                                                      | Versioned form definitions and relational submission/answer/review state                                                         |
| Community/content  | `events`, `event_participants`, `communication_templates`, `communications`, `communication_recipients`, `communication_rules`, `alumni_profiles`, `alumni_engagements`, `alumni_mentorships`, `knowledge_articles` | School communication, event, alumni and knowledge features                                                                       |
| Experience         | `module_layouts`, `tenant_modules`                                                                                                                                                                                  | Per-user layout and per-school feature publication; server permissions remain authoritative                                      |
| Integration/jobs   | `idempotency_keys`, `export_jobs`, `webhook_endpoints`, `webhook_attempts`                                                                                                                                          | Retry deduplication, controlled export lifecycle and bounded outbound integration delivery                                       |
| Governance         | `data_retention_policies`, `legal_holds`, `data_subject_requests`, `security_incidents`, `access_review_campaigns`, `access_review_items`, `backup_restore_tests`, `risk_acceptances`                               | Operational ISO/privacy/security/quality evidence and accountable decisions                                                      |
| Audit/migration    | `audit.events`, `migration.legacy_identifiers`                                                                                                                                                                      | Append-only redacted hash-chain events and tenant-bound legacy-ID reconciliation                                                 |

## JSONB decision

JSONB is not the general storage model. It is allowed only for bounded, validated shapes that are
genuinely variable or evidence snapshots—for example versioned form schema, safe audit state,
provider metadata or a controlled rule payload. Stable searchable business values remain typed
columns with constraints and foreign keys. Every JSONB boundary is parsed by a source-controlled
contract before use; dynamic SQL identifiers never come from JSON.

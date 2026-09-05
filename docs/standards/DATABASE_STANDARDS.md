# Edutex PostgreSQL database standards

Document owner: Data Engineering  
Database: Aurora PostgreSQL 16  
Version: 1.0.0-rc.5 / 2026-08-12

## 1. Core principles

PostgreSQL is the authoritative transactional store. The browser never connects to it. Only the API
runtime role and controlled one-shot deployment roles have network and database access.

The model is relational by default. A business entity is a table; a relationship is a foreign key; a
constrained state is a checked value; uniqueness is a database constraint. JSONB is not a shortcut
for schema design.

## 2. Naming and schemas

- Use lowercase `snake_case`. Tables are plural business nouns; columns are singular.
- Business tables live in `app`, immutable security events in `audit`, and migration bookkeeping in
  `migration`.
- Constraint and index names state table and purpose. Avoid quoted mixed-case identifiers.
- Every table/column with non-obvious semantics needs a SQL comment or standards entry.
- Store all timestamps as `timestamptz` in UTC. Use `date` only for calendar dates and explicit IANA
  timezone names for local interpretation.

## 3. Keys and tenant integrity

1. Stable entities use a UUID primary key generated in PostgreSQL. Join/relationship tables use a
   meaningful composite primary key where it prevents duplicates.
2. Every tenant-owned entity contains `tenant_id uuid not null` referencing `app.tenants(id)`.
3. Tenant entity tables expose `unique (tenant_id, id)`. Cross-table tenant relationships reference
   `(tenant_id, id)`, never an ID alone, so cross-tenant relationships are structurally impossible.
4. Choose `on delete` explicitly. Use cascade only for true ownership, restrict for
   evidence/finance, and set null only when losing the optional relationship preserves valid
   meaning.
5. Natural business identifiers such as student number, staff number, class code or invoice number
   receive a tenant-scoped unique constraint.
6. Foreign-key columns and frequent tenant/time lookup paths require matching indexes.

## 4. Normalization and JSONB policy

Core data targets third normal form: facts occur once, repeating groups become child tables and
many-to-many relationships become join tables. Denormalization requires a measured query problem,
documented refresh semantics and an owner.

JSONB is permitted only for:

- bounded, versioned structures whose fields are defined by a school at runtime (form definition);
- immutable/redacted audit before/after evidence and small metadata;
- bounded external directory claim input before it is mapped into relational roles;
- idempotency response snapshots or webhook payload metadata with retention controls.

JSONB must have a type/size check, documented schema version and no credential. Frequently queried,
related, unique, permission-sensitive or reportable fields must be normal columns. Arrays are
allowed for small atomic configuration values (for example OIDC scopes), not relationships.

## 5. Types and constraints

- Use `citext` for case-insensitive identity/domain/email keys while retaining display values
  separately where needed.
- Use `numeric(p,s)` for money and assessed numeric values; never floating point.
- Use `bytea` for ciphertext/hashes and record the algorithm/key reference separately.
- Use `text` plus a `check` for controlled states when PostgreSQL enum migration friction outweighs
  its benefit. Every state transition is still enforced by business logic and transaction tests.
- Apply `not null` unless absence has defined meaning. Prefer null to magic empty/zero dates.
- Bound values, JSON size, date order, financial balance and mutually exclusive relationships with
  `check` constraints.
- Store phone/postcode identifiers as text, not numbers.

## 6. Row metadata and concurrency

Mutable entities contain `created_at`, `updated_at` and `row_version`. The standard update trigger
sets UTC `updated_at` and increments `row_version`. API update/delete operations compare the
supplied version and return conflict instead of silently overwriting another client’s work.

Creation/actor columns reference an internal user with a tenant-composite key when the record must
preserve provenance. Do not trust actor IDs supplied by the browser.

## 7. Tenant row-level security

- Enable RLS on every tenant-owned table before runtime access is granted.
- Policies require `tenant_id = app.current_tenant_id()` plus the module/action permission.
- Sensitive ciphertext and encryption-key metadata use dedicated field permissions.
- Request context is set with transaction-local `set_config`; pooled connections must never retain
  context after commit/rollback.
- Security-definer functions are narrow, set an explicit safe `search_path`, revoke public execute
  and validate tenant/context internally.
- The runtime role does not own tables, create schemas/roles, bypass RLS or write audit events.
- Automated tests must attempt wrong-tenant select/insert/update/delete using valid IDs from another
  tenant.

## 8. SQL construction

All values use PostgreSQL parameters. String interpolation is prohibited for request-derived values.
Dynamic identifiers are accepted only from a compile-time registry and pass a defensive identifier
regex before quoting.

Queries select the minimum columns required. Pagination has a bounded page size and stable tie-break
sort. Expensive report/export operations must move to asynchronous jobs with tenant and user quotas.
Production statements time out after 15 seconds; known long-running administration statements use a
separate controlled role/window.

## 9. Roles, connections and transport

| Role              | Purpose                                      | Authentication/path                                                        |
| ----------------- | -------------------------------------------- | -------------------------------------------------------------------------- |
| `edutex_app`      | Long-running API, DML and approved functions | RDS Proxy, IAM token, TLS verify-full                                      |
| `edutex_migrator` | DDL, migrations, bootstrap and legacy import | One-shot task, Secrets Manager bootstrap credential, direct private writer |

Production runtime password authentication and non-verifying TLS are rejected by configuration.
Pools are bounded, use UTC, have connection lifetime below IAM token lifetime and shut down
gracefully. RDS Proxy requires TLS and IAM authentication for the runtime path.

## 10. Migrations

1. Files are immutable, four-digit ordered and named `NNNN_business_description.sql`.
2. The runner computes SHA-256 and refuses changed applied history.
3. Each migration is one transaction. Non-transactional operations require a separately approved
   runbook and resumable design.
4. Additive/expand-contract changes are preferred. Deploy code compatible with both phases before a
   destructive contract migration.
5. A migration includes constraints, indexes, RLS, privileges, audit/update triggers and backfill -
   not only columns.
6. Rehearse against a size/shape-representative sanitized snapshot; capture duration, locks, disk
   growth and rollback/restore decision.
7. Never auto-run schema changes from every API replica. The emitted migration task runs once and
   must succeed before application rollout.

## 11. Audit and financial integrity

High-value tables use after-change triggers. The trigger removes secret/ciphertext fields, binds the
event to tenant/user/request, serializes per tenant with an advisory transaction lock and links each
event to the prior SHA-256 hash. Runtime can read authorized events but cannot insert/update/delete.

Posted financial journals are immutable except an explicit reversal. Deferred constraint triggers
require balanced, non-zero debit and credit totals before commit. Corrections create evidence rather
than rewrite history.

## 12. Encryption and restricted data

Aurora storage/backups use KMS and connections use certificate-verified TLS. Restricted field rows
store only algorithm, key ID, random IV and ciphertext. The referenced encryption key must belong to
the same tenant through a composite foreign key. Key states are active, decrypt-only or retired,
with one active key per tenant.

Do not put database-level plaintext duplicates of client-encrypted fields into search, audit, logs
or JSON metadata. Reporting that needs restricted data requires a separately reviewed privacy
design.

## 13. Retention, deletion and backup

Retention policies, legal holds, data-subject requests and restore tests are modeled relationally.
Deletion workers must honor legal hold and relationship restrictions, create an audit outcome and
verify object storage cleanup. Soft deletion is used only where business/audit retention requires
it.

Automated backup configuration is not proof of recoverability. Quarterly restore tests must validate
schema checksums, tenant counts, audit-chain continuity, KMS access and an application smoke test in
an isolated account/VPC. Record measured RPO/RTO and corrective actions.

## 14. Review checklist

- Primary key and tenant-composite unique key
- Correct tenant-composite foreign keys and deletion behavior
- `not null`, type, range/state and uniqueness constraints
- Required tenant/time/foreign-key indexes
- RLS enabled with select/insert/update/delete behavior
- Least privileges and safe security-definer ownership
- Update/audit triggers where required
- Parameterized API access and bounded output
- Migration checksum, rehearsal, observability and rollback decision
- Retention, classification and encryption documented

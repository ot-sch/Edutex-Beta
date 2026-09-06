-- Edutex production schema - controlled, idempotent legacy identifier mapping.

create table migration.legacy_identifiers (
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  entity_type text not null check (entity_type ~ '^[a-z][a-z0-9_-]{1,79}$'),
  legacy_id text not null check (octet_length(legacy_id) between 1 and 500),
  new_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (tenant_id, entity_type, legacy_id),
  unique (tenant_id, entity_type, new_id)
);

revoke all on table migration.legacy_identifiers from public, edutex_app;
grant select, insert, update on table migration.legacy_identifiers to edutex_migrator;

-- Edutex production schema - core tenancy, identity and authorization.
-- Run migrations with the dedicated deployment role, never the runtime API role.

create extension if not exists citext;
create extension if not exists pgcrypto;

create schema if not exists app;
create schema if not exists audit;
create schema if not exists migration;

revoke all on schema app from public;
revoke all on schema audit from public;
revoke all on schema migration from public;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'edutex_app') then
    create role edutex_app login noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'edutex_migrator') then
    create role edutex_migrator login noinherit;
  end if;
  if exists (select 1 from pg_roles where rolname = 'rds_iam') then
    grant rds_iam to edutex_app;
    grant rds_iam to edutex_migrator;
  end if;
end
$$;

grant usage on schema app, audit to edutex_app;
grant usage on schema app, audit, migration to edutex_migrator;

create or replace function app.current_tenant_id()
returns uuid
language sql
stable
parallel safe
as $$
  select nullif(current_setting('app.tenant_id', true), '')::uuid
$$;

create or replace function app.current_user_id()
returns uuid
language sql
stable
parallel safe
as $$
  select nullif(current_setting('app.user_id', true), '')::uuid
$$;

create or replace function app.current_request_id()
returns text
language sql
stable
parallel safe
as $$
  select nullif(current_setting('app.request_id', true), '')
$$;

create or replace function app.has_permission(required_permission text)
returns boolean
language plpgsql
stable
parallel safe
as $$
declare
  configured_permissions jsonb;
begin
  begin
    configured_permissions := coalesce(
      nullif(current_setting('app.permissions', true), '')::jsonb,
      '[]'::jsonb
    );
  exception when others then
    configured_permissions := '[]'::jsonb;
  end;
  return configured_permissions ? required_permission
    or configured_permissions ? 'platform:manage';
end
$$;

create or replace function app.set_updated_metadata()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := clock_timestamp();
  new.row_version := old.row_version + 1;
  return new;
end
$$;

create table app.tenants (
  id uuid primary key default gen_random_uuid(),
  slug citext not null unique,
  legal_name text not null,
  display_name text not null,
  status text not null default 'provisioning'
    check (status in ('provisioning', 'active', 'suspended', 'archived')),
  primary_colour text not null default '#1262d4'
    check (primary_colour ~ '^#[0-9a-fA-F]{6}$'),
  logo_file_id uuid,
  default_timezone text not null default 'Australia/Melbourne',
  default_locale text not null default 'en-AU',
  data_region text not null default 'ap-southeast-2',
  cognito_user_pool_id text,
  cognito_client_id text,
  cognito_domain text,
  kms_encryption_context text not null default 'student-sensitive-data',
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  row_version bigint not null default 1,
  unique (id, slug)
);

create table app.tenant_domains (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  hostname citext not null unique,
  is_primary boolean not null default false,
  verified_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  row_version bigint not null default 1,
  unique (tenant_id, id)
);

create unique index tenant_domains_one_primary_per_tenant
  on app.tenant_domains (tenant_id)
  where is_primary;

create table app.campuses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  code citext not null,
  name text not null,
  timezone text not null,
  address_line_1 text,
  address_line_2 text,
  suburb text,
  state_region text,
  postal_code text,
  country_code char(2) not null default 'AU',
  active boolean not null default true,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  row_version bigint not null default 1,
  unique (tenant_id, id),
  unique (tenant_id, code)
);

create table app.academic_years (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  name text not null,
  starts_on date not null,
  ends_on date not null,
  status text not null default 'planned'
    check (status in ('planned', 'active', 'closed')),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  row_version bigint not null default 1,
  unique (tenant_id, id),
  unique (tenant_id, name),
  check (ends_on >= starts_on)
);

create table app.terms (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  academic_year_id uuid not null,
  name text not null,
  sequence_number smallint not null check (sequence_number between 1 and 12),
  starts_on date not null,
  ends_on date not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  row_version bigint not null default 1,
  unique (tenant_id, id),
  unique (academic_year_id, sequence_number),
  foreign key (tenant_id, academic_year_id)
    references app.academic_years(tenant_id, id) on delete cascade,
  check (ends_on >= starts_on)
);

create table app.users (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  cognito_subject text not null,
  email citext not null,
  username citext,
  display_name text not null,
  category text not null
    check (category in (
      'student', 'teacher', 'corporate_staff', 'it_staff',
      'executive_staff', 'parent_guardian', 'contractor'
    )),
  status text not null default 'invited'
    check (status in ('invited', 'active', 'disabled', 'locked', 'archived')),
  identity_version bigint not null default 1,
  last_login_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  row_version bigint not null default 1,
  unique (tenant_id, id),
  unique (tenant_id, cognito_subject),
  unique (tenant_id, email),
  unique nulls not distinct (tenant_id, username)
);

create index users_email_lower_index on app.users (tenant_id, lower(email::text));
create index users_active_index on app.users (tenant_id, status) where status = 'active';

create table app.roles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  key citext not null,
  name text not null,
  description text not null default '',
  system_role boolean not null default false,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  row_version bigint not null default 1,
  unique (tenant_id, id),
  unique (tenant_id, key)
);

create table app.permissions (
  key text primary key,
  module text not null,
  action text not null,
  description text not null,
  sensitivity text not null default 'standard'
    check (sensitivity in ('standard', 'sensitive', 'privileged')),
  unique (module, action)
);

create table app.role_permissions (
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  role_id uuid not null,
  permission_key text not null references app.permissions(key) on delete cascade,
  granted_at timestamptz not null default clock_timestamp(),
  granted_by uuid,
  primary key (tenant_id, role_id, permission_key),
  foreign key (tenant_id, role_id)
    references app.roles(tenant_id, id) on delete cascade,
  foreign key (tenant_id, granted_by)
    references app.users(tenant_id, id) on delete set null (granted_by)
);

create table app.user_roles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  user_id uuid not null,
  role_id uuid not null,
  campus_id uuid,
  valid_from timestamptz not null default clock_timestamp(),
  valid_until timestamptz,
  assigned_by uuid,
  unique (tenant_id, id),
  unique nulls not distinct (tenant_id, user_id, role_id, campus_id),
  foreign key (tenant_id, user_id)
    references app.users(tenant_id, id) on delete cascade,
  foreign key (tenant_id, role_id)
    references app.roles(tenant_id, id) on delete cascade,
  foreign key (tenant_id, campus_id)
    references app.campuses(tenant_id, id) on delete cascade,
  foreign key (tenant_id, assigned_by)
    references app.users(tenant_id, id) on delete set null (assigned_by),
  check (valid_until is null or valid_until > valid_from)
);

create table app.user_campuses (
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  user_id uuid not null,
  campus_id uuid not null,
  is_primary boolean not null default false,
  primary key (tenant_id, user_id, campus_id),
  foreign key (tenant_id, user_id)
    references app.users(tenant_id, id) on delete cascade,
  foreign key (tenant_id, campus_id)
    references app.campuses(tenant_id, id) on delete cascade
);

create unique index user_campuses_one_primary
  on app.user_campuses (tenant_id, user_id)
  where is_primary;

create table app.authentication_policies (
  tenant_id uuid primary key references app.tenants(id) on delete cascade,
  password_enabled boolean not null default true,
  passkey_enabled boolean not null default true,
  totp_mode text not null default 'required_for_password'
    check (totp_mode in ('disabled', 'optional', 'required_for_password')),
  microsoft_enabled boolean not null default false,
  google_enabled boolean not null default false,
  saml_enabled boolean not null default false,
  session_idle_minutes integer not null default 20 check (session_idle_minutes between 5 and 240),
  session_absolute_hours integer not null default 12 check (session_absolute_hours between 1 and 72),
  step_up_minutes integer not null default 10 check (step_up_minutes between 1 and 60),
  allowed_email_domains citext[] not null default array[]::citext[],
  updated_by uuid,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  row_version bigint not null default 1,
  foreign key (tenant_id, updated_by)
    references app.users(tenant_id, id) on delete set null (updated_by)
);

create table app.identity_providers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  provider_key citext not null,
  provider_type text not null check (provider_type in ('microsoft', 'google', 'oidc', 'saml')),
  display_name text not null,
  button_label text not null,
  enabled boolean not null default false,
  cognito_provider_name text not null,
  issuer_url text,
  metadata_url text,
  client_id text,
  client_secret_arn text,
  scopes text[] not null default array['openid', 'email', 'profile'],
  attribute_mapping jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  row_version bigint not null default 1,
  unique (tenant_id, id),
  unique (tenant_id, provider_key),
  unique (cognito_provider_name),
  check (jsonb_typeof(attribute_mapping) = 'object'),
  check (octet_length(attribute_mapping::text) <= 65536)
);

comment on column app.identity_providers.client_secret_arn is
  'Reference only. The secret value is stored in AWS Secrets Manager and is never returned by the API.';

create table app.directory_role_mappings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  identity_provider_id uuid not null,
  claim_name text not null,
  claim_value text not null,
  role_id uuid not null,
  user_category text not null
    check (user_category in (
      'student', 'teacher', 'corporate_staff', 'it_staff',
      'executive_staff', 'parent_guardian', 'contractor'
    )),
  priority integer not null default 100,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  row_version bigint not null default 1,
  unique (tenant_id, id),
  unique (tenant_id, identity_provider_id, claim_name, claim_value, role_id),
  foreign key (tenant_id, identity_provider_id)
    references app.identity_providers(tenant_id, id) on delete cascade,
  foreign key (tenant_id, role_id)
    references app.roles(tenant_id, id) on delete cascade
);

create table app.bootstrap_invitations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  email citext not null,
  cognito_subject text not null,
  token_hash bytea not null unique,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  unique (tenant_id, id),
  check (expires_at > created_at)
);

create table app.tenant_encryption_keys (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  kms_key_id text not null,
  encrypted_data_key bytea not null,
  status text not null default 'active' check (status in ('active', 'decrypt_only', 'retired')),
  created_at timestamptz not null default clock_timestamp(),
  rotated_at timestamptz,
  unique (tenant_id, id)
);

create unique index tenant_encryption_keys_one_active
  on app.tenant_encryption_keys (tenant_id)
  where status = 'active';

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'tenants', 'tenant_domains', 'campuses', 'academic_years', 'terms', 'users',
    'roles', 'authentication_policies', 'identity_providers', 'directory_role_mappings'
  ]
  loop
    execute format(
      'create trigger %I before update on app.%I for each row execute function app.set_updated_metadata()',
      table_name || '_updated_metadata',
      table_name
    );
  end loop;
end
$$;

grant select, insert, update, delete on all tables in schema app to edutex_app;
grant usage, select on all sequences in schema app to edutex_app;
alter default privileges in schema app grant select, insert, update, delete on tables to edutex_app;
alter default privileges in schema app grant usage, select on sequences to edutex_app;

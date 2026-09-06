-- Edutex production schema - defense-in-depth authorization, auditing and integrity.

create or replace function app.authorized(module_name text, operation_name text)
returns boolean
language sql
stable
parallel safe
as $$
  select app.has_permission(module_name || ':' || operation_name)
    or app.has_permission(module_name || ':manage')
$$;

insert into app.permissions (key, module, action, description, sensitivity)
select
  module_name || ':' || action_name,
  module_name,
  action_name,
  initcap(replace(module_name, '-', ' ')) || ': ' || replace(action_name, '-', ' '),
  case
    when action_name in ('manage', 'delete', 'export') then 'privileged'
    when action_name like 'sensitive-%' then 'sensitive'
    else 'standard'
  end
from unnest(array[
  'dashboard', 'students', 'attendance', 'timetables', 'classes', 'activities',
  'families', 'finance', 'forms', 'staff', 'enrolments', 'communications',
  'events', 'alumni', 'grades', 'photos', 'knowledge-base', 'sign-in-out',
  'import-export', 'audit', 'admin'
]) as module_name
cross join unnest(array['view', 'create', 'edit', 'delete', 'export', 'manage']) as action_name
on conflict (key) do nothing;

insert into app.permissions (key, module, action, description, sensitivity)
values
  ('students:sensitive-view', 'students', 'sensitive-view', 'Decrypt student sensitive fields', 'sensitive'),
  ('students:sensitive-edit', 'students', 'sensitive-edit', 'Encrypt or replace student sensitive fields', 'sensitive'),
  ('forms:approve', 'forms', 'approve', 'Approve and action form submissions', 'privileged'),
  ('enrolments:approve', 'enrolments', 'approve', 'Issue or accept enrolment decisions', 'privileged'),
  ('finance:approve', 'finance', 'approve', 'Post journals and approve finance transactions', 'privileged'),
  ('platform:manage', 'platform', 'manage', 'Cross-tenant platform control-plane access', 'privileged')
on conflict (key) do nothing;

create or replace function app.resolve_user_permissions(target_user_id uuid)
returns table(permission_key text)
language sql
stable
security invoker
as $$
  select distinct role_permissions.permission_key
  from app.user_roles
  join app.role_permissions
    on role_permissions.tenant_id = user_roles.tenant_id
   and role_permissions.role_id = user_roles.role_id
  where user_roles.tenant_id = app.current_tenant_id()
    and user_roles.user_id = target_user_id
    and user_roles.valid_from <= clock_timestamp()
    and (user_roles.valid_until is null or user_roles.valid_until > clock_timestamp())
$$;

create table app.idempotency_keys (
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  key_hash bytea not null,
  user_id uuid not null,
  request_hash bytea not null,
  response_status integer,
  response_body jsonb,
  locked_until timestamptz not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (tenant_id, key_hash),
  foreign key (tenant_id, user_id)
    references app.users(tenant_id, id) on delete cascade,
  check (response_body is null or octet_length(response_body::text) <= 1048576),
  check (expires_at > created_at)
);

create table app.export_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  requested_by uuid not null,
  resource_type text not null,
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'complete', 'failed', 'expired')),
  file_id uuid,
  contains_sensitive_data boolean not null default false,
  expires_at timestamptz,
  failure_code text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  row_version bigint not null default 1,
  unique (tenant_id, id),
  foreign key (tenant_id, requested_by)
    references app.users(tenant_id, id),
  foreign key (tenant_id, file_id)
    references app.files(tenant_id, id) on delete set null (file_id)
);

create table app.webhook_endpoints (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  form_id uuid,
  endpoint_key citext not null,
  token_hash bytea not null,
  allowed_origin text,
  enabled boolean not null default true,
  requests_per_minute integer not null default 200 check (requests_per_minute between 1 and 1000),
  last_used_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  row_version bigint not null default 1,
  unique (tenant_id, id),
  unique (tenant_id, endpoint_key),
  foreign key (tenant_id, form_id)
    references app.forms(tenant_id, id) on delete cascade
);

create table app.webhook_attempts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  webhook_endpoint_id uuid not null,
  request_id text not null,
  source_ip_hash bytea,
  outcome text not null check (outcome in ('accepted', 'rejected', 'rate_limited', 'failed')),
  status_code integer not null,
  occurred_at timestamptz not null default clock_timestamp(),
  unique (tenant_id, id),
  unique (tenant_id, request_id),
  foreign key (tenant_id, webhook_endpoint_id)
    references app.webhook_endpoints(tenant_id, id) on delete cascade
);

create table audit.events (
  sequence_number bigserial primary key,
  id uuid not null default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete restrict,
  occurred_at timestamptz not null default clock_timestamp(),
  actor_user_id uuid,
  action text not null,
  resource_type text not null,
  resource_id text,
  request_id text,
  outcome text not null default 'success' check (outcome in ('success', 'denied', 'failure')),
  ip_address_hash bytea,
  user_agent_hash bytea,
  before_state jsonb,
  after_state jsonb,
  metadata jsonb not null default '{}'::jsonb,
  previous_hash bytea,
  event_hash bytea not null,
  unique (tenant_id, id),
  foreign key (tenant_id, actor_user_id)
    references app.users(tenant_id, id) on delete set null (actor_user_id),
  check (before_state is null or octet_length(before_state::text) <= 1048576),
  check (after_state is null or octet_length(after_state::text) <= 1048576),
  check (jsonb_typeof(metadata) = 'object'),
  check (octet_length(metadata::text) <= 262144)
);

create index audit_events_tenant_time on audit.events (tenant_id, occurred_at desc);
create index audit_events_resource on audit.events (tenant_id, resource_type, resource_id, occurred_at desc);
create index audit_events_actor on audit.events (tenant_id, actor_user_id, occurred_at desc);

create or replace function audit.redact_state(state_value jsonb)
returns jsonb
language sql
immutable
parallel safe
as $$
  select case
    when state_value is null then null
    else state_value
      - 'ciphertext'
      - 'encrypted_data_key'
      - 'token_hash'
      - 'client_secret_arn'
      - 'password'
      - 'refresh_token'
  end
$$;

create or replace function audit.append_event(
  target_tenant_id uuid,
  target_actor_user_id uuid,
  event_action text,
  event_resource_type text,
  event_resource_id text,
  event_outcome text,
  event_before_state jsonb,
  event_after_state jsonb,
  event_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, audit, app
as $$
declare
  new_id uuid := gen_random_uuid();
  prior_hash bytea;
  calculated_hash bytea;
  event_time timestamptz := clock_timestamp();
begin
  if target_tenant_id is null then
    raise exception 'Audit event tenant is required';
  end if;
  if not app.has_permission('platform:manage') and (
    app.current_tenant_id() is null or target_tenant_id <> app.current_tenant_id()
  ) then
    raise exception 'Audit tenant mismatch' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(target_tenant_id::text, 914583));
  select event_hash into prior_hash
  from audit.events
  where tenant_id = target_tenant_id
  order by sequence_number desc
  limit 1;

  calculated_hash := public.digest(
    coalesce(encode(prior_hash, 'hex'), '') || '|' ||
    new_id::text || '|' || event_time::text || '|' ||
    coalesce(target_actor_user_id::text, '') || '|' || event_action || '|' ||
    event_resource_type || '|' || coalesce(event_resource_id, '') || '|' ||
    event_outcome || '|' || coalesce(audit.redact_state(event_before_state)::text, '') || '|' ||
    coalesce(audit.redact_state(event_after_state)::text, '') || '|' ||
    coalesce(event_metadata, '{}'::jsonb)::text,
    'sha256'
  );

  insert into audit.events (
    id, tenant_id, occurred_at, actor_user_id, action, resource_type, resource_id,
    request_id, outcome, before_state, after_state, metadata, previous_hash, event_hash
  ) values (
    new_id, target_tenant_id, event_time, target_actor_user_id, event_action,
    event_resource_type, event_resource_id, app.current_request_id(), event_outcome,
    audit.redact_state(event_before_state), audit.redact_state(event_after_state),
    coalesce(event_metadata, '{}'::jsonb), prior_hash, calculated_hash
  );
  return new_id;
end
$$;

create or replace function audit.reject_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Audit events are immutable' using errcode = '55000';
end
$$;

create trigger audit_events_immutable
before update or delete on audit.events
for each row execute function audit.reject_mutation();

create or replace function audit.capture_row_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, audit, app
as $$
declare
  old_state jsonb;
  new_state jsonb;
  target_tenant uuid;
  target_id text;
  action_name text;
begin
  old_state := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end;
  new_state := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end;
  target_tenant := coalesce((new_state ->> 'tenant_id')::uuid, (old_state ->> 'tenant_id')::uuid);
  target_id := coalesce(new_state ->> 'id', old_state ->> 'id', new_state ->> 'student_id', old_state ->> 'student_id');
  action_name := lower(tg_op);

  perform audit.append_event(
    target_tenant,
    app.current_user_id(),
    action_name,
    tg_table_name,
    target_id,
    'success',
    old_state,
    new_state,
    jsonb_build_object('trigger', true)
  );
  return coalesce(new, old);
end
$$;

create or replace function app.reject_posted_journal_mutation()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'posted' and (
    tg_op = 'DELETE' or new.status <> 'reversed' or new.description <> old.description
  ) then
    raise exception 'Posted journals are immutable; create a reversal instead' using errcode = '55000';
  end if;
  return coalesce(new, old);
end
$$;

create trigger journal_entries_posted_immutable
before update or delete on app.journal_entries
for each row execute function app.reject_posted_journal_mutation();

create or replace function app.validate_posted_journal_balance()
returns trigger
language plpgsql
as $$
declare
  target_entry_id uuid;
  target_tenant_id uuid;
  target_status text;
  debits numeric(18, 2);
  credits numeric(18, 2);
begin
  if tg_table_name = 'journal_entries' then
    target_entry_id := case when tg_op = 'DELETE' then old.id else new.id end;
    target_tenant_id := case when tg_op = 'DELETE' then old.tenant_id else new.tenant_id end;
  else
    target_entry_id := case when tg_op = 'DELETE' then old.journal_entry_id else new.journal_entry_id end;
    target_tenant_id := case when tg_op = 'DELETE' then old.tenant_id else new.tenant_id end;
  end if;
  select status into target_status
  from app.journal_entries
  where tenant_id = target_tenant_id and id = target_entry_id;
  if target_status = 'posted' then
    select coalesce(sum(debit_amount), 0), coalesce(sum(credit_amount), 0)
      into debits, credits
    from app.journal_lines
    where tenant_id = target_tenant_id and journal_entry_id = target_entry_id;
    if debits = 0 or debits <> credits then
      raise exception 'Posted journal must contain balanced, non-zero debit and credit totals'
        using errcode = '23514';
    end if;
  end if;
  return coalesce(new, old);
end
$$;

create constraint trigger journal_entries_balance
after insert or update on app.journal_entries
deferrable initially deferred
for each row execute function app.validate_posted_journal_balance();

create constraint trigger journal_lines_balance
after insert or update or delete on app.journal_lines
deferrable initially deferred
for each row execute function app.validate_posted_journal_balance();

create or replace function app.resolve_public_tenant(requested_hostname text)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, app
as $$
  select jsonb_build_object(
    'tenantId', tenants.id,
    'slug', tenants.slug,
    'name', tenants.display_name,
    'logoUrl', coalesce('/api/v1/public/branding/' || tenants.logo_file_id::text, '/auth/edutex-logo.png'),
    'primaryColour', tenants.primary_colour,
    'enabledMethods', to_jsonb(array_remove(array[
      case when authentication_policies.password_enabled then 'password' end,
      case when authentication_policies.passkey_enabled then 'passkey' end,
      case when authentication_policies.microsoft_enabled then 'microsoft' end,
      case when authentication_policies.google_enabled then 'google' end,
      case when authentication_policies.saml_enabled then 'saml' end
    ], null)),
    'providers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', identity_providers.id,
        'type', identity_providers.provider_type,
        'key', identity_providers.provider_key,
        'displayName', identity_providers.display_name,
        'buttonLabel', identity_providers.button_label,
        'enabled', identity_providers.enabled
      ) order by identity_providers.display_name)
      from app.identity_providers
      where identity_providers.tenant_id = tenants.id
        and identity_providers.enabled
        and case identity_providers.provider_type
          when 'microsoft' then authentication_policies.microsoft_enabled
          when 'google' then authentication_policies.google_enabled
          when 'saml' then authentication_policies.saml_enabled
          else true
        end
    ), '[]'::jsonb),
    'maintenanceMessage', null
  )
  from app.tenant_domains
  join app.tenants on tenants.id = tenant_domains.tenant_id
  join app.authentication_policies on authentication_policies.tenant_id = tenants.id
  where tenant_domains.hostname = lower(trim(trailing '.' from requested_hostname))::public.citext
    and tenant_domains.verified_at is not null
    and tenants.status = 'active'
  limit 1
$$;

revoke all on function app.resolve_public_tenant(text) from public;
grant execute on function app.resolve_public_tenant(text) to edutex_app;
revoke all on function audit.append_event(uuid, uuid, text, text, text, text, jsonb, jsonb, jsonb) from edutex_app;

-- Tenants use their primary key as the isolation discriminator.
alter table app.tenants enable row level security;
create policy tenants_select on app.tenants for select to edutex_app
  using (id = app.current_tenant_id() and app.authorized('admin', 'view'));
create policy tenants_update on app.tenants for update to edutex_app
  using (id = app.current_tenant_id() and app.authorized('admin', 'edit'))
  with check (id = app.current_tenant_id() and app.authorized('admin', 'edit'));

-- Global permission definitions are readable but never mutable by the runtime role.
revoke insert, update, delete on app.permissions from edutex_app;
grant select on app.permissions to edutex_app;

do $$
declare
  entry record;
begin
  for entry in
    select * from (values
      ('tenant_domains', 'admin'), ('campuses', 'admin'), ('academic_years', 'admin'),
      ('terms', 'admin'), ('users', 'admin'), ('roles', 'admin'),
      ('role_permissions', 'admin'), ('user_roles', 'admin'), ('user_campuses', 'admin'),
      ('authentication_policies', 'admin'), ('identity_providers', 'admin'),
      ('directory_role_mappings', 'admin'), ('bootstrap_invitations', 'admin'),
      ('houses', 'students'), ('families', 'families'), ('guardians', 'families'),
      ('family_guardians', 'families'), ('students', 'students'),
      ('student_families', 'students'), ('student_tags', 'students'),
      ('staff', 'staff'), ('staff_campuses', 'staff'), ('staff_departments', 'staff'),
      ('departments', 'staff'), ('subjects', 'classes'), ('rooms', 'timetables'),
      ('timetable_sets', 'timetables'), ('timetable_periods', 'timetables'),
      ('classes', 'classes'), ('class_staff', 'classes'), ('class_students', 'classes'),
      ('activities', 'activities'), ('activity_participants', 'activities'),
      ('timetable_entries', 'timetables'), ('attendance_sessions', 'attendance'),
      ('attendance_marks', 'attendance'), ('student_movements', 'sign-in-out'),
      ('attendance_alerts', 'attendance'), ('assessments', 'grades'),
      ('grade_results', 'grades'), ('enrolment_applications', 'enrolments'),
      ('chart_of_accounts', 'finance'), ('journal_entries', 'finance'),
      ('journal_lines', 'finance'), ('invoices', 'finance'), ('invoice_lines', 'finance'),
      ('payments', 'finance'), ('budgets', 'finance'), ('forms', 'forms'),
      ('form_submissions', 'forms'), ('form_answers', 'forms'), ('form_review_log', 'forms'),
      ('events', 'events'), ('event_participants', 'events'),
      ('communication_templates', 'communications'), ('communications', 'communications'),
      ('communication_recipients', 'communications'), ('communication_rules', 'communications'),
      ('alumni_profiles', 'alumni'), ('alumni_engagements', 'alumni'),
      ('alumni_mentorships', 'alumni'), ('knowledge_articles', 'knowledge-base'),
      ('sign_in_out_requests', 'sign-in-out'), ('module_layouts', 'admin'),
      ('files', 'photos'), ('export_jobs', 'import-export'),
      ('webhook_endpoints', 'forms'), ('webhook_attempts', 'forms')
    ) as mapping(table_name, module_name)
  loop
    execute format('alter table app.%I enable row level security', entry.table_name);
    execute format(
      'create policy %I on app.%I for select to edutex_app using (tenant_id = app.current_tenant_id() and app.authorized(%L, %L))',
      entry.table_name || '_select', entry.table_name, entry.module_name, 'view'
    );
    execute format(
      'create policy %I on app.%I for insert to edutex_app with check (tenant_id = app.current_tenant_id() and app.authorized(%L, %L))',
      entry.table_name || '_insert', entry.table_name, entry.module_name, 'create'
    );
    execute format(
      'create policy %I on app.%I for update to edutex_app using (tenant_id = app.current_tenant_id() and app.authorized(%L, %L)) with check (tenant_id = app.current_tenant_id() and app.authorized(%L, %L))',
      entry.table_name || '_update', entry.table_name, entry.module_name, 'edit', entry.module_name, 'edit'
    );
    execute format(
      'create policy %I on app.%I for delete to edutex_app using (tenant_id = app.current_tenant_id() and app.authorized(%L, %L))',
      entry.table_name || '_delete', entry.table_name, entry.module_name, 'delete'
    );
  end loop;
end
$$;

-- Sensitive ciphertext and tenant keys require explicit sensitive-data permissions.
alter table app.student_sensitive_fields enable row level security;
create policy student_sensitive_fields_select on app.student_sensitive_fields for select to edutex_app
  using (tenant_id = app.current_tenant_id() and app.has_permission('students:sensitive-view'));
create policy student_sensitive_fields_insert on app.student_sensitive_fields for insert to edutex_app
  with check (tenant_id = app.current_tenant_id() and app.has_permission('students:sensitive-edit'));
create policy student_sensitive_fields_update on app.student_sensitive_fields for update to edutex_app
  using (tenant_id = app.current_tenant_id() and app.has_permission('students:sensitive-edit'))
  with check (tenant_id = app.current_tenant_id() and app.has_permission('students:sensitive-edit'));
create policy student_sensitive_fields_delete on app.student_sensitive_fields for delete to edutex_app
  using (tenant_id = app.current_tenant_id() and app.has_permission('students:sensitive-edit'));

alter table app.tenant_encryption_keys enable row level security;
create policy tenant_encryption_keys_select on app.tenant_encryption_keys for select to edutex_app
  using (tenant_id = app.current_tenant_id() and app.has_permission('students:sensitive-view'));
create policy tenant_encryption_keys_insert on app.tenant_encryption_keys for insert to edutex_app
  with check (tenant_id = app.current_tenant_id() and app.has_permission('students:sensitive-edit'));

-- Idempotency rows are accessible only to the user that created them.
alter table app.idempotency_keys enable row level security;
create policy idempotency_keys_all on app.idempotency_keys for all to edutex_app
  using (tenant_id = app.current_tenant_id() and user_id = app.current_user_id())
  with check (tenant_id = app.current_tenant_id() and user_id = app.current_user_id());

alter table audit.events enable row level security;
create policy audit_events_select on audit.events for select to edutex_app
  using (tenant_id = app.current_tenant_id() and app.authorized('audit', 'view'));

revoke all on audit.events from edutex_app;
grant select on audit.events to edutex_app;
grant usage, select on sequence audit.events_sequence_number_seq to edutex_app;

-- Attach redacted audit triggers to high-value mutable records.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'students', 'student_sensitive_fields', 'staff', 'families', 'guardians',
    'attendance_sessions', 'attendance_marks', 'student_movements', 'grade_results',
    'enrolment_applications', 'journal_entries', 'journal_lines', 'invoices', 'payments',
    'forms', 'form_submissions', 'events', 'communications', 'users', 'roles',
    'role_permissions', 'user_roles', 'authentication_policies', 'identity_providers'
  ]
  loop
    execute format(
      'create trigger %I after insert or update or delete on app.%I for each row execute function audit.capture_row_change()',
      table_name || '_audit',
      table_name
    );
  end loop;
end
$$;

create trigger export_jobs_updated_metadata
before update on app.export_jobs
for each row execute function app.set_updated_metadata();

create trigger webhook_endpoints_updated_metadata
before update on app.webhook_endpoints
for each row execute function app.set_updated_metadata();

grant select, insert, update, delete on app.idempotency_keys, app.export_jobs,
  app.webhook_endpoints, app.webhook_attempts to edutex_app;
grant usage, select on all sequences in schema app to edutex_app;

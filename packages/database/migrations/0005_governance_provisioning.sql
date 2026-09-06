-- Edutex production schema - ISO 27001/9001 operational evidence and tenant defaults.

create table app.data_retention_policies (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  record_type text not null,
  retention_months integer not null check (retention_months between 1 and 1200),
  disposition_action text not null check (disposition_action in ('delete', 'anonymise', 'archive')),
  legal_basis text not null,
  active boolean not null default true,
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  row_version bigint not null default 1,
  unique (tenant_id, id),
  unique (tenant_id, record_type),
  foreign key (tenant_id, approved_by)
    references app.users(tenant_id, id) on delete set null (approved_by)
);

create table app.legal_holds (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  reference text not null,
  scope_description text not null,
  starts_at timestamptz not null,
  ends_at timestamptz,
  status text not null default 'active' check (status in ('active', 'released')),
  created_by uuid,
  released_by uuid,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  row_version bigint not null default 1,
  unique (tenant_id, id),
  unique (tenant_id, reference),
  foreign key (tenant_id, created_by)
    references app.users(tenant_id, id) on delete set null (created_by),
  foreign key (tenant_id, released_by)
    references app.users(tenant_id, id) on delete set null (released_by),
  check (ends_at is null or ends_at >= starts_at)
);

create table app.data_subject_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  request_type text not null check (request_type in ('access', 'correction', 'deletion', 'restriction', 'portability')),
  requester_name text not null,
  requester_email citext not null,
  subject_user_id uuid,
  status text not null default 'received'
    check (status in ('received', 'identity_verification', 'in_progress', 'fulfilled', 'declined', 'cancelled')),
  due_at timestamptz not null,
  assigned_to uuid,
  completed_at timestamptz,
  decision_note text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  row_version bigint not null default 1,
  unique (tenant_id, id),
  foreign key (tenant_id, subject_user_id)
    references app.users(tenant_id, id) on delete set null (subject_user_id),
  foreign key (tenant_id, assigned_to)
    references app.users(tenant_id, id) on delete set null (assigned_to)
);

create table app.security_incidents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  incident_number citext not null,
  title text not null,
  severity text not null check (severity in ('low', 'medium', 'high', 'critical')),
  status text not null default 'open'
    check (status in ('open', 'contained', 'eradicated', 'recovered', 'closed')),
  detected_at timestamptz not null,
  reported_by uuid,
  incident_commander uuid,
  summary text not null,
  containment_note text,
  root_cause text,
  lessons_learned text,
  closed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  row_version bigint not null default 1,
  unique (tenant_id, id),
  unique (tenant_id, incident_number),
  foreign key (tenant_id, reported_by)
    references app.users(tenant_id, id) on delete set null (reported_by),
  foreign key (tenant_id, incident_commander)
    references app.users(tenant_id, id) on delete set null (incident_commander),
  check (closed_at is null or closed_at >= detected_at)
);

create table app.access_review_campaigns (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  name text not null,
  scope text not null,
  status text not null default 'draft' check (status in ('draft', 'active', 'complete', 'cancelled')),
  starts_at timestamptz not null,
  due_at timestamptz not null,
  owner_user_id uuid,
  completed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  row_version bigint not null default 1,
  unique (tenant_id, id),
  foreign key (tenant_id, owner_user_id)
    references app.users(tenant_id, id) on delete set null (owner_user_id),
  check (due_at > starts_at)
);

create table app.access_review_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  campaign_id uuid not null,
  user_id uuid not null,
  role_id uuid not null,
  decision text check (decision is null or decision in ('retain', 'modify', 'revoke')),
  decision_note text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  unique (tenant_id, id),
  unique (tenant_id, campaign_id, user_id, role_id),
  foreign key (tenant_id, campaign_id)
    references app.access_review_campaigns(tenant_id, id) on delete cascade,
  foreign key (tenant_id, user_id)
    references app.users(tenant_id, id) on delete cascade,
  foreign key (tenant_id, role_id)
    references app.roles(tenant_id, id) on delete cascade,
  foreign key (tenant_id, reviewed_by)
    references app.users(tenant_id, id) on delete set null (reviewed_by)
);

create table app.backup_restore_tests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  test_reference text not null,
  backup_timestamp timestamptz not null,
  test_started_at timestamptz not null,
  test_completed_at timestamptz,
  result text not null check (result in ('in_progress', 'passed', 'failed')),
  recovery_point_minutes integer,
  recovery_time_minutes integer,
  evidence_file_id uuid,
  tested_by uuid,
  notes text not null default '',
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  row_version bigint not null default 1,
  unique (tenant_id, id),
  unique (tenant_id, test_reference),
  foreign key (tenant_id, evidence_file_id)
    references app.files(tenant_id, id) on delete set null (evidence_file_id),
  foreign key (tenant_id, tested_by)
    references app.users(tenant_id, id) on delete set null (tested_by),
  check (test_completed_at is null or test_completed_at >= test_started_at)
);

create table app.risk_acceptances (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  risk_reference text not null,
  risk_description text not null,
  rationale text not null,
  residual_likelihood smallint not null check (residual_likelihood between 1 and 5),
  residual_impact smallint not null check (residual_impact between 1 and 5),
  expires_at timestamptz not null,
  approved_by uuid not null,
  approved_at timestamptz not null,
  review_status text not null default 'active' check (review_status in ('active', 'expired', 'withdrawn')),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  row_version bigint not null default 1,
  unique (tenant_id, id),
  unique (tenant_id, risk_reference),
  foreign key (tenant_id, approved_by)
    references app.users(tenant_id, id),
  check (expires_at > approved_at)
);

create or replace function app.provision_tenant_defaults(
  target_tenant_id uuid,
  initial_admin_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, app
as $$
declare
  administrator_role_id uuid;
  teacher_role_id uuid;
  attendance_role_id uuid;
  finance_role_id uuid;
  parent_role_id uuid;
  student_role_id uuid;
begin
  if not exists (select 1 from app.tenants where id = target_tenant_id) then
    raise exception 'Unknown tenant';
  end if;
  if not exists (
    select 1 from app.users where tenant_id = target_tenant_id and id = initial_admin_user_id
  ) then
    raise exception 'Initial administrator must belong to the target tenant';
  end if;

  insert into app.authentication_policies (tenant_id)
  values (target_tenant_id)
  on conflict (tenant_id) do nothing;

  insert into app.roles (tenant_id, key, name, description, system_role)
  values (target_tenant_id, 'system-administrator', 'System Administrator', 'Full tenant administration', true)
  on conflict (tenant_id, key) do update set name = excluded.name
  returning id into administrator_role_id;

  insert into app.roles (tenant_id, key, name, description, system_role)
  values (target_tenant_id, 'teacher', 'Teacher', 'Teaching and assigned-roll access', true)
  on conflict (tenant_id, key) do update set name = excluded.name
  returning id into teacher_role_id;

  insert into app.roles (tenant_id, key, name, description, system_role)
  values (target_tenant_id, 'attendance-officer', 'Attendance Officer', 'Attendance and movement administration', true)
  on conflict (tenant_id, key) do update set name = excluded.name
  returning id into attendance_role_id;

  insert into app.roles (tenant_id, key, name, description, system_role)
  values (target_tenant_id, 'finance-officer', 'Finance Officer', 'Finance operations without role administration', true)
  on conflict (tenant_id, key) do update set name = excluded.name
  returning id into finance_role_id;

  insert into app.roles (tenant_id, key, name, description, system_role)
  values (target_tenant_id, 'parent-guardian', 'Parent or Guardian', 'Parent portal access scoped to linked children', true)
  on conflict (tenant_id, key) do update set name = excluded.name
  returning id into parent_role_id;

  insert into app.roles (tenant_id, key, name, description, system_role)
  values (target_tenant_id, 'student', 'Student', 'Student portal access scoped to self', true)
  on conflict (tenant_id, key) do update set name = excluded.name
  returning id into student_role_id;

  insert into app.role_permissions (tenant_id, role_id, permission_key, granted_by)
  select target_tenant_id, administrator_role_id, permissions.key, initial_admin_user_id
  from app.permissions
  where permissions.key <> 'platform:manage'
  on conflict do nothing;

  insert into app.role_permissions (tenant_id, role_id, permission_key, granted_by)
  select target_tenant_id, teacher_role_id, permission_key, initial_admin_user_id
  from unnest(array[
    'dashboard:view', 'students:view', 'attendance:view', 'attendance:edit',
    'classes:view', 'classes:edit', 'activities:view', 'timetables:view',
    'grades:view', 'grades:create', 'grades:edit', 'forms:view', 'events:view',
    'knowledge-base:view', 'sign-in-out:view'
  ]) as permission_key
  on conflict do nothing;

  insert into app.role_permissions (tenant_id, role_id, permission_key, granted_by)
  select target_tenant_id, attendance_role_id, permission_key, initial_admin_user_id
  from unnest(array[
    'dashboard:view', 'students:view', 'attendance:view', 'attendance:create',
    'attendance:edit', 'attendance:export', 'sign-in-out:view', 'sign-in-out:create',
    'sign-in-out:edit'
  ]) as permission_key
  on conflict do nothing;

  insert into app.role_permissions (tenant_id, role_id, permission_key, granted_by)
  select target_tenant_id, finance_role_id, permission_key, initial_admin_user_id
  from unnest(array[
    'dashboard:view', 'families:view', 'finance:view', 'finance:create',
    'finance:edit', 'finance:export', 'forms:view'
  ]) as permission_key
  on conflict do nothing;

  insert into app.role_permissions (tenant_id, role_id, permission_key, granted_by)
  select target_tenant_id, parent_role_id, permission_key, initial_admin_user_id
  from unnest(array[
    'dashboard:view', 'students:view', 'attendance:view', 'forms:view', 'forms:create',
    'events:view', 'sign-in-out:view', 'sign-in-out:create', 'communications:view'
  ]) as permission_key
  on conflict do nothing;

  insert into app.role_permissions (tenant_id, role_id, permission_key, granted_by)
  select target_tenant_id, student_role_id, permission_key, initial_admin_user_id
  from unnest(array[
    'dashboard:view', 'students:view', 'attendance:view', 'timetables:view',
    'classes:view', 'activities:view', 'grades:view', 'events:view',
    'knowledge-base:view'
  ]) as permission_key
  on conflict do nothing;

  insert into app.user_roles (tenant_id, user_id, role_id, campus_id, assigned_by)
  values (target_tenant_id, initial_admin_user_id, administrator_role_id, null, initial_admin_user_id)
  on conflict do nothing;
end
$$;

revoke all on function app.provision_tenant_defaults(uuid, uuid) from public;
revoke all on function app.provision_tenant_defaults(uuid, uuid) from edutex_app;
grant execute on function app.provision_tenant_defaults(uuid, uuid) to edutex_migrator;

do $$
declare
  entry record;
begin
  for entry in
    select * from (values
      ('data_retention_policies', 'admin'),
      ('legal_holds', 'admin'),
      ('data_subject_requests', 'admin'),
      ('security_incidents', 'audit'),
      ('access_review_campaigns', 'admin'),
      ('access_review_items', 'admin'),
      ('backup_restore_tests', 'audit'),
      ('risk_acceptances', 'audit')
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

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'data_retention_policies', 'legal_holds', 'data_subject_requests',
    'security_incidents', 'access_review_campaigns', 'backup_restore_tests',
    'risk_acceptances'
  ]
  loop
    execute format(
      'create trigger %I before update on app.%I for each row execute function app.set_updated_metadata()',
      table_name || '_updated_metadata',
      table_name
    );
    execute format(
      'create trigger %I after insert or update or delete on app.%I for each row execute function audit.capture_row_change()',
      table_name || '_audit',
      table_name
    );
  end loop;
end
$$;

grant select, insert, update, delete on all tables in schema app to edutex_app;
grant usage, select on all sequences in schema app to edutex_app;
revoke insert, update, delete on app.permissions from edutex_app;

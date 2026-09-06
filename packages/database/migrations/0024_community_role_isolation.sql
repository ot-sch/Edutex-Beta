-- RC6: a community category cannot inherit staff-wide RLS access from legacy or accidentally assigned grants.
create or replace function app.current_actor_category() returns text
language sql stable security definer set search_path=pg_catalog,app as $$
 select case when status='active' then category else 'disabled' end from app.users where tenant_id=app.current_tenant_id() and id=app.current_user_id()
$$;
revoke all on function app.current_actor_category() from public;
grant execute on function app.current_actor_category() to edutex_app;
create or replace function app.has_permission(required_permission text)
returns boolean
language plpgsql
stable
parallel restricted
as $$
declare
  configured_permissions jsonb;
  actor_category text;
begin
  actor_category:=app.current_actor_category();
  if app.current_user_id() is not null and (actor_category is null or actor_category='disabled') then return false; end if;
  if (actor_category='parent_guardian' and required_permission<>'parent-portal:view') or (actor_category='student' and required_permission<>'student-portal:view') then return false; end if;
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
    'parent-portal:view'
  ]) as permission_key
  on conflict do nothing;

  insert into app.role_permissions (tenant_id, role_id, permission_key, granted_by)
  select target_tenant_id, student_role_id, permission_key, initial_admin_user_id
  from unnest(array[
    'student-portal:view'
  ]) as permission_key
  on conflict do nothing;

  insert into app.user_roles (tenant_id, user_id, role_id, campus_id, assigned_by)
  values (target_tenant_id, initial_admin_user_id, administrator_role_id, null, initial_admin_user_id)
  on conflict do nothing;
end
$$;
delete from app.role_permissions p using app.roles r where p.tenant_id=r.tenant_id and p.role_id=r.id and r.system_role and r.key in ('parent-guardian','student');
insert into app.role_permissions(tenant_id,role_id,permission_key)
 select tenant_id,id,case key when 'parent-guardian' then 'parent-portal:view' else 'student-portal:view' end
 from app.roles where system_role and key in ('parent-guardian','student') on conflict do nothing;

alter function app.authorized(text,text) parallel restricted;

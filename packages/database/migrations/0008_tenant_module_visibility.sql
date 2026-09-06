-- Edutex production schema - normalized tenant module visibility.

create table app.tenant_modules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  module_key text not null check (module_key in (
    'dashboard', 'students', 'attendance', 'timetables', 'classes', 'activities',
    'families', 'finance', 'forms', 'staff', 'enrolments', 'communications',
    'events', 'alumni', 'grades', 'photos', 'knowledge-base', 'sign-in-out',
    'import-export', 'audit', 'admin'
  )),
  enabled boolean not null default true,
  display_order smallint not null check (display_order between 1 and 1000),
  updated_by uuid,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  row_version bigint not null default 1,
  unique (tenant_id, id),
  unique (tenant_id, module_key),
  foreign key (tenant_id, updated_by)
    references app.users(tenant_id, id) on delete set null (updated_by)
);

insert into app.tenant_modules (tenant_id, module_key, display_order)
select tenants.id, module.module_key, module.display_order
from app.tenants
cross join (values
  ('dashboard', 10), ('students', 20), ('attendance', 30), ('timetables', 40),
  ('classes', 50), ('activities', 60), ('grades', 70), ('families', 80),
  ('staff', 90), ('enrolments', 100), ('finance', 110), ('forms', 120),
  ('communications', 130), ('events', 140), ('alumni', 150), ('photos', 160),
  ('knowledge-base', 170), ('sign-in-out', 180), ('import-export', 190),
  ('audit', 200), ('admin', 210)
) as module(module_key, display_order)
on conflict (tenant_id, module_key) do nothing;

create trigger tenant_modules_updated_metadata
before update on app.tenant_modules
for each row execute function app.set_updated_metadata();

create trigger tenant_modules_audit
after insert or update or delete on app.tenant_modules
for each row execute function audit.capture_row_change();

alter table app.tenant_modules enable row level security;
create policy tenant_modules_select on app.tenant_modules for select to edutex_app
  using (tenant_id = app.current_tenant_id() and app.authorized('admin', 'view'));
create policy tenant_modules_insert on app.tenant_modules for insert to edutex_app
  with check (tenant_id = app.current_tenant_id() and app.authorized('admin', 'manage'));
create policy tenant_modules_update on app.tenant_modules for update to edutex_app
  using (tenant_id = app.current_tenant_id() and app.authorized('admin', 'manage'))
  with check (tenant_id = app.current_tenant_id() and app.authorized('admin', 'manage'));
create policy tenant_modules_delete on app.tenant_modules for delete to edutex_app
  using (tenant_id = app.current_tenant_id() and app.authorized('admin', 'manage'));

grant select, insert, update, delete on app.tenant_modules to edutex_app;

create or replace function app.resolve_enabled_modules(target_tenant_id uuid)
returns text[]
language sql
stable
security definer
set search_path = pg_catalog, app
as $$
  select coalesce(array_agg(tenant_modules.module_key order by tenant_modules.display_order, tenant_modules.module_key), array[]::text[])
  from app.tenant_modules
  join app.tenants on tenants.id = tenant_modules.tenant_id
  where tenant_modules.tenant_id = target_tenant_id
    and tenant_modules.enabled
    and tenants.status = 'active'
$$;

revoke all on function app.resolve_enabled_modules(uuid) from public;
grant execute on function app.resolve_enabled_modules(uuid) to edutex_app;

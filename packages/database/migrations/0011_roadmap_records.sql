-- RC6 roadmap: additive, tenant-bound school workflow records. Existing RC5 tables/data are retained.

create table app.important_dates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  title text not null,
  campus_id uuid,
  starts_on date not null,
  ends_on date not null,
  action text not null default 'information',
  year_levels text[] not null default '{}'::text[],
  audience text not null default 'all',
  created_by uuid not null default app.current_user_id(),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  row_version bigint not null default 1,
  unique (tenant_id, id),
  foreign key (tenant_id, created_by) references app.users(tenant_id, id),
  foreign key (tenant_id, campus_id) references app.campuses(tenant_id, id),
  check (action in ('information','no_classes','no_classes_for_years')),
  check (audience in ('all','staff','parents','students')),
  check (ends_on is null or ends_on >= starts_on)
);
create index important_dates_tenant_updated on app.important_dates (tenant_id, updated_at desc);
alter table app.important_dates enable row level security;
create policy important_dates_select on app.important_dates for select to edutex_app using (tenant_id = app.current_tenant_id() and app.authorized('management', 'view'));
create policy important_dates_insert on app.important_dates for insert to edutex_app with check (tenant_id = app.current_tenant_id() and app.authorized('management', 'create'));
create policy important_dates_update on app.important_dates for update to edutex_app using (tenant_id = app.current_tenant_id() and app.authorized('management', 'edit')) with check (tenant_id = app.current_tenant_id() and app.authorized('management', 'edit'));
create policy important_dates_delete on app.important_dates for delete to edutex_app using (tenant_id = app.current_tenant_id() and app.authorized('management', 'delete'));
create trigger important_dates_metadata before update on app.important_dates for each row execute function app.set_updated_metadata();
create trigger important_dates_audit after insert or update or delete on app.important_dates for each row execute function audit.capture_row_change();
grant select, insert, update, delete on app.important_dates to edutex_app;

create table app.school_groups (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  name text not null,
  kind text not null default 'students',
  description text,
  department_id uuid,
  year_levels text[] not null default '{}'::text[],
  genders text[] not null default '{}'::text[],
  campus_id uuid,
  created_by uuid not null default app.current_user_id(),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  row_version bigint not null default 1,
  unique (tenant_id, id),
  foreign key (tenant_id, created_by) references app.users(tenant_id, id),
  check (kind in ('students','staff','mixed')),
  foreign key (tenant_id, department_id) references app.departments(tenant_id, id),
  foreign key (tenant_id, campus_id) references app.campuses(tenant_id, id)
);
create index school_groups_tenant_updated on app.school_groups (tenant_id, updated_at desc);
alter table app.school_groups enable row level security;
create policy school_groups_select on app.school_groups for select to edutex_app using (tenant_id = app.current_tenant_id() and app.authorized('management', 'view'));
create policy school_groups_insert on app.school_groups for insert to edutex_app with check (tenant_id = app.current_tenant_id() and app.authorized('management', 'create'));
create policy school_groups_update on app.school_groups for update to edutex_app using (tenant_id = app.current_tenant_id() and app.authorized('management', 'edit')) with check (tenant_id = app.current_tenant_id() and app.authorized('management', 'edit'));
create policy school_groups_delete on app.school_groups for delete to edutex_app using (tenant_id = app.current_tenant_id() and app.authorized('management', 'delete'));
create trigger school_groups_metadata before update on app.school_groups for each row execute function app.set_updated_metadata();
create trigger school_groups_audit after insert or update or delete on app.school_groups for each row execute function audit.capture_row_change();
grant select, insert, update, delete on app.school_groups to edutex_app;

create table app.group_members (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  group_id uuid not null,
  user_id uuid,
  student_id uuid,
  staff_id uuid,
  role text not null default 'member',
  valid_from timestamptz not null,
  valid_until timestamptz,
  created_by uuid not null default app.current_user_id(),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  row_version bigint not null default 1,
  unique (tenant_id, id),
  foreign key (tenant_id, created_by) references app.users(tenant_id, id),
  foreign key (tenant_id, group_id) references app.school_groups(tenant_id, id),
  foreign key (tenant_id, user_id) references app.users(tenant_id, id),
  foreign key (tenant_id, student_id) references app.students(tenant_id, id),
  foreign key (tenant_id, staff_id) references app.staff(tenant_id, id),
  check (role in ('member','manager')),
  check (valid_until is null or valid_until >= valid_from),
  check (num_nonnulls(user_id, student_id, staff_id) = 1)
);
create index group_members_tenant_updated on app.group_members (tenant_id, updated_at desc);
alter table app.group_members enable row level security;
create policy group_members_select on app.group_members for select to edutex_app using (tenant_id = app.current_tenant_id() and app.authorized('management', 'view'));
create policy group_members_insert on app.group_members for insert to edutex_app with check (tenant_id = app.current_tenant_id() and app.authorized('management', 'create'));
create policy group_members_update on app.group_members for update to edutex_app using (tenant_id = app.current_tenant_id() and app.authorized('management', 'edit')) with check (tenant_id = app.current_tenant_id() and app.authorized('management', 'edit'));
create policy group_members_delete on app.group_members for delete to edutex_app using (tenant_id = app.current_tenant_id() and app.authorized('management', 'delete'));
create trigger group_members_metadata before update on app.group_members for each row execute function app.set_updated_metadata();
create trigger group_members_audit after insert or update or delete on app.group_members for each row execute function audit.capture_row_change();
grant select, insert, update, delete on app.group_members to edutex_app;

create table app.venues (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  name text not null,
  address text not null,
  emergency_phone text default '000',
  hospital text,
  police text,
  emergency_plan text,
  accessible boolean not null default true,
  created_by uuid not null default app.current_user_id(),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  row_version bigint not null default 1,
  unique (tenant_id, id),
  foreign key (tenant_id, created_by) references app.users(tenant_id, id)
);
create index venues_tenant_updated on app.venues (tenant_id, updated_at desc);
alter table app.venues enable row level security;
create policy venues_select on app.venues for select to edutex_app using (tenant_id = app.current_tenant_id() and app.authorized('events', 'view'));
create policy venues_insert on app.venues for insert to edutex_app with check (tenant_id = app.current_tenant_id() and app.authorized('events', 'create'));
create policy venues_update on app.venues for update to edutex_app using (tenant_id = app.current_tenant_id() and app.authorized('events', 'edit')) with check (tenant_id = app.current_tenant_id() and app.authorized('events', 'edit'));
create policy venues_delete on app.venues for delete to edutex_app using (tenant_id = app.current_tenant_id() and app.authorized('events', 'delete'));
create trigger venues_metadata before update on app.venues for each row execute function app.set_updated_metadata();
create trigger venues_audit after insert or update or delete on app.venues for each row execute function audit.capture_row_change();
grant select, insert, update, delete on app.venues to edutex_app;

create table app.event_plans (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  event_id uuid not null,
  venue_id uuid not null,
  title text not null,
  student_activities text not null,
  staff_activities text not null,
  overnight boolean not null default false,
  accommodation text,
  prior_visit boolean not null default false,
  student_count integer not null,
  staff_count integer not null,
  students_per_staff integer not null,
  hazards text[] not null default '{}'::text[],
  budget_id uuid,
  account_id uuid,
  return_to_work_checked boolean not null default false,
  status text not null default 'draft',
  created_by uuid not null default app.current_user_id(),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  row_version bigint not null default 1,
  unique (tenant_id, id),
  foreign key (tenant_id, created_by) references app.users(tenant_id, id),
  foreign key (tenant_id, event_id) references app.events(tenant_id, id),
  foreign key (tenant_id, venue_id) references app.venues(tenant_id, id),
  check (student_count between 1 and 100000),
  check (staff_count between 1 and 10000),
  check (students_per_staff between 1 and 100),
  foreign key (tenant_id, budget_id) references app.budgets(tenant_id, id),
  foreign key (tenant_id, account_id) references app.chart_of_accounts(tenant_id, id),
  check (status in ('draft','submitted','risk_review','approved','rejected','completed')),
  unique (tenant_id, event_id),
  check (not overnight or nullif(trim(accommodation), '') is not null)
);
create index event_plans_tenant_updated on app.event_plans (tenant_id, updated_at desc);
alter table app.event_plans enable row level security;
create policy event_plans_select on app.event_plans for select to edutex_app using (tenant_id = app.current_tenant_id() and app.authorized('events', 'view'));
create policy event_plans_insert on app.event_plans for insert to edutex_app with check (tenant_id = app.current_tenant_id() and app.authorized('events', 'create'));
create policy event_plans_update on app.event_plans for update to edutex_app using (tenant_id = app.current_tenant_id() and app.authorized('events', 'edit')) with check (tenant_id = app.current_tenant_id() and app.authorized('events', 'edit'));
create policy event_plans_delete on app.event_plans for delete to edutex_app using (tenant_id = app.current_tenant_id() and app.authorized('events', 'delete'));
create trigger event_plans_metadata before update on app.event_plans for each row execute function app.set_updated_metadata();
create trigger event_plans_audit after insert or update or delete on app.event_plans for each row execute function audit.capture_row_change();
grant select, insert, update, delete on app.event_plans to edutex_app;

create table app.event_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  name text not null,
  student_activities text,
  staff_activities text,
  hazards text[] not null default '{}'::text[],
  control_prompts text,
  students_per_staff integer not null,
  overnight boolean not null default false,
  created_by uuid not null default app.current_user_id(),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  row_version bigint not null default 1,
  unique (tenant_id, id),
  foreign key (tenant_id, created_by) references app.users(tenant_id, id),
  check (students_per_staff between 1 and 100)
);
create index event_templates_tenant_updated on app.event_templates (tenant_id, updated_at desc);
alter table app.event_templates enable row level security;
create policy event_templates_select on app.event_templates for select to edutex_app using (tenant_id = app.current_tenant_id() and app.authorized('events', 'view'));
create policy event_templates_insert on app.event_templates for insert to edutex_app with check (tenant_id = app.current_tenant_id() and app.authorized('events', 'create'));
create policy event_templates_update on app.event_templates for update to edutex_app using (tenant_id = app.current_tenant_id() and app.authorized('events', 'edit')) with check (tenant_id = app.current_tenant_id() and app.authorized('events', 'edit'));
create policy event_templates_delete on app.event_templates for delete to edutex_app using (tenant_id = app.current_tenant_id() and app.authorized('events', 'delete'));
create trigger event_templates_metadata before update on app.event_templates for each row execute function app.set_updated_metadata();
create trigger event_templates_audit after insert or update or delete on app.event_templates for each row execute function audit.capture_row_change();
grant select, insert, update, delete on app.event_templates to edutex_app;

create table app.event_risks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  event_plan_id uuid not null,
  hazard text not null,
  people_at_risk text not null,
  likelihood integer not null,
  impact integer not null,
  controls text not null,
  residual_likelihood integer not null,
  residual_impact integer not null,
  owner_user_id uuid not null,
  review_on date not null,
  created_by uuid not null default app.current_user_id(),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  row_version bigint not null default 1,
  unique (tenant_id, id),
  foreign key (tenant_id, created_by) references app.users(tenant_id, id),
  foreign key (tenant_id, event_plan_id) references app.event_plans(tenant_id, id),
  check (likelihood between 1 and 5),
  check (impact between 1 and 5),
  check (residual_likelihood between 1 and 5),
  check (residual_impact between 1 and 5),
  foreign key (tenant_id, owner_user_id) references app.users(tenant_id, id)
);
create index event_risks_tenant_updated on app.event_risks (tenant_id, updated_at desc);
alter table app.event_risks enable row level security;
create policy event_risks_select on app.event_risks for select to edutex_app using (tenant_id = app.current_tenant_id() and app.authorized('events', 'view'));
create policy event_risks_insert on app.event_risks for insert to edutex_app with check (tenant_id = app.current_tenant_id() and app.authorized('events', 'create'));
create policy event_risks_update on app.event_risks for update to edutex_app using (tenant_id = app.current_tenant_id() and app.authorized('events', 'edit')) with check (tenant_id = app.current_tenant_id() and app.authorized('events', 'edit'));
create policy event_risks_delete on app.event_risks for delete to edutex_app using (tenant_id = app.current_tenant_id() and app.authorized('events', 'delete'));
create trigger event_risks_metadata before update on app.event_risks for each row execute function app.set_updated_metadata();
create trigger event_risks_audit after insert or update or delete on app.event_risks for each row execute function audit.capture_row_change();
grant select, insert, update, delete on app.event_risks to edutex_app;

create table app.approval_streams (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  name text not null,
  hazards text[] not null default '{}'::text[],
  minimum_risk_score integer not null,
  approver_group_id uuid not null,
  sequence_number integer not null,
  active boolean not null default true,
  created_by uuid not null default app.current_user_id(),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  row_version bigint not null default 1,
  unique (tenant_id, id),
  foreign key (tenant_id, created_by) references app.users(tenant_id, id),
  check (minimum_risk_score between 1 and 25),
  foreign key (tenant_id, approver_group_id) references app.school_groups(tenant_id, id),
  check (sequence_number between 1 and 20)
);
create index approval_streams_tenant_updated on app.approval_streams (tenant_id, updated_at desc);
alter table app.approval_streams enable row level security;
create policy approval_streams_select on app.approval_streams for select to edutex_app using (tenant_id = app.current_tenant_id() and app.authorized('risk', 'view'));
create policy approval_streams_insert on app.approval_streams for insert to edutex_app with check (tenant_id = app.current_tenant_id() and app.authorized('risk', 'create'));
create policy approval_streams_update on app.approval_streams for update to edutex_app using (tenant_id = app.current_tenant_id() and app.authorized('risk', 'edit')) with check (tenant_id = app.current_tenant_id() and app.authorized('risk', 'edit'));
create policy approval_streams_delete on app.approval_streams for delete to edutex_app using (tenant_id = app.current_tenant_id() and app.authorized('risk', 'delete'));
create trigger approval_streams_metadata before update on app.approval_streams for each row execute function app.set_updated_metadata();
create trigger approval_streams_audit after insert or update or delete on app.approval_streams for each row execute function audit.capture_row_change();
grant select, insert, update, delete on app.approval_streams to edutex_app;

create table app.event_access (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  event_id uuid not null,
  user_id uuid not null,
  valid_from timestamptz not null,
  valid_until timestamptz not null,
  all_day boolean not null default true,
  daily_from time,
  daily_until time,
  timezone text not null default 'Australia/Melbourne',
  reason text not null,
  created_by uuid not null default app.current_user_id(),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  row_version bigint not null default 1,
  unique (tenant_id, id),
  foreign key (tenant_id, created_by) references app.users(tenant_id, id),
  foreign key (tenant_id, event_id) references app.events(tenant_id, id),
  foreign key (tenant_id, user_id) references app.users(tenant_id, id),
  check (valid_until is null or valid_until >= valid_from),
  check (valid_until > valid_from),
  check (all_day or (daily_from is not null and daily_until is not null and daily_until > daily_from))
);
create index event_access_tenant_updated on app.event_access (tenant_id, updated_at desc);
alter table app.event_access enable row level security;
create policy event_access_select on app.event_access for select to edutex_app using (tenant_id = app.current_tenant_id() and app.authorized('events', 'view'));
create policy event_access_insert on app.event_access for insert to edutex_app with check (tenant_id = app.current_tenant_id() and app.authorized('events', 'manage'));
create policy event_access_update on app.event_access for update to edutex_app using (tenant_id = app.current_tenant_id() and app.authorized('events', 'manage')) with check (tenant_id = app.current_tenant_id() and app.authorized('events', 'manage'));
create policy event_access_delete on app.event_access for delete to edutex_app using (tenant_id = app.current_tenant_id() and app.authorized('events', 'manage'));
create trigger event_access_metadata before update on app.event_access for each row execute function app.set_updated_metadata();
create trigger event_access_audit after insert or update or delete on app.event_access for each row execute function audit.capture_row_change();
grant select, insert, update, delete on app.event_access to edutex_app;

create table app.risk_incidents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  title text not null,
  occurred_at timestamptz not null,
  student_id uuid,
  staff_id uuid,
  venue_id uuid,
  class_id uuid,
  event_id uuid,
  category text not null,
  sport text,
  severity text not null default 'low',
  status text not null default 'open',
  secure_note jsonb not null,
  created_by uuid not null default app.current_user_id(),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  row_version bigint not null default 1,
  unique (tenant_id, id),
  foreign key (tenant_id, created_by) references app.users(tenant_id, id),
  foreign key (tenant_id, student_id) references app.students(tenant_id, id),
  foreign key (tenant_id, staff_id) references app.staff(tenant_id, id),
  foreign key (tenant_id, venue_id) references app.venues(tenant_id, id),
  foreign key (tenant_id, class_id) references app.classes(tenant_id, id),
  foreign key (tenant_id, event_id) references app.events(tenant_id, id),
  check (severity in ('low','medium','high','critical')),
  check (status in ('open','in_progress','resolved','closed')),
  check (jsonb_typeof(secure_note) = 'object' and secure_note->>'algorithm' = 'AES-256-GCM' and octet_length(secure_note::text) <= 190000)
);
create index risk_incidents_tenant_updated on app.risk_incidents (tenant_id, updated_at desc);
alter table app.risk_incidents enable row level security;
create policy risk_incidents_select on app.risk_incidents for select to edutex_app using (tenant_id = app.current_tenant_id() and app.authorized('risk', 'view'));
create policy risk_incidents_insert on app.risk_incidents for insert to edutex_app with check (tenant_id = app.current_tenant_id() and app.authorized('risk', 'create'));
create policy risk_incidents_update on app.risk_incidents for update to edutex_app using (tenant_id = app.current_tenant_id() and app.authorized('risk', 'edit')) with check (tenant_id = app.current_tenant_id() and app.authorized('risk', 'edit'));
create policy risk_incidents_delete on app.risk_incidents for delete to edutex_app using (tenant_id = app.current_tenant_id() and app.authorized('risk', 'delete'));
create trigger risk_incidents_metadata before update on app.risk_incidents for each row execute function app.set_updated_metadata();
create trigger risk_incidents_audit after insert or update or delete on app.risk_incidents for each row execute function audit.capture_row_change();
grant select, insert, update, delete on app.risk_incidents to edutex_app;

create table app.hazards (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  title text not null,
  venue_id uuid,
  room_id uuid,
  category text not null,
  likelihood integer not null,
  impact integer not null,
  controls text not null,
  owner_user_id uuid,
  review_on date not null,
  status text not null default 'identified',
  created_by uuid not null default app.current_user_id(),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  row_version bigint not null default 1,
  unique (tenant_id, id),
  foreign key (tenant_id, created_by) references app.users(tenant_id, id),
  foreign key (tenant_id, venue_id) references app.venues(tenant_id, id),
  foreign key (tenant_id, room_id) references app.rooms(tenant_id, id),
  check (likelihood between 1 and 5),
  check (impact between 1 and 5),
  foreign key (tenant_id, owner_user_id) references app.users(tenant_id, id),
  check (status in ('identified','controlled','review_due','closed'))
);
create index hazards_tenant_updated on app.hazards (tenant_id, updated_at desc);
alter table app.hazards enable row level security;
create policy hazards_select on app.hazards for select to edutex_app using (tenant_id = app.current_tenant_id() and app.authorized('risk', 'view'));
create policy hazards_insert on app.hazards for insert to edutex_app with check (tenant_id = app.current_tenant_id() and app.authorized('risk', 'create'));
create policy hazards_update on app.hazards for update to edutex_app using (tenant_id = app.current_tenant_id() and app.authorized('risk', 'edit')) with check (tenant_id = app.current_tenant_id() and app.authorized('risk', 'edit'));
create policy hazards_delete on app.hazards for delete to edutex_app using (tenant_id = app.current_tenant_id() and app.authorized('risk', 'delete'));
create trigger hazards_metadata before update on app.hazards for each row execute function app.set_updated_metadata();
create trigger hazards_audit after insert or update or delete on app.hazards for each row execute function audit.capture_row_change();
grant select, insert, update, delete on app.hazards to edutex_app;

create table app.safety_drills (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  campus_id uuid not null,
  kind text not null default 'fire_inspection',
  title text not null,
  scheduled_at timestamptz not null,
  completed_at timestamptz,
  assembly_point text,
  findings text,
  owner_user_id uuid,
  status text not null default 'planned',
  created_by uuid not null default app.current_user_id(),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  row_version bigint not null default 1,
  unique (tenant_id, id),
  foreign key (tenant_id, created_by) references app.users(tenant_id, id),
  foreign key (tenant_id, campus_id) references app.campuses(tenant_id, id),
  check (kind in ('fire_inspection','evacuation','lockdown','equipment_check')),
  foreign key (tenant_id, owner_user_id) references app.users(tenant_id, id),
  check (status in ('planned','in_progress','complete','actions_required'))
);
create index safety_drills_tenant_updated on app.safety_drills (tenant_id, updated_at desc);
alter table app.safety_drills enable row level security;
create policy safety_drills_select on app.safety_drills for select to edutex_app using (tenant_id = app.current_tenant_id() and app.authorized('risk', 'view'));
create policy safety_drills_insert on app.safety_drills for insert to edutex_app with check (tenant_id = app.current_tenant_id() and app.authorized('risk', 'create'));
create policy safety_drills_update on app.safety_drills for update to edutex_app using (tenant_id = app.current_tenant_id() and app.authorized('risk', 'edit')) with check (tenant_id = app.current_tenant_id() and app.authorized('risk', 'edit'));
create policy safety_drills_delete on app.safety_drills for delete to edutex_app using (tenant_id = app.current_tenant_id() and app.authorized('risk', 'delete'));
create trigger safety_drills_metadata before update on app.safety_drills for each row execute function app.set_updated_metadata();
create trigger safety_drills_audit after insert or update or delete on app.safety_drills for each row execute function audit.capture_row_change();
grant select, insert, update, delete on app.safety_drills to edutex_app;

create table app.nurse_visits (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  student_id uuid not null,
  arrived_at timestamptz not null,
  departed_at timestamptz,
  outcome text not null default 'in_care',
  parent_contacted boolean not null default false,
  secure_note jsonb not null,
  created_by uuid not null default app.current_user_id(),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  row_version bigint not null default 1,
  unique (tenant_id, id),
  foreign key (tenant_id, created_by) references app.users(tenant_id, id),
  foreign key (tenant_id, student_id) references app.students(tenant_id, id),
  check (outcome in ('in_care','returned_to_class','collected','ambulance','referred')),
  check (jsonb_typeof(secure_note) = 'object' and secure_note->>'algorithm' = 'AES-256-GCM' and octet_length(secure_note::text) <= 190000),
  check (departed_at is null or departed_at >= arrived_at)
);
create index nurse_visits_tenant_updated on app.nurse_visits (tenant_id, updated_at desc);
alter table app.nurse_visits enable row level security;
create policy nurse_visits_select on app.nurse_visits for select to edutex_app using (tenant_id = app.current_tenant_id() and app.authorized('nurse', 'view'));
create policy nurse_visits_insert on app.nurse_visits for insert to edutex_app with check (tenant_id = app.current_tenant_id() and app.authorized('nurse', 'create'));
create policy nurse_visits_update on app.nurse_visits for update to edutex_app using (tenant_id = app.current_tenant_id() and app.authorized('nurse', 'edit')) with check (tenant_id = app.current_tenant_id() and app.authorized('nurse', 'edit'));
create policy nurse_visits_delete on app.nurse_visits for delete to edutex_app using (tenant_id = app.current_tenant_id() and app.authorized('nurse', 'delete'));
create trigger nurse_visits_metadata before update on app.nurse_visits for each row execute function app.set_updated_metadata();
create trigger nurse_visits_audit after insert or update or delete on app.nurse_visits for each row execute function audit.capture_row_change();
grant select, insert, update, delete on app.nurse_visits to edutex_app;

create table app.wellbeing_cases (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  student_id uuid not null,
  assigned_user_id uuid not null,
  category text not null default 'wellbeing',
  opened_on date not null,
  review_on date not null,
  status text not null default 'open',
  secure_note jsonb not null,
  created_by uuid not null default app.current_user_id(),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  row_version bigint not null default 1,
  unique (tenant_id, id),
  foreign key (tenant_id, created_by) references app.users(tenant_id, id),
  foreign key (tenant_id, student_id) references app.students(tenant_id, id),
  foreign key (tenant_id, assigned_user_id) references app.users(tenant_id, id),
  check (category in ('wellbeing','counselling','psychology','pastoral','referral')),
  check (status in ('open','monitoring','referred','closed')),
  check (jsonb_typeof(secure_note) = 'object' and secure_note->>'algorithm' = 'AES-256-GCM' and octet_length(secure_note::text) <= 190000)
);
create index wellbeing_cases_tenant_updated on app.wellbeing_cases (tenant_id, updated_at desc);
alter table app.wellbeing_cases enable row level security;
create policy wellbeing_cases_select on app.wellbeing_cases for select to edutex_app using (tenant_id = app.current_tenant_id() and app.authorized('wellbeing', 'view') and (assigned_user_id = app.current_user_id() or app.has_permission('wellbeing:manage')));
create policy wellbeing_cases_insert on app.wellbeing_cases for insert to edutex_app with check (tenant_id = app.current_tenant_id() and app.authorized('wellbeing', 'create') and (assigned_user_id = app.current_user_id() or app.has_permission('wellbeing:manage')));
create policy wellbeing_cases_update on app.wellbeing_cases for update to edutex_app using (tenant_id = app.current_tenant_id() and app.authorized('wellbeing', 'edit') and (assigned_user_id = app.current_user_id() or app.has_permission('wellbeing:manage'))) with check (tenant_id = app.current_tenant_id() and app.authorized('wellbeing', 'edit') and (assigned_user_id = app.current_user_id() or app.has_permission('wellbeing:manage')));
create policy wellbeing_cases_delete on app.wellbeing_cases for delete to edutex_app using (tenant_id = app.current_tenant_id() and app.authorized('wellbeing', 'delete') and (assigned_user_id = app.current_user_id() or app.has_permission('wellbeing:manage')));
create trigger wellbeing_cases_metadata before update on app.wellbeing_cases for each row execute function app.set_updated_metadata();
create trigger wellbeing_cases_audit after insert or update or delete on app.wellbeing_cases for each row execute function audit.capture_row_change();
grant select, insert, update, delete on app.wellbeing_cases to edutex_app;

create table app.buildings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  campus_id uuid not null,
  code text not null,
  name text not null,
  address text,
  access_notes text,
  active boolean not null default true,
  created_by uuid not null default app.current_user_id(),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  row_version bigint not null default 1,
  unique (tenant_id, id),
  foreign key (tenant_id, created_by) references app.users(tenant_id, id),
  foreign key (tenant_id, campus_id) references app.campuses(tenant_id, id)
);
create index buildings_tenant_updated on app.buildings (tenant_id, updated_at desc);
alter table app.buildings enable row level security;
create policy buildings_select on app.buildings for select to edutex_app using (tenant_id = app.current_tenant_id() and app.authorized('maintenance', 'view'));
create policy buildings_insert on app.buildings for insert to edutex_app with check (tenant_id = app.current_tenant_id() and app.authorized('maintenance', 'create'));
create policy buildings_update on app.buildings for update to edutex_app using (tenant_id = app.current_tenant_id() and app.authorized('maintenance', 'edit')) with check (tenant_id = app.current_tenant_id() and app.authorized('maintenance', 'edit'));
create policy buildings_delete on app.buildings for delete to edutex_app using (tenant_id = app.current_tenant_id() and app.authorized('maintenance', 'delete'));
create trigger buildings_metadata before update on app.buildings for each row execute function app.set_updated_metadata();
create trigger buildings_audit after insert or update or delete on app.buildings for each row execute function audit.capture_row_change();
grant select, insert, update, delete on app.buildings to edutex_app;

create table app.work_orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  title text not null,
  building_id uuid,
  room_id uuid,
  category text not null default 'repair',
  priority text not null default 'routine',
  description text not null,
  assigned_user_id uuid,
  due_on date not null,
  completed_on date,
  cost numeric(18,2) default 0.00,
  account_id uuid,
  status text not null default 'open',
  created_by uuid not null default app.current_user_id(),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  row_version bigint not null default 1,
  unique (tenant_id, id),
  foreign key (tenant_id, created_by) references app.users(tenant_id, id),
  foreign key (tenant_id, building_id) references app.buildings(tenant_id, id),
  foreign key (tenant_id, room_id) references app.rooms(tenant_id, id),
  check (category in ('repair','inspection','grounds','capital_works','construction','renovation')),
  check (priority in ('routine','urgent','critical')),
  foreign key (tenant_id, assigned_user_id) references app.users(tenant_id, id),
  check (cost >= 0),
  foreign key (tenant_id, account_id) references app.chart_of_accounts(tenant_id, id),
  check (status in ('open','assigned','in_progress','completed','cancelled'))
);
create index work_orders_tenant_updated on app.work_orders (tenant_id, updated_at desc);
alter table app.work_orders enable row level security;
create policy work_orders_select on app.work_orders for select to edutex_app using (tenant_id = app.current_tenant_id() and app.authorized('maintenance', 'view'));
create policy work_orders_insert on app.work_orders for insert to edutex_app with check (tenant_id = app.current_tenant_id() and app.authorized('maintenance', 'create'));
create policy work_orders_update on app.work_orders for update to edutex_app using (tenant_id = app.current_tenant_id() and app.authorized('maintenance', 'edit')) with check (tenant_id = app.current_tenant_id() and app.authorized('maintenance', 'edit'));
create policy work_orders_delete on app.work_orders for delete to edutex_app using (tenant_id = app.current_tenant_id() and app.authorized('maintenance', 'delete'));
create trigger work_orders_metadata before update on app.work_orders for each row execute function app.set_updated_metadata();
create trigger work_orders_audit after insert or update or delete on app.work_orders for each row execute function audit.capture_row_change();
grant select, insert, update, delete on app.work_orders to edutex_app;

create table app.maintenance_history (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  work_order_id uuid not null,
  performed_at timestamptz not null,
  summary text not null,
  contractor text,
  cost numeric(18,2) not null,
  next_due_on date,
  created_by uuid not null default app.current_user_id(),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  row_version bigint not null default 1,
  unique (tenant_id, id),
  foreign key (tenant_id, created_by) references app.users(tenant_id, id),
  foreign key (tenant_id, work_order_id) references app.work_orders(tenant_id, id),
  check (cost >= 0)
);
create index maintenance_history_tenant_updated on app.maintenance_history (tenant_id, updated_at desc);
alter table app.maintenance_history enable row level security;
create policy maintenance_history_select on app.maintenance_history for select to edutex_app using (tenant_id = app.current_tenant_id() and app.authorized('maintenance', 'view'));
create policy maintenance_history_insert on app.maintenance_history for insert to edutex_app with check (tenant_id = app.current_tenant_id() and app.authorized('maintenance', 'create'));
create policy maintenance_history_update on app.maintenance_history for update to edutex_app using (tenant_id = app.current_tenant_id() and app.authorized('maintenance', 'edit')) with check (tenant_id = app.current_tenant_id() and app.authorized('maintenance', 'edit'));
create policy maintenance_history_delete on app.maintenance_history for delete to edutex_app using (tenant_id = app.current_tenant_id() and app.authorized('maintenance', 'delete'));
create trigger maintenance_history_metadata before update on app.maintenance_history for each row execute function app.set_updated_metadata();
create trigger maintenance_history_audit after insert or update or delete on app.maintenance_history for each row execute function audit.capture_row_change();
grant select, insert, update, delete on app.maintenance_history to edutex_app;

create table app.suppliers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  name text not null,
  abn text,
  email text,
  phone text,
  address text,
  payment_terms_days integer not null default 30,
  active boolean not null default true,
  created_by uuid not null default app.current_user_id(),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  row_version bigint not null default 1,
  unique (tenant_id, id),
  foreign key (tenant_id, created_by) references app.users(tenant_id, id),
  check (payment_terms_days between 0 and 365)
);
create index suppliers_tenant_updated on app.suppliers (tenant_id, updated_at desc);
alter table app.suppliers enable row level security;
create policy suppliers_select on app.suppliers for select to edutex_app using (tenant_id = app.current_tenant_id() and app.authorized('finance', 'view'));
create policy suppliers_insert on app.suppliers for insert to edutex_app with check (tenant_id = app.current_tenant_id() and app.authorized('finance', 'create'));
create policy suppliers_update on app.suppliers for update to edutex_app using (tenant_id = app.current_tenant_id() and app.authorized('finance', 'edit')) with check (tenant_id = app.current_tenant_id() and app.authorized('finance', 'edit'));
create policy suppliers_delete on app.suppliers for delete to edutex_app using (tenant_id = app.current_tenant_id() and app.authorized('finance', 'delete'));
create trigger suppliers_metadata before update on app.suppliers for each row execute function app.set_updated_metadata();
create trigger suppliers_audit after insert or update or delete on app.suppliers for each row execute function audit.capture_row_change();
grant select, insert, update, delete on app.suppliers to edutex_app;

create table app.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  reference text not null,
  supplier_id uuid not null,
  account_id uuid not null,
  budget_id uuid,
  description text not null,
  amount numeric(18,2) not null,
  tax_total numeric(18,2) not null default 0.00,
  due_on date not null,
  status text not null default 'draft',
  created_by uuid not null default app.current_user_id(),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  row_version bigint not null default 1,
  unique (tenant_id, id),
  foreign key (tenant_id, created_by) references app.users(tenant_id, id),
  foreign key (tenant_id, supplier_id) references app.suppliers(tenant_id, id),
  foreign key (tenant_id, account_id) references app.chart_of_accounts(tenant_id, id),
  foreign key (tenant_id, budget_id) references app.budgets(tenant_id, id),
  check (amount >= 0),
  check (tax_total >= 0),
  check (status in ('draft','submitted','approved','received','invoiced','paid','rejected','cancelled'))
);
create index purchase_orders_tenant_updated on app.purchase_orders (tenant_id, updated_at desc);
alter table app.purchase_orders enable row level security;
create policy purchase_orders_select on app.purchase_orders for select to edutex_app using (tenant_id = app.current_tenant_id() and app.authorized('finance', 'view'));
create policy purchase_orders_insert on app.purchase_orders for insert to edutex_app with check (tenant_id = app.current_tenant_id() and app.authorized('finance', 'create'));
create policy purchase_orders_update on app.purchase_orders for update to edutex_app using (tenant_id = app.current_tenant_id() and app.authorized('finance', 'edit')) with check (tenant_id = app.current_tenant_id() and app.authorized('finance', 'edit'));
create policy purchase_orders_delete on app.purchase_orders for delete to edutex_app using (tenant_id = app.current_tenant_id() and app.authorized('finance', 'delete'));
create trigger purchase_orders_metadata before update on app.purchase_orders for each row execute function app.set_updated_metadata();
create trigger purchase_orders_audit after insert or update or delete on app.purchase_orders for each row execute function audit.capture_row_change();
grant select, insert, update, delete on app.purchase_orders to edutex_app;

create table app.supplier_bills (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  purchase_order_id uuid not null,
  supplier_id uuid not null,
  reference text not null,
  issue_date date not null,
  due_date date not null,
  amount numeric(18,2) not null,
  tax_total numeric(18,2) not null,
  status text not null default 'draft',
  created_by uuid not null default app.current_user_id(),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  row_version bigint not null default 1,
  unique (tenant_id, id),
  foreign key (tenant_id, created_by) references app.users(tenant_id, id),
  foreign key (tenant_id, purchase_order_id) references app.purchase_orders(tenant_id, id),
  foreign key (tenant_id, supplier_id) references app.suppliers(tenant_id, id),
  check (amount >= 0),
  check (tax_total >= 0),
  check (status in ('draft','matched','approved','paid','disputed')),
  check (due_date is null or due_date >= issue_date)
);
create index supplier_bills_tenant_updated on app.supplier_bills (tenant_id, updated_at desc);
alter table app.supplier_bills enable row level security;
create policy supplier_bills_select on app.supplier_bills for select to edutex_app using (tenant_id = app.current_tenant_id() and app.authorized('finance', 'view'));
create policy supplier_bills_insert on app.supplier_bills for insert to edutex_app with check (tenant_id = app.current_tenant_id() and app.authorized('finance', 'create'));
create policy supplier_bills_update on app.supplier_bills for update to edutex_app using (tenant_id = app.current_tenant_id() and app.authorized('finance', 'edit')) with check (tenant_id = app.current_tenant_id() and app.authorized('finance', 'edit'));
create policy supplier_bills_delete on app.supplier_bills for delete to edutex_app using (tenant_id = app.current_tenant_id() and app.authorized('finance', 'delete'));
create trigger supplier_bills_metadata before update on app.supplier_bills for each row execute function app.set_updated_metadata();
create trigger supplier_bills_audit after insert or update or delete on app.supplier_bills for each row execute function audit.capture_row_change();
grant select, insert, update, delete on app.supplier_bills to edutex_app;

create table app.fee_policies (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  name text not null,
  kind text not null default 'sibling_discount',
  family_id uuid,
  student_id uuid,
  guardian_id uuid,
  percent integer not null,
  minimum_siblings integer,
  starts_on date not null,
  ends_on date not null,
  notes text,
  active boolean not null default true,
  created_by uuid not null default app.current_user_id(),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  row_version bigint not null default 1,
  unique (tenant_id, id),
  foreign key (tenant_id, created_by) references app.users(tenant_id, id),
  check (kind in ('sibling_discount','scholarship','fee_split','bursary')),
  foreign key (tenant_id, family_id) references app.families(tenant_id, id),
  foreign key (tenant_id, student_id) references app.students(tenant_id, id),
  foreign key (tenant_id, guardian_id) references app.guardians(tenant_id, id),
  check (percent between 0 and 100),
  check (minimum_siblings between 1 and 30),
  check (ends_on is null or ends_on >= starts_on)
);
create index fee_policies_tenant_updated on app.fee_policies (tenant_id, updated_at desc);
alter table app.fee_policies enable row level security;
create policy fee_policies_select on app.fee_policies for select to edutex_app using (tenant_id = app.current_tenant_id() and app.authorized('finance', 'view'));
create policy fee_policies_insert on app.fee_policies for insert to edutex_app with check (tenant_id = app.current_tenant_id() and app.authorized('finance', 'create'));
create policy fee_policies_update on app.fee_policies for update to edutex_app using (tenant_id = app.current_tenant_id() and app.authorized('finance', 'edit')) with check (tenant_id = app.current_tenant_id() and app.authorized('finance', 'edit'));
create policy fee_policies_delete on app.fee_policies for delete to edutex_app using (tenant_id = app.current_tenant_id() and app.authorized('finance', 'delete'));
create trigger fee_policies_metadata before update on app.fee_policies for each row execute function app.set_updated_metadata();
create trigger fee_policies_audit after insert or update or delete on app.fee_policies for each row execute function audit.capture_row_change();
grant select, insert, update, delete on app.fee_policies to edutex_app;

create table app.bank_accounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  name text not null,
  account_id uuid not null,
  currency_code text not null default 'AUD',
  statement_reference text,
  active boolean not null default true,
  created_by uuid not null default app.current_user_id(),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  row_version bigint not null default 1,
  unique (tenant_id, id),
  foreign key (tenant_id, created_by) references app.users(tenant_id, id),
  foreign key (tenant_id, account_id) references app.chart_of_accounts(tenant_id, id)
);
create index bank_accounts_tenant_updated on app.bank_accounts (tenant_id, updated_at desc);
alter table app.bank_accounts enable row level security;
create policy bank_accounts_select on app.bank_accounts for select to edutex_app using (tenant_id = app.current_tenant_id() and app.authorized('finance', 'view'));
create policy bank_accounts_insert on app.bank_accounts for insert to edutex_app with check (tenant_id = app.current_tenant_id() and app.authorized('finance', 'create'));
create policy bank_accounts_update on app.bank_accounts for update to edutex_app using (tenant_id = app.current_tenant_id() and app.authorized('finance', 'edit')) with check (tenant_id = app.current_tenant_id() and app.authorized('finance', 'edit'));
create policy bank_accounts_delete on app.bank_accounts for delete to edutex_app using (tenant_id = app.current_tenant_id() and app.authorized('finance', 'delete'));
create trigger bank_accounts_metadata before update on app.bank_accounts for each row execute function app.set_updated_metadata();
create trigger bank_accounts_audit after insert or update or delete on app.bank_accounts for each row execute function audit.capture_row_change();
grant select, insert, update, delete on app.bank_accounts to edutex_app;

create table app.bank_transactions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  bank_account_id uuid not null,
  reference text not null,
  transaction_date date not null,
  description text not null,
  amount numeric(18,2) not null,
  payment_id uuid,
  status text not null default 'unmatched',
  created_by uuid not null default app.current_user_id(),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  row_version bigint not null default 1,
  unique (tenant_id, id),
  foreign key (tenant_id, created_by) references app.users(tenant_id, id),
  foreign key (tenant_id, bank_account_id) references app.bank_accounts(tenant_id, id),
  foreign key (tenant_id, payment_id) references app.payments(tenant_id, id),
  check (status in ('unmatched','matched','reconciled')),
  unique (tenant_id, bank_account_id, reference)
);
create index bank_transactions_tenant_updated on app.bank_transactions (tenant_id, updated_at desc);
alter table app.bank_transactions enable row level security;
create policy bank_transactions_select on app.bank_transactions for select to edutex_app using (tenant_id = app.current_tenant_id() and app.authorized('finance', 'view'));
create policy bank_transactions_insert on app.bank_transactions for insert to edutex_app with check (tenant_id = app.current_tenant_id() and app.authorized('finance', 'create'));
create policy bank_transactions_update on app.bank_transactions for update to edutex_app using (tenant_id = app.current_tenant_id() and app.authorized('finance', 'edit')) with check (tenant_id = app.current_tenant_id() and app.authorized('finance', 'edit'));
create policy bank_transactions_delete on app.bank_transactions for delete to edutex_app using (tenant_id = app.current_tenant_id() and app.authorized('finance', 'delete'));
create trigger bank_transactions_metadata before update on app.bank_transactions for each row execute function app.set_updated_metadata();
create trigger bank_transactions_audit after insert or update or delete on app.bank_transactions for each row execute function audit.capture_row_change();
grant select, insert, update, delete on app.bank_transactions to edutex_app;

create table app.payroll_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  staff_id uuid not null,
  period_start date not null,
  period_end date not null,
  ordinary_minutes integer not null,
  overtime_minutes integer not null default 0,
  hourly_rate numeric(18,2) not null,
  overtime_rate numeric(18,2) not null,
  tax_total numeric(18,2) not null default 0.00,
  notes text,
  status text not null default 'draft',
  created_by uuid not null default app.current_user_id(),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  row_version bigint not null default 1,
  unique (tenant_id, id),
  foreign key (tenant_id, created_by) references app.users(tenant_id, id),
  foreign key (tenant_id, staff_id) references app.staff(tenant_id, id),
  check (ordinary_minutes between 0 and 50000),
  check (overtime_minutes between 0 and 50000),
  check (hourly_rate >= 0),
  check (overtime_rate >= 0),
  check (tax_total >= 0),
  check (status in ('draft','submitted','approved','paid')),
  check (period_end is null or period_end >= period_start)
);
create index payroll_lines_tenant_updated on app.payroll_lines (tenant_id, updated_at desc);
alter table app.payroll_lines enable row level security;
create policy payroll_lines_select on app.payroll_lines for select to edutex_app using (tenant_id = app.current_tenant_id() and app.authorized('finance', 'view'));
create policy payroll_lines_insert on app.payroll_lines for insert to edutex_app with check (tenant_id = app.current_tenant_id() and app.authorized('finance', 'create'));
create policy payroll_lines_update on app.payroll_lines for update to edutex_app using (tenant_id = app.current_tenant_id() and app.authorized('finance', 'edit')) with check (tenant_id = app.current_tenant_id() and app.authorized('finance', 'edit'));
create policy payroll_lines_delete on app.payroll_lines for delete to edutex_app using (tenant_id = app.current_tenant_id() and app.authorized('finance', 'delete'));
create trigger payroll_lines_metadata before update on app.payroll_lines for each row execute function app.set_updated_metadata();
create trigger payroll_lines_audit after insert or update or delete on app.payroll_lines for each row execute function audit.capture_row_change();
grant select, insert, update, delete on app.payroll_lines to edutex_app;

create table app.staff_onboarding (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  staff_id uuid not null,
  title text not null,
  kind text not null default 'identity_check',
  assigned_user_id uuid,
  due_on date not null,
  completed_on date,
  status text not null default 'pending',
  created_by uuid not null default app.current_user_id(),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  row_version bigint not null default 1,
  unique (tenant_id, id),
  foreign key (tenant_id, created_by) references app.users(tenant_id, id),
  foreign key (tenant_id, staff_id) references app.staff(tenant_id, id),
  check (kind in ('identity_check','child_safety','induction','training','payroll','system_access')),
  foreign key (tenant_id, assigned_user_id) references app.users(tenant_id, id),
  check (status in ('pending','in_progress','completed','blocked'))
);
create index staff_onboarding_tenant_updated on app.staff_onboarding (tenant_id, updated_at desc);
alter table app.staff_onboarding enable row level security;
create policy staff_onboarding_select on app.staff_onboarding for select to edutex_app using (tenant_id = app.current_tenant_id() and app.authorized('staff', 'view'));
create policy staff_onboarding_insert on app.staff_onboarding for insert to edutex_app with check (tenant_id = app.current_tenant_id() and app.authorized('staff', 'create'));
create policy staff_onboarding_update on app.staff_onboarding for update to edutex_app using (tenant_id = app.current_tenant_id() and app.authorized('staff', 'edit')) with check (tenant_id = app.current_tenant_id() and app.authorized('staff', 'edit'));
create policy staff_onboarding_delete on app.staff_onboarding for delete to edutex_app using (tenant_id = app.current_tenant_id() and app.authorized('staff', 'delete'));
create trigger staff_onboarding_metadata before update on app.staff_onboarding for each row execute function app.set_updated_metadata();
create trigger staff_onboarding_audit after insert or update or delete on app.staff_onboarding for each row execute function audit.capture_row_change();
grant select, insert, update, delete on app.staff_onboarding to edutex_app;

create table app.report_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  name text not null,
  kind text not null default 'invoice',
  heading text not null,
  footer text,
  accent_colour text default '#0f6cbd',
  organisation_details text,
  payment_instructions text,
  created_by uuid not null default app.current_user_id(),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  row_version bigint not null default 1,
  unique (tenant_id, id),
  foreign key (tenant_id, created_by) references app.users(tenant_id, id),
  check (kind in ('invoice','income_statement','balance_sheet','budget','general'))
);
create index report_templates_tenant_updated on app.report_templates (tenant_id, updated_at desc);
alter table app.report_templates enable row level security;
create policy report_templates_select on app.report_templates for select to edutex_app using (tenant_id = app.current_tenant_id() and app.authorized('finance', 'view'));
create policy report_templates_insert on app.report_templates for insert to edutex_app with check (tenant_id = app.current_tenant_id() and app.authorized('finance', 'create'));
create policy report_templates_update on app.report_templates for update to edutex_app using (tenant_id = app.current_tenant_id() and app.authorized('finance', 'edit')) with check (tenant_id = app.current_tenant_id() and app.authorized('finance', 'edit'));
create policy report_templates_delete on app.report_templates for delete to edutex_app using (tenant_id = app.current_tenant_id() and app.authorized('finance', 'delete'));
create trigger report_templates_metadata before update on app.report_templates for each row execute function app.set_updated_metadata();
create trigger report_templates_audit after insert or update or delete on app.report_templates for each row execute function audit.capture_row_change();
grant select, insert, update, delete on app.report_templates to edutex_app;

create table app.alumni_donations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  alumni_profile_id uuid not null,
  reference text not null,
  received_on date not null,
  amount numeric(18,2) not null,
  purpose text not null,
  status text not null default 'pledged',
  acknowledged boolean not null default false,
  created_by uuid not null default app.current_user_id(),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  row_version bigint not null default 1,
  unique (tenant_id, id),
  foreign key (tenant_id, created_by) references app.users(tenant_id, id),
  foreign key (tenant_id, alumni_profile_id) references app.alumni_profiles(tenant_id, id),
  check (amount >= 0),
  check (status in ('pledged','received','refunded'))
);
create index alumni_donations_tenant_updated on app.alumni_donations (tenant_id, updated_at desc);
alter table app.alumni_donations enable row level security;
create policy alumni_donations_select on app.alumni_donations for select to edutex_app using (tenant_id = app.current_tenant_id() and app.authorized('alumni', 'view'));
create policy alumni_donations_insert on app.alumni_donations for insert to edutex_app with check (tenant_id = app.current_tenant_id() and app.authorized('alumni', 'create'));
create policy alumni_donations_update on app.alumni_donations for update to edutex_app using (tenant_id = app.current_tenant_id() and app.authorized('alumni', 'edit')) with check (tenant_id = app.current_tenant_id() and app.authorized('alumni', 'edit'));
create policy alumni_donations_delete on app.alumni_donations for delete to edutex_app using (tenant_id = app.current_tenant_id() and app.authorized('alumni', 'delete'));
create trigger alumni_donations_metadata before update on app.alumni_donations for each row execute function app.set_updated_metadata();
create trigger alumni_donations_audit after insert or update or delete on app.alumni_donations for each row execute function audit.capture_row_change();
grant select, insert, update, delete on app.alumni_donations to edutex_app;

create table app.alumni_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  event_id uuid not null,
  title text not null,
  class_of text[] not null default '{}'::text[],
  group_id uuid,
  notes text,
  created_by uuid not null default app.current_user_id(),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  row_version bigint not null default 1,
  unique (tenant_id, id),
  foreign key (tenant_id, created_by) references app.users(tenant_id, id),
  foreign key (tenant_id, event_id) references app.events(tenant_id, id),
  foreign key (tenant_id, group_id) references app.school_groups(tenant_id, id)
);
create index alumni_events_tenant_updated on app.alumni_events (tenant_id, updated_at desc);
alter table app.alumni_events enable row level security;
create policy alumni_events_select on app.alumni_events for select to edutex_app using (tenant_id = app.current_tenant_id() and app.authorized('alumni', 'view'));
create policy alumni_events_insert on app.alumni_events for insert to edutex_app with check (tenant_id = app.current_tenant_id() and app.authorized('alumni', 'create'));
create policy alumni_events_update on app.alumni_events for update to edutex_app using (tenant_id = app.current_tenant_id() and app.authorized('alumni', 'edit')) with check (tenant_id = app.current_tenant_id() and app.authorized('alumni', 'edit'));
create policy alumni_events_delete on app.alumni_events for delete to edutex_app using (tenant_id = app.current_tenant_id() and app.authorized('alumni', 'delete'));
create trigger alumni_events_metadata before update on app.alumni_events for each row execute function app.set_updated_metadata();
create trigger alumni_events_audit after insert or update or delete on app.alumni_events for each row execute function audit.capture_row_change();
grant select, insert, update, delete on app.alumni_events to edutex_app;

create table app.alumni_family_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  alumni_profile_id uuid not null,
  family_id uuid not null,
  relationship text not null,
  verified_on date not null,
  created_by uuid not null default app.current_user_id(),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  row_version bigint not null default 1,
  unique (tenant_id, id),
  foreign key (tenant_id, created_by) references app.users(tenant_id, id),
  foreign key (tenant_id, alumni_profile_id) references app.alumni_profiles(tenant_id, id),
  foreign key (tenant_id, family_id) references app.families(tenant_id, id),
  unique (tenant_id, alumni_profile_id, family_id)
);
create index alumni_family_links_tenant_updated on app.alumni_family_links (tenant_id, updated_at desc);
alter table app.alumni_family_links enable row level security;
create policy alumni_family_links_select on app.alumni_family_links for select to edutex_app using (tenant_id = app.current_tenant_id() and app.authorized('alumni', 'view'));
create policy alumni_family_links_insert on app.alumni_family_links for insert to edutex_app with check (tenant_id = app.current_tenant_id() and app.authorized('alumni', 'create'));
create policy alumni_family_links_update on app.alumni_family_links for update to edutex_app using (tenant_id = app.current_tenant_id() and app.authorized('alumni', 'edit')) with check (tenant_id = app.current_tenant_id() and app.authorized('alumni', 'edit'));
create policy alumni_family_links_delete on app.alumni_family_links for delete to edutex_app using (tenant_id = app.current_tenant_id() and app.authorized('alumni', 'delete'));
create trigger alumni_family_links_metadata before update on app.alumni_family_links for each row execute function app.set_updated_metadata();
create trigger alumni_family_links_audit after insert or update or delete on app.alumni_family_links for each row execute function audit.capture_row_change();
grant select, insert, update, delete on app.alumni_family_links to edutex_app;

create table app.course_materials (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  class_id uuid not null,
  title text not null,
  description text,
  content text not null,
  language text not null default 'en-AU',
  subject text,
  licence text,
  resource_type text not null default 'lesson',
  status text not null default 'draft',
  created_by uuid not null default app.current_user_id(),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  row_version bigint not null default 1,
  unique (tenant_id, id),
  foreign key (tenant_id, created_by) references app.users(tenant_id, id),
  foreign key (tenant_id, class_id) references app.classes(tenant_id, id),
  check (status in ('draft','published','archived'))
);
create index course_materials_tenant_updated on app.course_materials (tenant_id, updated_at desc);
alter table app.course_materials enable row level security;
create policy course_materials_select on app.course_materials for select to edutex_app using (tenant_id = app.current_tenant_id() and app.authorized('classes', 'view'));
create policy course_materials_insert on app.course_materials for insert to edutex_app with check (tenant_id = app.current_tenant_id() and app.authorized('classes', 'create'));
create policy course_materials_update on app.course_materials for update to edutex_app using (tenant_id = app.current_tenant_id() and app.authorized('classes', 'edit')) with check (tenant_id = app.current_tenant_id() and app.authorized('classes', 'edit'));
create policy course_materials_delete on app.course_materials for delete to edutex_app using (tenant_id = app.current_tenant_id() and app.authorized('classes', 'delete'));
create trigger course_materials_metadata before update on app.course_materials for each row execute function app.set_updated_metadata();
create trigger course_materials_audit after insert or update or delete on app.course_materials for each row execute function audit.capture_row_change();
grant select, insert, update, delete on app.course_materials to edutex_app;

create table app.assignments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  class_id uuid not null,
  title text not null,
  instructions text not null,
  due_at timestamptz not null,
  status text not null default 'draft',
  created_by uuid not null default app.current_user_id(),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  row_version bigint not null default 1,
  unique (tenant_id, id),
  foreign key (tenant_id, created_by) references app.users(tenant_id, id),
  foreign key (tenant_id, class_id) references app.classes(tenant_id, id),
  check (status in ('draft','published','closed'))
);
create index assignments_tenant_updated on app.assignments (tenant_id, updated_at desc);
alter table app.assignments enable row level security;
create policy assignments_select on app.assignments for select to edutex_app using (tenant_id = app.current_tenant_id() and app.authorized('classes', 'view'));
create policy assignments_insert on app.assignments for insert to edutex_app with check (tenant_id = app.current_tenant_id() and app.authorized('classes', 'create'));
create policy assignments_update on app.assignments for update to edutex_app using (tenant_id = app.current_tenant_id() and app.authorized('classes', 'edit')) with check (tenant_id = app.current_tenant_id() and app.authorized('classes', 'edit'));
create policy assignments_delete on app.assignments for delete to edutex_app using (tenant_id = app.current_tenant_id() and app.authorized('classes', 'delete'));
create trigger assignments_metadata before update on app.assignments for each row execute function app.set_updated_metadata();
create trigger assignments_audit after insert or update or delete on app.assignments for each row execute function audit.capture_row_change();
grant select, insert, update, delete on app.assignments to edutex_app;

create table app.guardian_relationships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  guardian_id uuid not null,
  student_id uuid not null,
  relationship text not null,
  can_view_medical boolean not null default false,
  can_consent boolean not null default false,
  can_view_finance boolean not null default false,
  receives_comms boolean not null default true,
  restricted boolean not null default false,
  valid_from date not null,
  valid_until date,
  created_by uuid not null default app.current_user_id(),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  row_version bigint not null default 1,
  unique (tenant_id, id),
  foreign key (tenant_id, created_by) references app.users(tenant_id, id),
  foreign key (tenant_id, guardian_id) references app.guardians(tenant_id, id),
  foreign key (tenant_id, student_id) references app.students(tenant_id, id),
  check (valid_until is null or valid_until >= valid_from),
  unique (tenant_id, guardian_id, student_id)
);
create index guardian_relationships_tenant_updated on app.guardian_relationships (tenant_id, updated_at desc);
alter table app.guardian_relationships enable row level security;
create policy guardian_relationships_select on app.guardian_relationships for select to edutex_app using (tenant_id = app.current_tenant_id() and app.authorized('families', 'view'));
create policy guardian_relationships_insert on app.guardian_relationships for insert to edutex_app with check (tenant_id = app.current_tenant_id() and app.authorized('families', 'manage'));
create policy guardian_relationships_update on app.guardian_relationships for update to edutex_app using (tenant_id = app.current_tenant_id() and app.authorized('families', 'manage')) with check (tenant_id = app.current_tenant_id() and app.authorized('families', 'manage'));
create policy guardian_relationships_delete on app.guardian_relationships for delete to edutex_app using (tenant_id = app.current_tenant_id() and app.authorized('families', 'manage'));
create trigger guardian_relationships_metadata before update on app.guardian_relationships for each row execute function app.set_updated_metadata();
create trigger guardian_relationships_audit after insert or update or delete on app.guardian_relationships for each row execute function audit.capture_row_change();
grant select, insert, update, delete on app.guardian_relationships to edutex_app;

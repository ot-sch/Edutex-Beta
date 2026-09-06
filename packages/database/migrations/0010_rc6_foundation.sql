-- RC6: repair null uniqueness, preserve audit privacy, add account preferences and workflow permissions.
-- Three exact RC5 SQL-function corrections are recognised by the migration compatibility map; 0012 repairs existing installations.
alter table app.students drop constraint students_tenant_id_barcode_key;
create unique index students_optional_barcode_unique on app.students(tenant_id,barcode) where barcode is not null;
alter table app.alumni_profiles drop constraint alumni_profiles_tenant_id_student_id_key;
create unique index alumni_optional_student_unique on app.alumni_profiles(tenant_id,student_id) where student_id is not null;
alter table app.users drop constraint users_tenant_id_username_key;
create unique index users_optional_username_unique on app.users (tenant_id, username) where username is not null;
alter table app.guardians drop constraint guardians_tenant_id_email_key;
create unique index guardians_optional_email_unique on app.guardians (tenant_id, email) where email is not null;

alter table app.tenant_modules drop constraint tenant_modules_module_key_check;
alter table app.tenant_modules add constraint tenant_modules_module_key_check check (module_key in (
  'dashboard','students','attendance','timetables','classes','activities','families','finance','forms',
  'staff','enrolments','communications','events','alumni','grades','photos','knowledge-base',
  'sign-in-out','import-export','audit','admin','management','insights','smart-alerts','risk','nurse',
  'wellbeing','maintenance','technician','parent-portal','student-portal'
));
insert into app.permissions (key,module,action,description,sensitivity)
select m||':'||a,m,a,initcap(replace(m,'-',' '))||': '||a,
  case when a in ('approve','manage','export','delete') then 'privileged' else 'standard' end
from unnest(array['management','insights','smart-alerts','risk','nurse','wellbeing','maintenance','technician','parent-portal','student-portal']) m
cross join unnest(array['view','create','edit','delete','export','approve','manage']) a
on conflict do nothing;
insert into app.permissions(key,module,action,description,sensitivity) values
 ('events:approve','events','approve','Approve event risk plans','privileged'),
 ('events:sensitive-view','events','sensitive-view','View medical records in an assigned event access window','sensitive'),
 ('nurse:sensitive-view','nurse','sensitive-view','View student medical records','sensitive'),
 ('nurse:sensitive-edit','nurse','sensitive-edit','Update student medical records','sensitive') on conflict do nothing;

insert into app.tenant_modules(tenant_id,module_key,display_order)
select t.id,m.name,m.ord from app.tenants t cross join (values
 ('management',220),('insights',230),('smart-alerts',240),('risk',250),('nurse',260),
 ('wellbeing',270),('maintenance',280),('technician',290),('parent-portal',300),('student-portal',310)
) m(name,ord) on conflict do nothing;

create table app.user_preferences (
 tenant_id uuid not null references app.tenants(id),
 user_id uuid not null,
 namespace text not null check(namespace in ('appearance','dashboard','record-columns')),
 preferences jsonb not null check(jsonb_typeof(preferences)='object' and octet_length(preferences::text)<=32768),
 updated_at timestamptz not null default clock_timestamp(),
 row_version bigint not null default 1,
 primary key(tenant_id,user_id,namespace),
 foreign key(tenant_id,user_id) references app.users(tenant_id,id) on delete cascade
);
alter table app.user_preferences enable row level security;
create policy user_preferences_owner on app.user_preferences for all to edutex_app
 using (tenant_id=app.current_tenant_id() and user_id=app.current_user_id())
 with check (tenant_id=app.current_tenant_id() and user_id=app.current_user_id());
create trigger user_preferences_metadata before update on app.user_preferences for each row execute function app.set_updated_metadata();
grant select,insert,update,delete on app.user_preferences to edutex_app;

-- Clinical text and financial/private payloads must not be duplicated into general audit snapshots.
create or replace function audit.redact_state(state_value jsonb) returns jsonb
language sql immutable parallel safe as $$
 select case when state_value is null then null else state_value
 - 'ciphertext' - 'encrypted_data_key' - 'token_hash' - 'client_secret_arn' - 'password' - 'refresh_token'
 - 'secure_note' - 'medical_envelope' - 'answers_envelope' - 'body' - 'reason' - 'feedback'
 - 'address_line_1' - 'address_line_2' - 'mobile_phone' - 'primary_phone' - 'email' - 'primary_email'
 - 'first_name' - 'last_name' - 'preferred_name' - 'date_of_birth' - 'phone' - 'notes'
 end
$$;

-- Existing management tables retain their original module grants; management roles gain explicit policies.
do $$ declare t text; begin
 foreach t in array array['campuses','academic_years','terms','timetable_periods','departments'] loop
  execute format('create policy %I on app.%I for all to edutex_app using (tenant_id=app.current_tenant_id() and app.authorized(''management'',''manage'')) with check (tenant_id=app.current_tenant_id() and app.authorized(''management'',''manage''))',t||'_management',t);
  execute format('create policy %I on app.%I for select to edutex_app using (tenant_id=app.current_tenant_id() and app.authorized(''management'',''view''))',t||'_management_view',t);
 end loop;
end $$;
create policy rooms_maintenance on app.rooms for all to edutex_app
 using(tenant_id=app.current_tenant_id() and app.authorized('maintenance','manage'))
 with check(tenant_id=app.current_tenant_id() and app.authorized('maintenance','manage'));
create policy rooms_maintenance_view on app.rooms for select to edutex_app
 using(tenant_id=app.current_tenant_id() and app.authorized('maintenance','view'));

-- Posted entries and their lines are immutable; corrections require a separate balanced reversal journal.
create or replace function app.reject_posted_journal_mutation() returns trigger language plpgsql as $$
begin
 if old.status in ('posted','reversed') then raise exception 'Posted journals are immutable; create a reversal entry' using errcode='55000'; end if;
 return coalesce(new,old);
end $$;
create or replace function app.reject_posted_line_mutation() returns trigger language plpgsql as $$
begin
 if exists(select 1 from app.journal_entries where tenant_id=coalesce(new.tenant_id,old.tenant_id)
 and id in (case when tg_op<>'DELETE' then new.journal_entry_id end,case when tg_op<>'INSERT' then old.journal_entry_id end)
 and status in ('posted','reversed')) then
  raise exception 'Posted journal lines are immutable' using errcode='55000';
 end if;
 return coalesce(new,old);
end $$;
create trigger journal_lines_immutable before insert or update or delete on app.journal_lines for each row execute function app.reject_posted_line_mutation();

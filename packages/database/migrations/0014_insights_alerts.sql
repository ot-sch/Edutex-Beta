-- RC6: personal/group dashboards, durable alert definitions and auditable delivery queues.
create table app.insight_dashboards (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references app.tenants(id),owner_user_id uuid not null default app.current_user_id(),
 share_group_id uuid,definition jsonb not null check(jsonb_typeof(definition)='object' and octet_length(definition::text)<=100000),
 created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),row_version bigint not null default 1,
 unique(tenant_id,id),foreign key(tenant_id,owner_user_id) references app.users(tenant_id,id),foreign key(tenant_id,share_group_id) references app.school_groups(tenant_id,id)
);
alter table app.insight_dashboards enable row level security;
create policy insight_dashboards_view on app.insight_dashboards for select to edutex_app using(tenant_id=app.current_tenant_id() and app.authorized('insights','view') and (owner_user_id=app.current_user_id() or app.user_in_group(share_group_id,app.current_user_id())));
create policy insight_dashboards_owner on app.insight_dashboards for all to edutex_app using(tenant_id=app.current_tenant_id() and owner_user_id=app.current_user_id() and app.authorized('insights','edit')) with check(tenant_id=app.current_tenant_id() and owner_user_id=app.current_user_id() and app.authorized('insights','edit'));
create policy insight_dashboards_create on app.insight_dashboards for insert to edutex_app with check(tenant_id=app.current_tenant_id() and owner_user_id=app.current_user_id() and app.authorized('insights','create'));
create trigger insight_dashboards_metadata before update on app.insight_dashboards for each row execute function app.set_updated_metadata();
create trigger insight_dashboards_audit after insert or update or delete on app.insight_dashboards for each row execute function audit.capture_row_change();
grant select,insert,update,delete on app.insight_dashboards to edutex_app;

create table app.smart_alert_rules (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references app.tenants(id),owner_user_id uuid not null default app.current_user_id(),
 share_group_id uuid,definition jsonb not null check(jsonb_typeof(definition)='object' and octet_length(definition::text)<=100000),
 last_evaluated_at timestamptz,last_error_code text,
 created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),row_version bigint not null default 1,
 unique(tenant_id,id),foreign key(tenant_id,owner_user_id) references app.users(tenant_id,id),foreign key(tenant_id,share_group_id) references app.school_groups(tenant_id,id)
);
alter table app.smart_alert_rules enable row level security;
create policy smart_alert_rules_view on app.smart_alert_rules for select to edutex_app using(tenant_id=app.current_tenant_id() and app.authorized('smart-alerts','view') and (owner_user_id=app.current_user_id() or app.user_in_group(share_group_id,app.current_user_id())));
create policy smart_alert_rules_owner on app.smart_alert_rules for all to edutex_app using(tenant_id=app.current_tenant_id() and owner_user_id=app.current_user_id() and app.authorized('smart-alerts','edit')) with check(tenant_id=app.current_tenant_id() and owner_user_id=app.current_user_id() and app.authorized('smart-alerts','edit'));
create policy smart_alert_rules_create on app.smart_alert_rules for insert to edutex_app with check(tenant_id=app.current_tenant_id() and owner_user_id=app.current_user_id() and app.authorized('smart-alerts','create'));
create trigger smart_alert_rules_metadata before update on app.smart_alert_rules for each row execute function app.set_updated_metadata();
create trigger smart_alert_rules_audit after insert or update or delete on app.smart_alert_rules for each row execute function audit.capture_row_change();
grant select,insert,update,delete on app.smart_alert_rules to edutex_app;

create table app.alert_deliveries (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references app.tenants(id),rule_id uuid not null,
 recipient_user_id uuid,student_id uuid,channel text not null check(channel in ('dashboard','email','sms')),
 dedupe_key text not null,title text not null,detail text not null,recipient_address text,
 status text not null default 'queued' check(status in ('queued','sent','failed','blocked','read')),
 attempt_count integer not null default 0,provider_reference text,last_error_code text,
 created_at timestamptz not null default clock_timestamp(),sent_at timestamptz,read_at timestamptz,
 unique(tenant_id,dedupe_key),foreign key(tenant_id,rule_id) references app.smart_alert_rules(tenant_id,id),
 foreign key(tenant_id,recipient_user_id) references app.users(tenant_id,id),foreign key(tenant_id,student_id) references app.students(tenant_id,id)
);
alter table app.alert_deliveries enable row level security;
create policy alert_deliveries_view on app.alert_deliveries for select to edutex_app using(tenant_id=app.current_tenant_id() and (recipient_user_id=app.current_user_id() or app.authorized('smart-alerts','manage')));
create policy alert_deliveries_insert on app.alert_deliveries for insert to edutex_app with check(tenant_id=app.current_tenant_id() and app.authorized('smart-alerts','edit'));
create policy alert_deliveries_update on app.alert_deliveries for update to edutex_app using(tenant_id=app.current_tenant_id() and (recipient_user_id=app.current_user_id() or app.authorized('smart-alerts','manage'))) with check(tenant_id=app.current_tenant_id());
grant select,insert,update on app.alert_deliveries to edutex_app;

-- Dates, session labels and school time zone are reference information for authenticated school users.
create policy academic_years_calendar on app.academic_years for select to edutex_app using(tenant_id=app.current_tenant_id() and app.current_user_id() is not null);
create policy terms_calendar on app.terms for select to edutex_app using(tenant_id=app.current_tenant_id() and app.current_user_id() is not null);
create policy campuses_reference on app.campuses for select to edutex_app using(tenant_id=app.current_tenant_id() and app.current_user_id() is not null);
create policy approval_streams_event_review on app.approval_streams for select to edutex_app using(tenant_id=app.current_tenant_id() and app.authorized('events','approve'));
create or replace function app.school_display_context() returns jsonb language sql stable security definer set search_path=pg_catalog,app as $$
 select jsonb_build_object('name',display_name,'timezone',default_timezone,'locale',default_locale)
 from app.tenants where id=app.current_tenant_id() and app.current_user_id() is not null
$$;
revoke all on function app.school_display_context() from public;
grant execute on function app.school_display_context() to edutex_app;

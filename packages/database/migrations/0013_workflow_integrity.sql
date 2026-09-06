-- RC6: actor attribution, immutable workflow history, clinical key policies and database-enforced transitions.
alter table app.invoices add column created_by uuid default app.current_user_id();
alter table app.invoices add foreign key(tenant_id,created_by) references app.users(tenant_id,id);
alter table app.payments add column created_by uuid default app.current_user_id();
alter table app.payments add foreign key(tenant_id,created_by) references app.users(tenant_id,id);
alter table app.payments alter column status set default 'pending';
alter table app.payroll_lines add column gross_amount numeric(18,2);
alter table app.supplier_bills add column payment_reference text;
alter table app.payroll_lines add column payment_reference text;
alter table app.bank_transactions add constraint bank_receipt_match_unique unique(tenant_id,payment_id);
alter table app.supplier_bills add constraint supplier_bill_reference_unique unique(tenant_id,supplier_id,reference);
alter table app.purchase_orders add constraint purchase_order_reference_unique unique(tenant_id,reference);

create table app.workflow_history (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references app.tenants(id),
 resource text not null,record_id uuid not null,action text not null,from_status text,to_status text,
 actor_user_id uuid not null,occurred_at timestamptz not null default clock_timestamp(),note text not null default '',
 unique(tenant_id,id),foreign key(tenant_id,actor_user_id) references app.users(tenant_id,id)
);
alter table app.workflow_history enable row level security;
create policy workflow_history_view on app.workflow_history for select to edutex_app
 using(tenant_id=app.current_tenant_id() and (app.authorized('finance','view') or app.authorized('events','view')));
create policy workflow_history_insert on app.workflow_history for insert to edutex_app
 with check(tenant_id=app.current_tenant_id() and actor_user_id=app.current_user_id() and
 (app.authorized('finance','edit') or app.authorized('finance','approve') or app.authorized('events','edit') or app.authorized('events','approve')));
grant select,insert on app.workflow_history to edutex_app;
revoke update,delete on app.workflow_history from edutex_app;
create trigger workflow_history_immutable before update or delete on app.workflow_history for each row execute function audit.reject_mutation();

create table app.event_approvals (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references app.tenants(id),
 event_plan_id uuid not null,stream_id uuid,approved_by uuid not null,
 approved_at timestamptz not null default clock_timestamp(),plan_version bigint not null,
 unique nulls not distinct(tenant_id,event_plan_id,stream_id),
 foreign key(tenant_id,event_plan_id) references app.event_plans(tenant_id,id),
 foreign key(tenant_id,stream_id) references app.approval_streams(tenant_id,id),
 foreign key(tenant_id,approved_by) references app.users(tenant_id,id)
);
alter table app.event_approvals enable row level security;
create policy event_approvals_read on app.event_approvals for select to edutex_app using(tenant_id=app.current_tenant_id() and app.authorized('events','view'));
create policy event_approvals_write on app.event_approvals for insert to edutex_app with check(tenant_id=app.current_tenant_id() and approved_by=app.current_user_id() and app.authorized('events','approve'));
create policy event_approvals_clear on app.event_approvals for delete to edutex_app using(tenant_id=app.current_tenant_id() and app.authorized('events','approve'));
grant select,insert,delete on app.event_approvals to edutex_app;

create or replace function app.guard_workflow_record() returns trigger language plpgsql as $$
declare module_name text:=case when tg_table_name='event_plans' then 'events' else 'finance' end;
begin
 if tg_op='INSERT' then
  if new.status not in ('draft','pending','unmatched') then raise exception 'Create a draft before advancing this workflow' using errcode='23514'; end if;
  return new;
 end if;
 if tg_op='DELETE' then
  if old.status not in ('draft','pending','unmatched','rejected') then raise exception 'Submitted financial and event records must be retained' using errcode='23514'; end if;
  return old;
 end if;
 if new.created_by is distinct from old.created_by then raise exception 'Record creator is immutable' using errcode='23514'; end if;
 if new.status is distinct from old.status then
  if new.status in ('approved','paid','settled','reconciled','issued','void') and not app.authorized(module_name,'approve') then
   raise exception 'Approval permission required' using errcode='42501';
  end if;
  if new.status in ('approved','paid','settled','reconciled') and old.created_by=app.current_user_id() then
   raise exception 'A different authorised person must approve this record' using errcode='42501';
  end if;
 else
  if old.status not in ('draft','rejected','unmatched','pending') then raise exception 'Return or reverse a submitted record before editing' using errcode='23514'; end if;
 end if;
 return new;
end $$;
do $$ declare t text;begin
 foreach t in array array['purchase_orders','supplier_bills','payroll_lines','event_plans','bank_transactions','payments','invoices'] loop
  execute format('create trigger %I before insert or update or delete on app.%I for each row execute function app.guard_workflow_record()',t||'_workflow_guard',t);
  -- Approval is distinct from CRUD editing, but the database still requires the dedicated grant.
  execute format('create policy %I on app.%I for update to edutex_app using(tenant_id=app.current_tenant_id() and app.authorized(%L,''approve'')) with check(tenant_id=app.current_tenant_id() and app.authorized(%L,''approve''))',t||'_approve',t,case when t='event_plans' then 'events' else 'finance' end,case when t='event_plans' then 'events' else 'finance' end);
 end loop;
end $$;
create policy tenant_encryption_keys_care on app.tenant_encryption_keys for select to edutex_app
 using(tenant_id=app.current_tenant_id() and (app.authorized('nurse','view') or app.authorized('wellbeing','view') or app.authorized('risk','view')));

-- Exact person/department sharing uses validated memberships, not a browser-supplied list of users.
create or replace function app.user_in_group(target_group uuid,target_user uuid) returns boolean
language sql stable security definer set search_path=pg_catalog,app as $$
 select exists(select 1 from app.group_members gm where gm.tenant_id=app.current_tenant_id()
 and gm.group_id=target_group and gm.user_id=target_user and gm.valid_from<=clock_timestamp()
 and (gm.valid_until is null or gm.valid_until>clock_timestamp()))
$$;
revoke all on function app.user_in_group(uuid,uuid) from public;
grant execute on function app.user_in_group(uuid,uuid) to edutex_app;

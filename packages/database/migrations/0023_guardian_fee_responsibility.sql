-- RC6: explicit guardian responsibility prevents separated households seeing one another's invoices.
create table app.invoice_allocations (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references app.tenants(id),
 invoice_id uuid not null,guardian_id uuid not null,student_id uuid not null,amount numeric(18,2) not null check(amount>0),
 created_by uuid not null default app.current_user_id(),created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),row_version bigint not null default 1,
 unique(tenant_id,id),unique(tenant_id,invoice_id,guardian_id,student_id),
 foreign key(tenant_id,invoice_id) references app.invoices(tenant_id,id),
 foreign key(tenant_id,guardian_id) references app.guardians(tenant_id,id),
 foreign key(tenant_id,student_id) references app.students(tenant_id,id),
 foreign key(tenant_id,created_by) references app.users(tenant_id,id)
);
alter table app.invoice_allocations enable row level security;
create policy invoice_allocations_select on app.invoice_allocations for select to edutex_app using(tenant_id=app.current_tenant_id() and app.authorized('finance','view')) ;
create policy invoice_allocations_insert on app.invoice_allocations for insert to edutex_app with check(tenant_id=app.current_tenant_id() and app.authorized('finance','create'));
create policy invoice_allocations_update on app.invoice_allocations for update to edutex_app using(tenant_id=app.current_tenant_id() and app.authorized('finance','edit')) with check(tenant_id=app.current_tenant_id() and app.authorized('finance','edit'));
create policy invoice_allocations_delete on app.invoice_allocations for delete to edutex_app using(tenant_id=app.current_tenant_id() and app.authorized('finance','delete')) ;
grant select,insert,update,delete on app.invoice_allocations to edutex_app;
create trigger invoice_allocations_metadata before update on app.invoice_allocations for each row execute function app.set_updated_metadata();
create trigger invoice_allocations_audit after insert or update or delete on app.invoice_allocations for each row execute function audit.capture_row_change();
alter table app.payments add column invoice_allocation_id uuid;
alter table app.payments add foreign key(tenant_id,invoice_allocation_id) references app.invoice_allocations(tenant_id,id);

create or replace function app.guard_invoice_allocation() returns trigger language plpgsql as $$
declare item record; state text;
begin
 if tg_op='DELETE' then item:=old; else item:=new; end if;
 if tg_op='UPDATE' and (new.invoice_id,new.guardian_id,new.student_id) is distinct from (old.invoice_id,old.guardian_id,old.student_id) then
  raise exception 'Create a new draft allocation to change its people or invoice' using errcode='23514'; end if;
 select status into state from app.invoices where tenant_id=item.tenant_id and id=item.invoice_id for update;
 if state is distinct from 'draft' then raise exception 'Fee responsibility is fixed once an invoice is issued' using errcode='23514'; end if;
 if tg_op<>'DELETE' and not exists(select 1 from app.guardian_relationships r join app.student_families sf on sf.tenant_id=r.tenant_id and sf.student_id=r.student_id join app.invoices i on i.tenant_id=sf.tenant_id and i.family_id=sf.family_id where r.tenant_id=item.tenant_id and r.guardian_id=item.guardian_id and r.student_id=item.student_id and i.id=item.invoice_id and r.can_view_finance and not r.restricted and current_date>=r.valid_from and (r.valid_until is null or r.valid_until>=current_date)) then
  raise exception 'Verify the guardian finance relationship and student family before allocating fees' using errcode='23514'; end if;
 return item;
end $$;
create trigger invoice_allocations_guard before insert or update or delete on app.invoice_allocations for each row execute function app.guard_invoice_allocation();

create or replace function app.validate_invoice_allocation_total() returns trigger language plpgsql as $$
declare n bigint; allocated numeric;
begin
 select count(*),coalesce(sum(amount),0) into n,allocated from app.invoice_allocations where tenant_id=new.tenant_id and invoice_id=new.id;
 if n>0 and allocated<>new.total then raise exception 'Guardian allocations must equal the complete invoice total before issue' using errcode='23514'; end if;
 return new;
end $$;
create trigger invoices_allocation_total before update of status on app.invoices for each row when(new.status='issued') execute function app.validate_invoice_allocation_total();

create or replace function app.validate_receipt_allocation() returns trigger language plpgsql as $$
declare allocation app.invoice_allocations%rowtype; received numeric;
begin
 if new.invoice_allocation_id is not null then
  select * into allocation from app.invoice_allocations where tenant_id=new.tenant_id and id=new.invoice_allocation_id for update;
  if not found or allocation.invoice_id is distinct from new.invoice_id then raise exception 'The receipt allocation must belong to its invoice' using errcode='23514'; end if;
  select coalesce(sum(amount),0) into received from app.payments where tenant_id=new.tenant_id and invoice_allocation_id=new.invoice_allocation_id and status='settled' and id<>new.id;
  if received+new.amount>allocation.amount then raise exception 'The receipt exceeds this guardian allocation balance' using errcode='23514'; end if;
 elsif exists(select 1 from app.invoice_allocations where tenant_id=new.tenant_id and invoice_id=new.invoice_id) then
  raise exception 'Select the responsible guardian allocation for this receipt' using errcode='23514';
 end if;
 return new;
end $$;
create trigger payments_allocation_check before update of status on app.payments for each row when(new.status='settled') execute function app.validate_receipt_allocation();

-- The parent API returns only this account's share and receipts, never a full household invoice.
drop policy invoices_parent on app.invoices;
create or replace function app.portal_allocated_fees(target_student uuid)
returns table(id uuid,invoice_number text,due_date date,total text,paid text,balance_due text,currency_code text,status text)
language sql stable security definer set search_path=pg_catalog,app as $$
 select a.id,i.invoice_number,i.due_date,a.amount::text,coalesce(p.received,0)::text,
  (a.amount-coalesce(p.received,0))::text,i.currency_code,
  case when coalesce(p.received,0)>=a.amount then 'paid' when coalesce(p.received,0)>0 then 'part_paid' else 'issued' end
 from app.invoice_allocations a join app.invoices i on i.tenant_id=a.tenant_id and i.id=a.invoice_id
 join app.guardians g on g.tenant_id=a.tenant_id and g.id=a.guardian_id
 left join lateral(select sum(amount) as received from app.payments where tenant_id=a.tenant_id and invoice_allocation_id=a.id and status='settled') p on true
 where a.tenant_id=app.current_tenant_id() and a.student_id=target_student and g.user_id=app.current_user_id()
 and app.parent_student_access(target_student,'finance') and i.status not in ('draft','void') order by i.due_date,i.invoice_number
$$;
revoke all on function app.portal_allocated_fees(uuid) from public;
grant execute on function app.portal_allocated_fees(uuid) to edutex_app;

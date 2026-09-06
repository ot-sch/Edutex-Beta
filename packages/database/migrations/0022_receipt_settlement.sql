-- RC6: receipt settlement controls invoice balances, including repeated partial payments.
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
 -- Invoice balances may change only to the exact total of already-settled receipts.
 if tg_table_name='invoices' and old.status in ('issued','part_paid','overdue') and new.status in ('part_paid','paid') then
  if not app.authorized('finance','approve') or
   (to_jsonb(new)-array['total','balance_due','status','updated_at','row_version']) is distinct from
   (to_jsonb(old)-array['total','balance_due','status','updated_at','row_version']) or
   new.balance_due<0 or new.balance_due>=old.balance_due or
   new.balance_due<>old.total-(select coalesce(sum(p.amount),0) from app.payments p where p.tenant_id=new.tenant_id and p.invoice_id=new.id and p.status='settled') or
   new.status<>(case when new.balance_due=0 then 'paid' else 'part_paid' end) then
   raise exception 'An invoice balance can change only through a verified settled receipt' using errcode='23514';
  end if;
  return new;
 end if;
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
create or replace function app.apply_invoice_receipt() returns trigger language plpgsql as $$
declare invoice app.invoices%rowtype;
begin
 if new.invoice_id is null then return new; end if;
 select * into invoice from app.invoices where tenant_id=new.tenant_id and id=new.invoice_id for update;
 if not found or invoice.status not in ('issued','part_paid','overdue') or invoice.currency_code<>new.currency_code or new.amount<=0 or new.amount>invoice.balance_due then
  raise exception 'A settled receipt requires an issued invoice, matching currency and sufficient balance' using errcode='23514';
 end if;
 update app.invoices set balance_due=balance_due-new.amount,
  status=case when balance_due=new.amount then 'paid' else 'part_paid' end
  where tenant_id=new.tenant_id and id=new.invoice_id;
 return new;
end $$;
create trigger payments_apply_invoice after update of status on app.payments
 for each row when(new.status='settled' and old.status is distinct from new.status)
 execute function app.apply_invoice_receipt();

-- RC6: generated finance journals are immutable, currency-labelled and idempotent by source transition.
alter table app.journal_entries add column currency_code text not null default 'AUD' check(currency_code ~ '^[A-Z]{3}$');
alter table app.journal_entries add column created_by uuid default app.current_user_id();
alter table app.journal_entries add constraint journal_creator_fk foreign key(tenant_id,created_by) references app.users(tenant_id,id);
create unique index rc6_journal_source on app.journal_entries(tenant_id,source_type,source_reference) where source_type in ('invoice.issue','invoice.void','receipt.settle','supplier.approve','supplier.pay','payroll.pay','bank.transfer');
create policy journal_entries_approval_insert on app.journal_entries for insert to edutex_app with check(tenant_id=app.current_tenant_id() and app.authorized('finance','approve'));
create policy journal_entries_approval_update on app.journal_entries for update to edutex_app using(tenant_id=app.current_tenant_id() and app.authorized('finance','approve')) with check(tenant_id=app.current_tenant_id() and app.authorized('finance','approve'));
create policy journal_lines_approval_insert on app.journal_lines for insert to edutex_app with check(tenant_id=app.current_tenant_id() and app.authorized('finance','approve'));
-- Matching remains one bill to a whole received PO; partial deliveries require separate purchase orders.
create unique index supplier_bill_matched_po on app.supplier_bills(tenant_id,purchase_order_id) where status in ('matched','approved','paid');
-- Cross-currency bank reconciliation is prohibited without a reviewed FX workflow.
create or replace function app.validate_bank_currency() returns trigger language plpgsql as $$
begin
 if new.payment_id is not null and not exists(select 1 from app.payments p join app.bank_accounts b on b.tenant_id=p.tenant_id where p.tenant_id=new.tenant_id and p.id=new.payment_id and b.id=new.bank_account_id and p.currency_code=b.currency_code) then raise exception 'Bank and receipt currencies must match' using errcode='23514'; end if;return new;
end $$;
create trigger bank_transactions_currency before insert or update on app.bank_transactions for each row execute function app.validate_bank_currency();

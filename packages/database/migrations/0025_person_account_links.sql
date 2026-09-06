-- RC6: account links are managed explicitly and cannot silently connect the wrong account category.
create unique index students_one_record_per_account on app.students(tenant_id,user_id) where user_id is not null;
create unique index staff_one_record_per_account on app.staff(tenant_id,user_id) where user_id is not null;
create or replace function app.validate_person_account() returns trigger language plpgsql as $$
declare category text;
begin
 if tg_op='UPDATE' and new.user_id is not distinct from old.user_id then return new; end if;
 if new.user_id is null then return new; end if;
 if not app.authorized(case when tg_table_name='guardians' then 'families' else tg_table_name end,'manage') then raise exception 'Managing a person account link requires module management' using errcode='42501'; end if;
 select u.category into category from app.users u where u.tenant_id=new.tenant_id and u.id=new.user_id and u.status='active';
 if category is null or (tg_table_name='students' and category<>'student') or (tg_table_name='guardians' and category<>'parent_guardian') or (tg_table_name='staff' and category in ('student','parent_guardian')) then raise exception 'Choose an active account with the matching student or staff category' using errcode='23514'; end if;
 return new;
end $$;
create trigger students_account_category before insert or update of user_id on app.students for each row execute function app.validate_person_account();
create trigger staff_account_category before insert or update of user_id on app.staff for each row execute function app.validate_person_account();

create unique index guardians_one_record_per_account on app.guardians(tenant_id,user_id) where user_id is not null;
create trigger guardians_account_category before insert or update of user_id on app.guardians for each row execute function app.validate_person_account();

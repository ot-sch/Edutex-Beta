-- RC6: disabled or recategorized community accounts immediately lose child and learning access at the data boundary.
create or replace function app.is_student_self(target_student uuid) returns boolean language sql stable security definer set search_path=pg_catalog,app as $$
 select app.current_actor_category()='student' and exists(select 1 from app.students where tenant_id=app.current_tenant_id() and id=target_student and user_id=app.current_user_id() and status='current')
$$;
create or replace function app.parent_student_access(target_student uuid,capability text default 'profile') returns boolean
language sql stable security definer set search_path=pg_catalog,app as $$
 select app.current_actor_category()='parent_guardian' and exists(select 1 from app.guardians g join app.guardian_relationships r on r.tenant_id=g.tenant_id and r.guardian_id=g.id
 where g.tenant_id=app.current_tenant_id() and g.user_id=app.current_user_id() and r.student_id=target_student
 and not r.restricted and r.valid_from<=current_date and (r.valid_until is null or r.valid_until>=current_date)
 and case capability when 'medical' then r.can_view_medical when 'consent' then r.can_consent when 'finance' then r.can_view_finance when 'communications' then r.receives_comms when 'profile' then true else false end)
$$;

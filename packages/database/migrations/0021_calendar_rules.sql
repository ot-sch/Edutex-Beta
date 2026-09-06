-- RC6: enforce term boundaries, session timing and calendar cancellations in the database.
create or replace function app.classes_cancelled(target_class uuid,target_date date) returns boolean language sql stable security definer set search_path=pg_catalog,app as $$
 select exists(select 1 from app.classes c join app.important_dates d on d.tenant_id=c.tenant_id where c.tenant_id=app.current_tenant_id() and c.id=target_class and target_date between d.starts_on and d.ends_on and (d.campus_id is null or d.campus_id=c.campus_id) and (d.action='no_classes' or (d.action='no_classes_for_years' and c.year_level=any(d.year_levels))))
$$;
revoke all on function app.classes_cancelled(uuid,date) from public;
grant execute on function app.classes_cancelled(uuid,date) to edutex_app;
create or replace function app.guard_cancelled_roll() returns trigger language plpgsql as $$
declare class_id uuid;school_date date;
begin
 if tg_table_name='attendance_sessions' then class_id:=new.class_id;school_date:=new.session_date;
 else select s.class_id,s.session_date into class_id,school_date from app.attendance_sessions s where s.tenant_id=new.tenant_id and s.id=new.attendance_session_id; end if;
 if class_id is not null and app.classes_cancelled(class_id,school_date) then raise exception 'Classes are cancelled for this date and year group' using errcode='23514';end if;return new;
end $$;
create trigger attendance_sessions_calendar before insert or update on app.attendance_sessions for each row execute function app.guard_cancelled_roll();
create trigger attendance_marks_calendar before insert or update on app.attendance_marks for each row execute function app.guard_cancelled_roll();
create or replace function app.guard_term_dates() returns trigger language plpgsql as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(new.tenant_id::text||new.academic_year_id::text,2091));
 if not exists(select 1 from app.academic_years y where y.tenant_id=new.tenant_id and y.id=new.academic_year_id and new.starts_on>=y.starts_on and new.ends_on<=y.ends_on) then raise exception 'Term dates must be within the academic year' using errcode='23514';end if;
 if exists(select 1 from app.terms t where t.tenant_id=new.tenant_id and t.academic_year_id=new.academic_year_id and t.id<>new.id and t.starts_on<=new.ends_on and t.ends_on>=new.starts_on) then raise exception 'School term dates must not overlap' using errcode='23514';end if;return new;
end $$;
create trigger terms_date_guard before insert or update on app.terms for each row execute function app.guard_term_dates();
create or replace function app.guard_session_times() returns trigger language plpgsql as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(new.tenant_id::text||new.timetable_set_id::text,2092));
 if exists(select 1 from app.timetable_periods p where p.tenant_id=new.tenant_id and p.timetable_set_id=new.timetable_set_id and p.weekday=new.weekday and p.id<>new.id and p.starts_at<new.ends_at and p.ends_at>new.starts_at) then raise exception 'Sessions within a timetable must not overlap' using errcode='23514';end if;return new;
end $$;
create trigger timetable_periods_time_guard before insert or update on app.timetable_periods for each row execute function app.guard_session_times();
-- Module-specific CRUD grants must behave consistently for existing management and facilities tables.
do $$ declare t text;begin
 foreach t in array array['campuses','academic_years','terms','timetable_periods','departments'] loop
  execute format('create policy %I on app.%I for insert to edutex_app with check(tenant_id=app.current_tenant_id() and app.authorized(''management'',''create''))',t||'_management_create',t);
  execute format('create policy %I on app.%I for update to edutex_app using(tenant_id=app.current_tenant_id() and app.authorized(''management'',''edit'')) with check(tenant_id=app.current_tenant_id() and app.authorized(''management'',''edit''))',t||'_management_edit',t);
 end loop;
end $$;
create policy rooms_maintenance_create on app.rooms for insert to edutex_app with check(tenant_id=app.current_tenant_id() and app.authorized('maintenance','create'));
create policy rooms_maintenance_edit on app.rooms for update to edutex_app using(tenant_id=app.current_tenant_id() and app.authorized('maintenance','edit')) with check(tenant_id=app.current_tenant_id() and app.authorized('maintenance','edit'));
create policy student_families_family_edit on app.student_families for all to edutex_app using(tenant_id=app.current_tenant_id() and app.authorized('families','manage')) with check(tenant_id=app.current_tenant_id() and app.authorized('families','manage'));
-- A reviewed plan's risk evidence cannot be changed underneath already-recorded approvals.
create or replace function app.guard_event_risk_evidence() returns trigger language plpgsql as $$
declare plan_id uuid;plan_status text;
begin
 plan_id:=case when tg_op='DELETE' then old.event_plan_id else new.event_plan_id end;
 if tg_op='UPDATE' and new.event_plan_id<>old.event_plan_id then raise exception 'Risk evidence cannot be moved between plans' using errcode='23514';end if;
 select status into plan_status from app.event_plans where tenant_id=app.current_tenant_id() and id=plan_id for update;
 if plan_status is null or plan_status not in ('draft','rejected') then raise exception 'Return the event plan for revision before changing its risk evidence' using errcode='23514';end if;
 if tg_op='DELETE' then return old; end if;return new;
end $$;
create trigger event_risks_review_guard before insert or update or delete on app.event_risks for each row execute function app.guard_event_risk_evidence();
-- Rule evaluation metadata must not invalidate an open definition editor or flood the human audit history.
create or replace function app.alert_definition_metadata() returns trigger language plpgsql as $$
begin
 if new.definition is distinct from old.definition or new.share_group_id is distinct from old.share_group_id then new.row_version:=old.row_version+1;new.updated_at:=clock_timestamp();else new.row_version:=old.row_version;new.updated_at:=old.updated_at;end if;return new;
end $$;
drop trigger smart_alert_rules_metadata on app.smart_alert_rules;
create trigger smart_alert_rules_metadata before update on app.smart_alert_rules for each row execute function app.alert_definition_metadata();
drop trigger smart_alert_rules_audit on app.smart_alert_rules;
create trigger smart_alert_rules_audit after update on app.smart_alert_rules for each row when(old.definition is distinct from new.definition or old.share_group_id is distinct from new.share_group_id) execute function audit.capture_row_change();
create trigger smart_alert_rules_create_audit after insert or delete on app.smart_alert_rules for each row execute function audit.capture_row_change();

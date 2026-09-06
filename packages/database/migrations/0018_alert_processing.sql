-- RC6: durable scheduled rule claims and delivery receipts. Network outcomes are recorded, never fabricated.
alter table app.smart_alert_rules add column last_scheduled_at timestamptz;
alter table app.alert_deliveries drop constraint alert_deliveries_status_check;
alter table app.alert_deliveries add constraint alert_deliveries_status_check check(status in ('queued','sending','sent','failed','blocked','read'));
create or replace function app.claim_due_alerts() returns table(id uuid,tenant_id uuid,owner_user_id uuid,definition jsonb)
language plpgsql security definer set search_path=pg_catalog,app as $$
begin
 return query with due as(select r.id from app.smart_alert_rules r join app.users u on u.tenant_id=r.tenant_id and u.id=r.owner_user_id join app.tenants t on t.id=r.tenant_id
 where r.definition->>'enabled'='true' and u.status='active' and t.status='active' and (r.last_scheduled_at is null or r.last_scheduled_at<clock_timestamp()-interval '5 minutes')
 order by r.last_scheduled_at nulls first,r.id limit 20 for update of r skip locked)
 update app.smart_alert_rules r set last_scheduled_at=clock_timestamp() from due where r.id=due.id returning r.id,r.tenant_id,r.owner_user_id,r.definition;
end $$;
create or replace function app.alert_recipient_users(action jsonb,target_student uuid) returns table(id uuid) language sql stable security definer set search_path=pg_catalog,app as $$
 select distinct u.id from app.users u where u.tenant_id=app.current_tenant_id() and u.status='active' and app.authorized('smart-alerts','edit') and (
 u.id::text in(select jsonb_array_elements_text(action->'userIds')) or exists(select 1 from app.group_members gm where gm.tenant_id=u.tenant_id and gm.group_id::text in(select jsonb_array_elements_text(action->'groupIds')) and
 (gm.user_id=u.id or exists(select 1 from app.staff s where s.tenant_id=u.tenant_id and s.id=gm.staff_id and s.user_id=u.id) or exists(select 1 from app.students s where s.tenant_id=u.tenant_id and s.id=gm.student_id and s.user_id=u.id))
 and gm.valid_from<=clock_timestamp() and (gm.valid_until is null or gm.valid_until>clock_timestamp()))
 or (action->>'includeParents'='true' and exists(select 1 from app.guardians g join app.guardian_relationships rel on rel.tenant_id=g.tenant_id and rel.guardian_id=g.id where g.tenant_id=u.tenant_id and g.user_id=u.id and rel.student_id=target_student and not rel.restricted and rel.receives_comms and rel.valid_from<=current_date and (rel.valid_until is null or rel.valid_until>=current_date)))) limit 501
$$;
create or replace function app.claim_alert_delivery() returns table(id uuid,tenant_id uuid,channel text,address text)
language plpgsql security definer set search_path=pg_catalog,app as $$
declare picked app.alert_deliveries;
begin
 -- A process interrupted after claiming has an unknown network outcome; require manual reconciliation.
 update app.alert_deliveries set status='blocked',last_error_code='DELIVERY_OUTCOME_UNKNOWN' where status='sending' and sent_at<clock_timestamp()-interval '10 minutes';
 select d.* into picked from app.alert_deliveries d join app.users u on u.tenant_id=d.tenant_id and u.id=d.recipient_user_id join app.tenants t on t.id=d.tenant_id
 where d.status='queued' and d.channel in ('email','sms') and u.status='active' and t.status='active' order by d.created_at,d.id limit 1 for update of d skip locked;
 if picked.id is null then return; end if;
 update app.alert_deliveries d set status='sending',sent_at=clock_timestamp(),attempt_count=d.attempt_count+1 where d.id=picked.id;
 return query select picked.id,picked.tenant_id,picked.channel,case when picked.channel='email' then u.email::text else (select g.mobile_phone from app.guardians g where g.tenant_id=u.tenant_id and g.user_id=u.id order by g.id limit 1) end from app.users u where u.tenant_id=picked.tenant_id and u.id=picked.recipient_user_id;
end $$;
create or replace function app.finish_alert_delivery(delivery_id uuid,outcome text,provider_id text,error_code text) returns void language plpgsql security definer set search_path=pg_catalog,app as $$
begin
 if outcome not in ('sent','failed','blocked') or length(coalesce(provider_id,''))>500 or length(coalesce(error_code,''))>100 then raise exception 'Invalid delivery receipt'; end if;
 update app.alert_deliveries set status=outcome,provider_reference=provider_id,last_error_code=error_code where id=delivery_id and status='sending';
end $$;
revoke all on function app.claim_due_alerts(),app.alert_recipient_users(jsonb,uuid),app.claim_alert_delivery(),app.finish_alert_delivery(uuid,text,text,text) from public;
grant execute on function app.claim_due_alerts(),app.alert_recipient_users(jsonb,uuid),app.claim_alert_delivery(),app.finish_alert_delivery(uuid,text,text,text) to edutex_app;
revoke all on function audit.append_event(uuid,uuid,text,text,text,text,jsonb,jsonb,jsonb) from public;
create or replace function app.record_alert_error(rule_id uuid,error_code text) returns void language sql security definer set search_path=pg_catalog,app as $$
 update app.smart_alert_rules set last_error_code=left(error_code,100) where id=rule_id
$$;
revoke all on function app.record_alert_error(uuid,text) from public;
grant execute on function app.record_alert_error(uuid,text) to edutex_app;

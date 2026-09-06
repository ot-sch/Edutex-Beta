-- RC6: technician functions allow only measured summaries and approved regional settings.
create or replace function app.technician_status() returns jsonb language plpgsql stable security definer set search_path=pg_catalog,app as $$
declare result jsonb;
begin
 if not app.authorized('technician','view') then raise exception 'Technician access required' using errcode='42501'; end if;
 select jsonb_build_object('school',app.school_display_context(),'settings',jsonb_build_object('timezone',default_timezone,'locale',default_locale,'rowVersion',row_version),'alerts',jsonb_build_object(
 'enabled',(select count(*) from app.smart_alert_rules where tenant_id=app.current_tenant_id() and definition->>'enabled'='true'),
 'queued',(select count(*) from app.alert_deliveries where tenant_id=app.current_tenant_id() and status='queued'),
 'failed',(select count(*) from app.alert_deliveries where tenant_id=app.current_tenant_id() and status in ('failed','blocked')))) into result from app.tenants where id=app.current_tenant_id();return result;
end $$;
create or replace function app.update_technical_region(zone text,locale text,version bigint) returns bigint language plpgsql security definer set search_path=pg_catalog,app as $$
declare new_version bigint;
begin
 if not app.authorized('technician','manage') then raise exception 'Technician management required' using errcode='42501'; end if;
 if not exists(select 1 from pg_timezone_names where name=zone) or locale !~ '^[a-zA-Z]{2,8}(-[a-zA-Z0-9]{2,8}){0,3}$' then raise exception 'Invalid regional setting' using errcode='22023'; end if;
 update app.tenants set default_timezone=zone,default_locale=locale where id=app.current_tenant_id() and row_version=version returning row_version into new_version;
 if new_version is null then raise exception 'Regional settings changed; reload before saving' using errcode='40001'; end if;
 perform audit.append_event(app.current_tenant_id(),app.current_user_id(),'technician.regional_settings','tenant',app.current_tenant_id()::text,'success',null,null,jsonb_build_object('timezone',zone,'locale',locale));return new_version;
end $$;
revoke all on function app.technician_status(),app.update_technical_region(text,text,bigint) from public;
grant execute on function app.technician_status(),app.update_technical_region(text,text,bigint) to edutex_app;

-- RC6: bounded exact-ID display labels preserve name-based record selection beyond the first search page.
create or replace function app.school_directory(kind text,search_text text,selected_ids uuid[]) returns table(id uuid,label text) language sql stable security definer set search_path=pg_catalog,app as $$
 select u.id,u.display_name from app.users u where kind='users' and u.tenant_id=app.current_tenant_id() and u.status='active' and ((cardinality(selected_ids)>0 and u.id=any(selected_ids)) or (cardinality(selected_ids)=0 and u.display_name ilike search_text))
 and exists(select 1 from app.users actor where actor.tenant_id=u.tenant_id and actor.id=app.current_user_id() and actor.category not in ('student','parent_guardian'))
 union all
 select g.id,g.first_name||' '||g.last_name from app.guardians g where kind='guardians' and g.tenant_id=app.current_tenant_id() and ((cardinality(selected_ids)>0 and g.id=any(selected_ids)) or (cardinality(selected_ids)=0 and (g.first_name||' '||g.last_name) ilike search_text)) and app.authorized('families','view')
 order by 2,1 limit 100
$$;
revoke all on function app.school_directory(text,text,uuid[]) from public;
grant execute on function app.school_directory(text,text,uuid[]) to edutex_app;

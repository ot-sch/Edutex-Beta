-- RC6: published internal staff forms are not automatically student forms.
alter table app.forms drop constraint forms_collection_mode_check;
alter table app.forms add constraint forms_collection_mode_check check(collection_mode in ('internal','parent_portal','student_portal','external_webhook','csv_import','any'));
drop policy forms_portal on app.forms;
create policy forms_portal on app.forms for select to edutex_app using(tenant_id=app.current_tenant_id() and status='published' and ((app.current_actor_category()='parent_guardian' and collection_mode in ('parent_portal','any')) or (app.current_actor_category()='student' and collection_mode in ('student_portal','any'))));

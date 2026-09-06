-- RC6: child-scoped encrypted medical records, publication-aware forms and explicit clinical access.
create or replace function app.medical_access(target_student uuid,writing boolean default false) returns boolean language sql stable security definer set search_path=pg_catalog,app as $$
 select exists(select 1 from app.students s where s.tenant_id=app.current_tenant_id() and s.id=target_student) and (
 app.authorized('nurse',case when writing then 'edit' else 'view' end) or app.authorized('students',case when writing then 'sensitive-edit' else 'sensitive-view' end)
 or app.parent_student_access(target_student,'medical') or (not writing and exists(
 select 1 from app.event_access a join app.events e on e.tenant_id=a.tenant_id and e.id=a.event_id
 join app.event_participants p on p.tenant_id=e.tenant_id and p.event_id=e.id
 where a.tenant_id=app.current_tenant_id() and a.user_id=app.current_user_id() and p.student_id=target_student
 and p.status in ('invited','accepted','attended') and e.status='published' and clock_timestamp()>=a.valid_from and clock_timestamp()<a.valid_until
 and (a.all_day or ((clock_timestamp() at time zone a.timezone)::time>=a.daily_from and (clock_timestamp() at time zone a.timezone)::time<a.daily_until)))))
$$;
revoke all on function app.medical_access(uuid,boolean) from public;
grant execute on function app.medical_access(uuid,boolean) to edutex_app;
create or replace function app.medical_encryption_key(target_student uuid,requested_key uuid) returns table(id uuid,kms_key_id text,encrypted_data_key bytea)
language sql stable security definer set search_path=pg_catalog,app as $$
 select k.id,k.kms_key_id,k.encrypted_data_key from app.tenant_encryption_keys k
 where k.tenant_id=app.current_tenant_id() and app.medical_access(target_student)
 and ((requested_key is null and k.status='active') or (k.id=requested_key and k.status<>'retired'))
 order by case when k.status='active' then 0 else 1 end,k.created_at desc limit 1
$$;
revoke all on function app.medical_encryption_key(uuid,uuid) from public;
grant execute on function app.medical_encryption_key(uuid,uuid) to edutex_app;
create table app.medical_records (
 tenant_id uuid not null references app.tenants(id),student_id uuid not null,envelope jsonb not null,
 updated_by uuid not null default app.current_user_id(),updated_at timestamptz not null default clock_timestamp(),row_version bigint not null default 1,
 primary key(tenant_id,student_id),foreign key(tenant_id,student_id) references app.students(tenant_id,id),foreign key(tenant_id,updated_by) references app.users(tenant_id,id),
 check(jsonb_typeof(envelope)='object' and envelope->>'algorithm'='AES-256-GCM' and octet_length(envelope::text)<=1048576)
);
alter table app.medical_records enable row level security;
create policy medical_records_read on app.medical_records for select to edutex_app using(tenant_id=app.current_tenant_id() and app.medical_access(student_id));
create policy medical_records_create on app.medical_records for insert to edutex_app with check(tenant_id=app.current_tenant_id() and app.medical_access(student_id,true) and updated_by=app.current_user_id());
create policy medical_records_edit on app.medical_records for update to edutex_app using(tenant_id=app.current_tenant_id() and app.medical_access(student_id,true)) with check(tenant_id=app.current_tenant_id() and app.medical_access(student_id,true) and updated_by=app.current_user_id());
create trigger medical_records_metadata before update on app.medical_records for each row execute function app.set_updated_metadata();
create trigger medical_records_audit after insert or update on app.medical_records for each row execute function audit.capture_row_change();
grant select,insert,update on app.medical_records to edutex_app;
create policy students_clinical_reference on app.students for select to edutex_app using(tenant_id=app.current_tenant_id() and app.medical_access(id));
-- No full sensitive clinical content enters the audit trail.
create or replace function audit.redact_state(state_value jsonb) returns jsonb language sql immutable set search_path=pg_catalog as $$
 select state_value - array['token_hash','client_secret_arn','refresh_token','medical_envelope','answers_envelope','address_line_1','address_line_2','primary_phone','email','primary_email','first_name','last_name','preferred_name','date_of_birth','phone','password','password_hash','secret','client_secret','encrypted_data_key','ciphertext','initialization_vector','envelope','secure_note','clinical_note','notes_encrypted','content','answer_text','answer_json','contact_email','postal_address','mobile_phone','reason','feedback','definition','body','notes','comment']::text[]
$$;

create policy communications_portal on app.communications for select to edutex_app using(tenant_id=app.current_tenant_id() and status='sent' and exists(select 1 from app.communication_recipients r where r.tenant_id=communications.tenant_id and r.communication_id=communications.id and r.user_id=app.current_user_id()));
create policy communication_recipients_self on app.communication_recipients for select to edutex_app using(tenant_id=app.current_tenant_id() and user_id=app.current_user_id());
create policy forms_portal on app.forms for select to edutex_app using(tenant_id=app.current_tenant_id() and status='published' and (collection_mode in ('parent_portal','any') or (collection_mode='internal' and exists(select 1 from app.users where tenant_id=app.current_tenant_id() and id=app.current_user_id() and category='student'))));
create policy form_submissions_portal on app.form_submissions for select to edutex_app using(tenant_id=app.current_tenant_id() and submitted_by=app.current_user_id());
create policy form_submissions_portal_create on app.form_submissions for insert to edutex_app with check(tenant_id=app.current_tenant_id() and submitted_by=app.current_user_id() and status='submitted' and (app.is_student_self(student_id) or app.parent_student_access(student_id,'consent')));
create policy form_answers_portal_create on app.form_answers for insert to edutex_app with check(tenant_id=app.current_tenant_id() and exists(select 1 from app.form_submissions where tenant_id=app.current_tenant_id() and id=submission_id and submitted_by=app.current_user_id()));
create policy form_answers_portal_read on app.form_answers for select to edutex_app using(tenant_id=app.current_tenant_id() and exists(select 1 from app.form_submissions where tenant_id=app.current_tenant_id() and id=submission_id and submitted_by=app.current_user_id()));
-- Lookups reveal only IDs and names, not authentication configuration or contact details.
create or replace function app.school_directory(kind text,search_text text) returns table(id uuid,label text) language sql stable security definer set search_path=pg_catalog,app as $$
 select u.id,u.display_name from app.users u where kind='users' and u.tenant_id=app.current_tenant_id() and u.status='active' and u.display_name ilike search_text
 and exists(select 1 from app.users actor where actor.tenant_id=u.tenant_id and actor.id=app.current_user_id() and actor.category not in ('student','parent_guardian'))
 union all
 select g.id,g.first_name||' '||g.last_name from app.guardians g where kind='guardians' and g.tenant_id=app.current_tenant_id() and (g.first_name||' '||g.last_name) ilike search_text and app.authorized('families','view')
 order by 2,1 limit 100
$$;
revoke all on function app.school_directory(text,text) from public;
grant execute on function app.school_directory(text,text) to edutex_app;
-- A fixed-purpose read logger prevents callers manufacturing arbitrary audit identities or event content.
create or replace function app.log_medical_read(target_student uuid) returns void language plpgsql security definer set search_path=pg_catalog,app,audit as $$
begin
 if not app.medical_access(target_student) then raise exception 'Medical access unavailable' using errcode='42501'; end if;
 perform audit.append_event(app.current_tenant_id(),app.current_user_id(),'medical.read','medical_records',target_student::text,'success',null,null,jsonb_build_object('studentId',target_student));
end $$;
revoke all on function app.log_medical_read(uuid) from public;
grant execute on function app.log_medical_read(uuid) to edutex_app;

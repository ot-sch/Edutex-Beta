-- RC6: explicit guardian/student relationships, own-account contact updates and publication-scoped learning data.
alter table app.guardians add column contact_email text;
alter table app.guardians add column postal_address text;
create or replace function app.is_student_self(target_student uuid) returns boolean language sql stable security definer set search_path=pg_catalog,app as $$
 select exists(select 1 from app.students where tenant_id=app.current_tenant_id() and id=target_student and user_id=app.current_user_id() and status='current')
$$;
create or replace function app.parent_student_access(target_student uuid,capability text default 'profile') returns boolean
language sql stable security definer set search_path=pg_catalog,app as $$
 select exists(select 1 from app.guardians g join app.guardian_relationships r on r.tenant_id=g.tenant_id and r.guardian_id=g.id
 where g.tenant_id=app.current_tenant_id() and g.user_id=app.current_user_id() and r.student_id=target_student
 and not r.restricted and r.valid_from<=current_date and (r.valid_until is null or r.valid_until>=current_date)
 and case capability when 'medical' then r.can_view_medical when 'consent' then r.can_consent when 'finance' then r.can_view_finance when 'communications' then r.receives_comms when 'profile' then true else false end)
$$;
create or replace function app.portal_class_access(target_class uuid) returns boolean language sql stable security definer set search_path=pg_catalog,app as $$
 select exists(select 1 from app.class_students cs where cs.tenant_id=app.current_tenant_id() and cs.class_id=target_class
 and cs.status='active' and cs.enrolled_from<=current_date and (cs.enrolled_until is null or cs.enrolled_until>=current_date)
 and (app.is_student_self(cs.student_id) or app.parent_student_access(cs.student_id)))
$$;
revoke all on function app.is_student_self(uuid),app.parent_student_access(uuid,text),app.portal_class_access(uuid) from public;
grant execute on function app.is_student_self(uuid),app.parent_student_access(uuid,text),app.portal_class_access(uuid) to edutex_app;
create policy students_portal on app.students for select to edutex_app using(tenant_id=app.current_tenant_id() and (app.is_student_self(id) or app.parent_student_access(id)));
create policy guardians_self on app.guardians for select to edutex_app using(tenant_id=app.current_tenant_id() and user_id=app.current_user_id());
create policy guardians_self_update on app.guardians for update to edutex_app using(tenant_id=app.current_tenant_id() and user_id=app.current_user_id()) with check(tenant_id=app.current_tenant_id() and user_id=app.current_user_id());
create policy class_students_portal on app.class_students for select to edutex_app using(tenant_id=app.current_tenant_id() and (app.is_student_self(student_id) or app.parent_student_access(student_id)));
create policy classes_portal on app.classes for select to edutex_app using(tenant_id=app.current_tenant_id() and app.portal_class_access(id));
create policy timetable_entries_portal on app.timetable_entries for select to edutex_app using(tenant_id=app.current_tenant_id() and app.portal_class_access(class_id));
create policy timetable_periods_reference on app.timetable_periods for select to edutex_app using(tenant_id=app.current_tenant_id() and app.current_user_id() is not null);
create policy rooms_portal_reference on app.rooms for select to edutex_app using(tenant_id=app.current_tenant_id() and app.current_user_id() is not null);
create policy grade_results_portal on app.grade_results for select to edutex_app using(tenant_id=app.current_tenant_id() and status='published' and (app.is_student_self(student_id) or app.parent_student_access(student_id)));
create policy assessments_portal on app.assessments for select to edutex_app using(tenant_id=app.current_tenant_id() and status in ('published','closed') and app.portal_class_access(class_id));
create policy assignments_student on app.assignments for select to edutex_app using(tenant_id=app.current_tenant_id() and status in ('published','closed') and app.portal_class_access(class_id));
create policy course_materials_student on app.course_materials for select to edutex_app using(tenant_id=app.current_tenant_id() and status='published' and app.portal_class_access(class_id));
create policy important_dates_portal on app.important_dates for select to edutex_app using(tenant_id=app.current_tenant_id() and audience in ('all','parents','students') and app.current_user_id() is not null);
create policy sign_in_out_parent_read on app.sign_in_out_requests for select to edutex_app using(tenant_id=app.current_tenant_id() and app.parent_student_access(student_id));
create policy sign_in_out_parent_create on app.sign_in_out_requests for insert to edutex_app with check(tenant_id=app.current_tenant_id() and status='submitted' and app.parent_student_access(student_id,'consent') and exists(select 1 from app.guardians where tenant_id=app.current_tenant_id() and id=requested_by_guardian_id and user_id=app.current_user_id()));
create policy events_parent on app.events for select to edutex_app using(tenant_id=app.current_tenant_id() and status='published' and exists(select 1 from app.event_participants p where p.tenant_id=app.current_tenant_id() and p.event_id=events.id and app.parent_student_access(p.student_id)));
create policy event_participants_parent on app.event_participants for select to edutex_app using(tenant_id=app.current_tenant_id() and app.parent_student_access(student_id));
create policy event_participants_parent_update on app.event_participants for update to edutex_app using(tenant_id=app.current_tenant_id() and app.parent_student_access(student_id,'consent')) with check(tenant_id=app.current_tenant_id() and app.parent_student_access(student_id,'consent'));
create policy invoices_parent on app.invoices for select to edutex_app using(tenant_id=app.current_tenant_id() and status not in ('draft','void') and exists(select 1 from app.student_families sf where sf.tenant_id=invoices.tenant_id and sf.family_id=invoices.family_id and app.parent_student_access(sf.student_id,'finance')));
create policy student_families_portal on app.student_families for select to edutex_app using(tenant_id=app.current_tenant_id() and (app.is_student_self(student_id) or app.parent_student_access(student_id)));

create table app.assignment_submissions (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references app.tenants(id),assignment_id uuid not null,student_id uuid not null,
 content text not null check(length(content) between 1 and 100000),submitted_at timestamptz not null default clock_timestamp(),row_version bigint not null default 1,
 unique(tenant_id,id),unique(tenant_id,assignment_id,student_id),foreign key(tenant_id,assignment_id) references app.assignments(tenant_id,id),foreign key(tenant_id,student_id) references app.students(tenant_id,id)
);
alter table app.assignment_submissions enable row level security;
create policy assignment_submissions_view on app.assignment_submissions for select to edutex_app using(tenant_id=app.current_tenant_id() and (app.is_student_self(student_id) or app.authorized('classes','view')));
create policy assignment_submissions_create on app.assignment_submissions for insert to edutex_app with check(tenant_id=app.current_tenant_id() and app.is_student_self(student_id));
create trigger assignment_submissions_audit after insert on app.assignment_submissions for each row execute function audit.capture_row_change();
grant select,insert on app.assignment_submissions to edutex_app;

create table app.consent_evidence (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references app.tenants(id),event_id uuid not null,student_id uuid not null,
 decision text not null check(decision in ('granted','declined','withdrawn')),source text not null check(source in ('parent_portal','paper')),
 recorded_by uuid not null default app.current_user_id(),guardian_id uuid,reference text,recorded_at timestamptz not null default clock_timestamp(),
 unique(tenant_id,id),foreign key(tenant_id,event_id) references app.events(tenant_id,id),foreign key(tenant_id,student_id) references app.students(tenant_id,id),foreign key(tenant_id,recorded_by) references app.users(tenant_id,id),foreign key(tenant_id,guardian_id) references app.guardians(tenant_id,id)
);
alter table app.consent_evidence enable row level security;
create policy consent_evidence_read on app.consent_evidence for select to edutex_app using(tenant_id=app.current_tenant_id() and (app.authorized('events','view') or app.parent_student_access(student_id,'consent')));
create policy consent_evidence_create on app.consent_evidence for insert to edutex_app with check(tenant_id=app.current_tenant_id() and recorded_by=app.current_user_id() and (app.authorized('events','edit') or (source='parent_portal' and app.parent_student_access(student_id,'consent'))));
create trigger consent_evidence_audit after insert on app.consent_evidence for each row execute function audit.capture_row_change();
create trigger consent_evidence_immutable before update or delete on app.consent_evidence for each row execute function audit.reject_mutation();
grant select,insert on app.consent_evidence to edutex_app;

create table app.portal_contacts (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references app.tenants(id),campus_id uuid,role text not null check(role in ('pastoral','duty_of_care','nurse','finance','support')),
 display_name text not null,email text,phone text,
 unique(tenant_id,id),foreign key(tenant_id,campus_id) references app.campuses(tenant_id,id)
);
alter table app.portal_contacts enable row level security;
create policy portal_contacts_read on app.portal_contacts for select to edutex_app using(tenant_id=app.current_tenant_id() and app.current_user_id() is not null);
create policy portal_contacts_manage on app.portal_contacts for all to edutex_app using(tenant_id=app.current_tenant_id() and app.authorized('management','manage')) with check(tenant_id=app.current_tenant_id() and app.authorized('management','manage'));
grant select,insert,update,delete on app.portal_contacts to edutex_app;

create policy timetable_sets_portal on app.timetable_sets for select to edutex_app using(tenant_id=app.current_tenant_id() and mode='published' and app.current_user_id() is not null);
create policy student_families_parent on app.student_families for select to edutex_app using(tenant_id=app.current_tenant_id() and app.parent_student_access(student_id,'finance'));

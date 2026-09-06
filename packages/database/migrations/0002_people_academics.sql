-- Edutex production schema - people, families, files and academic structures.

create table app.files (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  owner_user_id uuid,
  purpose text not null,
  storage_bucket text not null,
  storage_key text not null,
  original_filename text not null,
  media_type text not null,
  size_bytes bigint not null check (size_bytes between 0 and 52428800),
  sha256 bytea not null,
  scan_status text not null default 'pending'
    check (scan_status in ('pending', 'clean', 'rejected', 'quarantined')),
  encryption_key_arn text,
  uploaded_at timestamptz not null default clock_timestamp(),
  scanned_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  row_version bigint not null default 1,
  unique (tenant_id, id),
  unique (storage_bucket, storage_key),
  foreign key (tenant_id, owner_user_id)
    references app.users(tenant_id, id) on delete set null (owner_user_id)
);

alter table app.tenants
  add constraint tenants_logo_file_foreign_key
  foreign key (id, logo_file_id)
  references app.files(tenant_id, id)
  on delete set null (logo_file_id)
  deferrable initially deferred;

create table app.houses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  campus_id uuid not null,
  code citext not null,
  name text not null,
  colour text check (colour is null or colour ~ '^#[0-9a-fA-F]{6}$'),
  active boolean not null default true,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  row_version bigint not null default 1,
  unique (tenant_id, id),
  unique (tenant_id, campus_id, code),
  foreign key (tenant_id, campus_id)
    references app.campuses(tenant_id, id) on delete cascade
);

create table app.departments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  code citext not null,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  row_version bigint not null default 1,
  unique (tenant_id, id),
  unique (tenant_id, code)
);

create table app.families (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  family_number citext not null,
  display_name text not null,
  primary_email citext,
  primary_phone text,
  address_line_1 text,
  address_line_2 text,
  suburb text,
  state_region text,
  postal_code text,
  country_code char(2) not null default 'AU',
  status text not null default 'active' check (status in ('active', 'inactive', 'archived')),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  row_version bigint not null default 1,
  unique (tenant_id, id),
  unique (tenant_id, family_number)
);

create table app.guardians (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  user_id uuid,
  first_name text not null,
  last_name text not null,
  preferred_name text,
  email citext,
  mobile_phone text,
  work_phone text,
  occupation text,
  communication_language text not null default 'en',
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  row_version bigint not null default 1,
  unique (tenant_id, id),
  unique nulls not distinct (tenant_id, email),
  foreign key (tenant_id, user_id)
    references app.users(tenant_id, id) on delete set null (user_id)
);

create table app.family_guardians (
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  family_id uuid not null,
  guardian_id uuid not null,
  relationship_label text not null,
  is_primary_contact boolean not null default false,
  receives_correspondence boolean not null default true,
  receives_finance boolean not null default false,
  lives_with_students boolean not null default false,
  primary key (tenant_id, family_id, guardian_id),
  foreign key (tenant_id, family_id)
    references app.families(tenant_id, id) on delete cascade,
  foreign key (tenant_id, guardian_id)
    references app.guardians(tenant_id, id) on delete cascade
);

create table app.students (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  user_id uuid,
  campus_id uuid not null,
  house_id uuid,
  student_number citext not null,
  barcode citext,
  first_name text not null,
  preferred_name text,
  last_name text not null,
  legal_name text,
  email citext,
  date_of_birth date,
  gender_identity text,
  year_level text not null,
  status text not null default 'current'
    check (status in ('prospective', 'enrolled', 'current', 'leaver', 'alumni', 'archived')),
  photo_file_id uuid,
  commencement_date date,
  leaving_date date,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  row_version bigint not null default 1,
  unique (tenant_id, id),
  unique (tenant_id, student_number),
  unique nulls not distinct (tenant_id, barcode),
  foreign key (tenant_id, user_id)
    references app.users(tenant_id, id) on delete set null (user_id),
  foreign key (tenant_id, campus_id)
    references app.campuses(tenant_id, id),
  foreign key (tenant_id, house_id)
    references app.houses(tenant_id, id) on delete set null (house_id),
  foreign key (tenant_id, photo_file_id)
    references app.files(tenant_id, id) on delete set null (photo_file_id),
  check (leaving_date is null or commencement_date is null or leaving_date >= commencement_date)
);

create index students_directory_index
  on app.students (tenant_id, campus_id, status, year_level, last_name, first_name);

create table app.student_families (
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  student_id uuid not null,
  family_id uuid not null,
  is_primary_household boolean not null default false,
  sequence_number smallint not null default 1,
  primary key (tenant_id, student_id, family_id),
  foreign key (tenant_id, student_id)
    references app.students(tenant_id, id) on delete cascade,
  foreign key (tenant_id, family_id)
    references app.families(tenant_id, id) on delete cascade
);

create unique index student_families_one_primary
  on app.student_families (tenant_id, student_id)
  where is_primary_household;

create table app.student_tags (
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  student_id uuid not null,
  tag citext not null,
  assigned_at timestamptz not null default clock_timestamp(),
  assigned_by uuid,
  primary key (tenant_id, student_id, tag),
  foreign key (tenant_id, student_id)
    references app.students(tenant_id, id) on delete cascade,
  foreign key (tenant_id, assigned_by)
    references app.users(tenant_id, id) on delete set null (assigned_by)
);

create table app.student_sensitive_fields (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  student_id uuid not null,
  field_key text not null,
  encryption_key_id uuid not null,
  algorithm text not null default 'AES-256-GCM' check (algorithm = 'AES-256-GCM'),
  initialization_vector bytea not null check (octet_length(initialization_vector) = 12),
  ciphertext bytea not null check (octet_length(ciphertext) between 17 and 1048576),
  created_by uuid,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  row_version bigint not null default 1,
  unique (tenant_id, id),
  unique (tenant_id, student_id, field_key),
  foreign key (tenant_id, student_id)
    references app.students(tenant_id, id) on delete cascade,
  foreign key (tenant_id, encryption_key_id)
    references app.tenant_encryption_keys(tenant_id, id),
  foreign key (tenant_id, created_by)
    references app.users(tenant_id, id) on delete set null (created_by)
);

comment on table app.student_sensitive_fields is
  'Ciphertext produced in the authenticated browser. Plaintext is never persisted by the API.';

create table app.staff (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  user_id uuid,
  staff_number citext not null,
  first_name text not null,
  preferred_name text,
  last_name text not null,
  email citext not null,
  phone text,
  job_title text not null,
  employment_type text not null default 'ongoing'
    check (employment_type in ('ongoing', 'fixed_term', 'casual', 'contractor')),
  employment_status text not null default 'active'
    check (employment_status in ('active', 'leave', 'inactive', 'archived')),
  photo_file_id uuid,
  teaching_staff boolean not null default false,
  casual_relief boolean not null default false,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  row_version bigint not null default 1,
  unique (tenant_id, id),
  unique (tenant_id, staff_number),
  unique (tenant_id, email),
  foreign key (tenant_id, user_id)
    references app.users(tenant_id, id) on delete set null (user_id),
  foreign key (tenant_id, photo_file_id)
    references app.files(tenant_id, id) on delete set null (photo_file_id)
);

create table app.staff_campuses (
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  staff_id uuid not null,
  campus_id uuid not null,
  is_primary boolean not null default false,
  primary key (tenant_id, staff_id, campus_id),
  foreign key (tenant_id, staff_id)
    references app.staff(tenant_id, id) on delete cascade,
  foreign key (tenant_id, campus_id)
    references app.campuses(tenant_id, id) on delete cascade
);

create table app.staff_departments (
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  staff_id uuid not null,
  department_id uuid not null,
  is_head boolean not null default false,
  primary key (tenant_id, staff_id, department_id),
  foreign key (tenant_id, staff_id)
    references app.staff(tenant_id, id) on delete cascade,
  foreign key (tenant_id, department_id)
    references app.departments(tenant_id, id) on delete cascade
);

create table app.subjects (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  department_id uuid,
  code citext not null,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  row_version bigint not null default 1,
  unique (tenant_id, id),
  unique (tenant_id, code),
  foreign key (tenant_id, department_id)
    references app.departments(tenant_id, id) on delete set null (department_id)
);

create table app.rooms (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  campus_id uuid not null,
  code citext not null,
  name text not null,
  capacity integer check (capacity is null or capacity > 0),
  accessible boolean not null default true,
  active boolean not null default true,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  row_version bigint not null default 1,
  unique (tenant_id, id),
  unique (tenant_id, campus_id, code),
  foreign key (tenant_id, campus_id)
    references app.campuses(tenant_id, id) on delete cascade
);

create table app.timetable_sets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  campus_id uuid not null,
  academic_year_id uuid not null,
  name text not null,
  mode text not null default 'draft' check (mode in ('draft', 'published', 'archived')),
  published_at timestamptz,
  published_by uuid,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  row_version bigint not null default 1,
  unique (tenant_id, id),
  unique (tenant_id, campus_id, academic_year_id, name),
  foreign key (tenant_id, campus_id)
    references app.campuses(tenant_id, id),
  foreign key (tenant_id, academic_year_id)
    references app.academic_years(tenant_id, id),
  foreign key (tenant_id, published_by)
    references app.users(tenant_id, id) on delete set null (published_by)
);

create table app.timetable_periods (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  timetable_set_id uuid not null,
  weekday smallint not null check (weekday between 1 and 7),
  period_code citext not null,
  sequence_number smallint not null check (sequence_number >= 0),
  starts_at time not null,
  ends_at time not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  row_version bigint not null default 1,
  unique (tenant_id, id),
  unique (tenant_id, timetable_set_id, weekday, period_code),
  foreign key (tenant_id, timetable_set_id)
    references app.timetable_sets(tenant_id, id) on delete cascade,
  check (ends_at > starts_at)
);

create table app.classes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  campus_id uuid not null,
  academic_year_id uuid not null,
  timetable_set_id uuid,
  subject_id uuid,
  code citext not null,
  name text not null,
  year_level text,
  capacity integer check (capacity is null or capacity > 0),
  status text not null default 'active' check (status in ('planned', 'active', 'completed', 'archived')),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  row_version bigint not null default 1,
  unique (tenant_id, id),
  unique (tenant_id, academic_year_id, code),
  foreign key (tenant_id, campus_id)
    references app.campuses(tenant_id, id),
  foreign key (tenant_id, academic_year_id)
    references app.academic_years(tenant_id, id),
  foreign key (tenant_id, timetable_set_id)
    references app.timetable_sets(tenant_id, id) on delete set null (timetable_set_id),
  foreign key (tenant_id, subject_id)
    references app.subjects(tenant_id, id) on delete set null (subject_id)
);

create table app.class_staff (
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  class_id uuid not null,
  staff_id uuid not null,
  role text not null default 'teacher' check (role in ('teacher', 'assistant', 'coordinator')),
  primary key (tenant_id, class_id, staff_id, role),
  foreign key (tenant_id, class_id)
    references app.classes(tenant_id, id) on delete cascade,
  foreign key (tenant_id, staff_id)
    references app.staff(tenant_id, id) on delete cascade
);

create table app.class_students (
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  class_id uuid not null,
  student_id uuid not null,
  enrolled_from date not null default current_date,
  enrolled_until date,
  status text not null default 'active' check (status in ('active', 'withdrawn', 'completed')),
  primary key (tenant_id, class_id, student_id),
  foreign key (tenant_id, class_id)
    references app.classes(tenant_id, id) on delete cascade,
  foreign key (tenant_id, student_id)
    references app.students(tenant_id, id) on delete cascade,
  check (enrolled_until is null or enrolled_until >= enrolled_from)
);

create table app.activities (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  campus_id uuid not null,
  timetable_set_id uuid,
  code citext not null,
  name text not null,
  category text not null,
  coordinator_staff_id uuid,
  status text not null default 'active' check (status in ('planned', 'active', 'completed', 'archived')),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  row_version bigint not null default 1,
  unique (tenant_id, id),
  unique (tenant_id, code),
  foreign key (tenant_id, campus_id)
    references app.campuses(tenant_id, id),
  foreign key (tenant_id, timetable_set_id)
    references app.timetable_sets(tenant_id, id) on delete set null (timetable_set_id),
  foreign key (tenant_id, coordinator_staff_id)
    references app.staff(tenant_id, id) on delete set null (coordinator_staff_id)
);

create table app.activity_participants (
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  activity_id uuid not null,
  student_id uuid not null,
  status text not null default 'active' check (status in ('active', 'waitlisted', 'withdrawn')),
  joined_at timestamptz not null default clock_timestamp(),
  primary key (tenant_id, activity_id, student_id),
  foreign key (tenant_id, activity_id)
    references app.activities(tenant_id, id) on delete cascade,
  foreign key (tenant_id, student_id)
    references app.students(tenant_id, id) on delete cascade
);

create table app.timetable_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  timetable_set_id uuid not null,
  period_id uuid not null,
  room_id uuid,
  class_id uuid,
  activity_id uuid,
  supervising_staff_id uuid,
  starts_on date,
  ends_on date,
  recurrence_week text not null default 'all' check (recurrence_week in ('all', 'a', 'b')),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  row_version bigint not null default 1,
  unique (tenant_id, id),
  foreign key (tenant_id, timetable_set_id)
    references app.timetable_sets(tenant_id, id) on delete cascade,
  foreign key (tenant_id, period_id)
    references app.timetable_periods(tenant_id, id) on delete cascade,
  foreign key (tenant_id, room_id)
    references app.rooms(tenant_id, id) on delete set null (room_id),
  foreign key (tenant_id, class_id)
    references app.classes(tenant_id, id) on delete cascade,
  foreign key (tenant_id, activity_id)
    references app.activities(tenant_id, id) on delete cascade,
  foreign key (tenant_id, supervising_staff_id)
    references app.staff(tenant_id, id) on delete set null (supervising_staff_id),
  check ((class_id is not null)::integer + (activity_id is not null)::integer = 1),
  check (ends_on is null or starts_on is null or ends_on >= starts_on)
);

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'files', 'houses', 'departments', 'families', 'guardians', 'students',
    'student_sensitive_fields', 'staff', 'subjects', 'rooms', 'timetable_sets',
    'timetable_periods', 'classes', 'activities', 'timetable_entries'
  ]
  loop
    execute format(
      'create trigger %I before update on app.%I for each row execute function app.set_updated_metadata()',
      table_name || '_updated_metadata',
      table_name
    );
  end loop;
end
$$;

grant select, insert, update, delete on all tables in schema app to edutex_app;
grant usage, select on all sequences in schema app to edutex_app;

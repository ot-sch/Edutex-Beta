-- Edutex production schema - attendance, grades, finance, forms and operations.

create table app.attendance_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  campus_id uuid not null,
  session_date date not null,
  period_id uuid,
  class_id uuid,
  activity_id uuid,
  session_label text not null,
  status text not null default 'open' check (status in ('planned', 'open', 'submitted', 'reopened', 'archived')),
  opened_by uuid,
  opened_at timestamptz,
  submitted_by uuid,
  submitted_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  row_version bigint not null default 1,
  unique (tenant_id, id),
  foreign key (tenant_id, campus_id)
    references app.campuses(tenant_id, id),
  foreign key (tenant_id, period_id)
    references app.timetable_periods(tenant_id, id) on delete set null (period_id),
  foreign key (tenant_id, class_id)
    references app.classes(tenant_id, id) on delete cascade,
  foreign key (tenant_id, activity_id)
    references app.activities(tenant_id, id) on delete cascade,
  foreign key (tenant_id, opened_by)
    references app.users(tenant_id, id) on delete set null (opened_by),
  foreign key (tenant_id, submitted_by)
    references app.users(tenant_id, id) on delete set null (submitted_by),
  check ((class_id is not null)::integer + (activity_id is not null)::integer = 1)
);

create index attendance_sessions_lookup
  on app.attendance_sessions (tenant_id, campus_id, session_date, status);

create table app.attendance_marks (
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  attendance_session_id uuid not null,
  student_id uuid not null,
  status text not null check (status in ('present', 'absent', 'late', 'excused', 'unknown')),
  minutes_late integer check (minutes_late is null or minutes_late between 0 and 720),
  comment text not null default '',
  source text not null default 'teacher' check (source in ('teacher', 'office', 'import', 'automation')),
  marked_by uuid,
  marked_at timestamptz not null default clock_timestamp(),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  row_version bigint not null default 1,
  primary key (tenant_id, attendance_session_id, student_id),
  foreign key (tenant_id, attendance_session_id)
    references app.attendance_sessions(tenant_id, id) on delete cascade,
  foreign key (tenant_id, student_id)
    references app.students(tenant_id, id) on delete cascade,
  foreign key (tenant_id, marked_by)
    references app.users(tenant_id, id) on delete set null (marked_by),
  check ((status = 'late' and minutes_late is not null) or status <> 'late')
);

create index attendance_marks_student_history
  on app.attendance_marks (tenant_id, student_id, marked_at desc);

create table app.student_movements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  campus_id uuid not null,
  student_id uuid not null,
  movement_type text not null
    check (movement_type in ('sign_in', 'sign_out', 'temporary_exit', 'return')),
  occurred_at timestamptz not null,
  reason text not null,
  destination text,
  approved_guardian_id uuid,
  recorded_by uuid,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  row_version bigint not null default 1,
  unique (tenant_id, id),
  foreign key (tenant_id, campus_id)
    references app.campuses(tenant_id, id),
  foreign key (tenant_id, student_id)
    references app.students(tenant_id, id) on delete cascade,
  foreign key (tenant_id, approved_guardian_id)
    references app.guardians(tenant_id, id) on delete set null (approved_guardian_id),
  foreign key (tenant_id, recorded_by)
    references app.users(tenant_id, id) on delete set null (recorded_by)
);

create table app.attendance_alerts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  student_id uuid not null,
  alert_type text not null,
  severity text not null check (severity in ('information', 'warning', 'critical')),
  title text not null,
  detail text not null,
  triggered_at timestamptz not null default clock_timestamp(),
  acknowledged_by uuid,
  acknowledged_at timestamptz,
  resolution_note text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  row_version bigint not null default 1,
  unique (tenant_id, id),
  foreign key (tenant_id, student_id)
    references app.students(tenant_id, id) on delete cascade,
  foreign key (tenant_id, acknowledged_by)
    references app.users(tenant_id, id) on delete set null (acknowledged_by)
);

create table app.assessments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  class_id uuid not null,
  title text not null,
  description text not null default '',
  assessment_type text not null,
  maximum_score numeric(10, 3) not null check (maximum_score > 0),
  weight_percent numeric(6, 3) check (weight_percent is null or weight_percent between 0 and 100),
  due_at timestamptz,
  status text not null default 'draft' check (status in ('draft', 'published', 'closed', 'archived')),
  created_by uuid,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  row_version bigint not null default 1,
  unique (tenant_id, id),
  foreign key (tenant_id, class_id)
    references app.classes(tenant_id, id) on delete cascade,
  foreign key (tenant_id, created_by)
    references app.users(tenant_id, id) on delete set null (created_by)
);

create table app.grade_results (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  assessment_id uuid not null,
  student_id uuid not null,
  score numeric(10, 3),
  grade_code text,
  feedback text not null default '',
  status text not null default 'draft' check (status in ('draft', 'moderation', 'published', 'withheld')),
  marked_by uuid,
  marked_at timestamptz,
  published_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  row_version bigint not null default 1,
  unique (tenant_id, id),
  unique (tenant_id, assessment_id, student_id),
  foreign key (tenant_id, assessment_id)
    references app.assessments(tenant_id, id) on delete cascade,
  foreign key (tenant_id, student_id)
    references app.students(tenant_id, id) on delete cascade,
  foreign key (tenant_id, marked_by)
    references app.users(tenant_id, id) on delete set null (marked_by),
  check (score is null or score >= 0)
);

create table app.enrolment_applications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  campus_id uuid not null,
  application_number citext not null,
  applicant_first_name text not null,
  applicant_last_name text not null,
  date_of_birth date,
  requested_year_level text not null,
  requested_start_year integer not null check (requested_start_year between 2000 and 2200),
  primary_contact_name text not null,
  primary_contact_email citext not null,
  primary_contact_phone text,
  status text not null default 'draft'
    check (status in ('draft', 'submitted', 'review', 'waitlist', 'offer', 'accepted', 'declined', 'withdrawn')),
  assigned_to uuid,
  submitted_at timestamptz,
  decision_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  row_version bigint not null default 1,
  unique (tenant_id, id),
  unique (tenant_id, application_number),
  foreign key (tenant_id, campus_id)
    references app.campuses(tenant_id, id),
  foreign key (tenant_id, assigned_to)
    references app.users(tenant_id, id) on delete set null (assigned_to)
);

create table app.chart_of_accounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  parent_account_id uuid,
  account_code citext not null,
  name text not null,
  account_type text not null
    check (account_type in ('asset', 'liability', 'equity', 'revenue', 'expense')),
  normal_balance text not null check (normal_balance in ('debit', 'credit')),
  active boolean not null default true,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  row_version bigint not null default 1,
  unique (tenant_id, id),
  unique (tenant_id, account_code),
  foreign key (tenant_id, parent_account_id)
    references app.chart_of_accounts(tenant_id, id) on delete set null (parent_account_id)
);

create table app.journal_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  journal_number citext not null,
  journal_date date not null,
  description text not null,
  source_type text not null,
  source_reference text,
  status text not null default 'draft' check (status in ('draft', 'posted', 'reversed')),
  posted_by uuid,
  posted_at timestamptz,
  reversal_of_id uuid,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  row_version bigint not null default 1,
  unique (tenant_id, id),
  unique (tenant_id, journal_number),
  foreign key (tenant_id, posted_by)
    references app.users(tenant_id, id) on delete set null (posted_by),
  foreign key (tenant_id, reversal_of_id)
    references app.journal_entries(tenant_id, id) on delete restrict
);

create table app.journal_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  journal_entry_id uuid not null,
  account_id uuid not null,
  line_number integer not null check (line_number > 0),
  description text not null default '',
  debit_amount numeric(18, 2) not null default 0 check (debit_amount >= 0),
  credit_amount numeric(18, 2) not null default 0 check (credit_amount >= 0),
  campus_id uuid,
  department_id uuid,
  created_at timestamptz not null default clock_timestamp(),
  unique (tenant_id, id),
  unique (tenant_id, journal_entry_id, line_number),
  foreign key (tenant_id, journal_entry_id)
    references app.journal_entries(tenant_id, id) on delete cascade,
  foreign key (tenant_id, account_id)
    references app.chart_of_accounts(tenant_id, id),
  foreign key (tenant_id, campus_id)
    references app.campuses(tenant_id, id) on delete set null (campus_id),
  foreign key (tenant_id, department_id)
    references app.departments(tenant_id, id) on delete set null (department_id),
  check ((debit_amount > 0 and credit_amount = 0) or (credit_amount > 0 and debit_amount = 0))
);

create table app.invoices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  family_id uuid,
  invoice_number citext not null,
  issue_date date not null,
  due_date date not null,
  status text not null default 'draft'
    check (status in ('draft', 'issued', 'part_paid', 'paid', 'overdue', 'void')),
  currency_code char(3) not null default 'AUD',
  subtotal numeric(18, 2) not null default 0,
  tax_total numeric(18, 2) not null default 0,
  total numeric(18, 2) generated always as (subtotal + tax_total) stored,
  balance_due numeric(18, 2) not null default 0,
  notes text not null default '',
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  row_version bigint not null default 1,
  unique (tenant_id, id),
  unique (tenant_id, invoice_number),
  foreign key (tenant_id, family_id)
    references app.families(tenant_id, id) on delete set null (family_id),
  check (due_date >= issue_date),
  check (subtotal >= 0 and tax_total >= 0 and balance_due >= 0)
);

create table app.invoice_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  invoice_id uuid not null,
  line_number integer not null check (line_number > 0),
  description text not null,
  quantity numeric(12, 3) not null default 1 check (quantity > 0),
  unit_price numeric(18, 2) not null,
  tax_amount numeric(18, 2) not null default 0,
  account_id uuid not null,
  student_id uuid,
  created_at timestamptz not null default clock_timestamp(),
  unique (tenant_id, id),
  unique (tenant_id, invoice_id, line_number),
  foreign key (tenant_id, invoice_id)
    references app.invoices(tenant_id, id) on delete cascade,
  foreign key (tenant_id, account_id)
    references app.chart_of_accounts(tenant_id, id),
  foreign key (tenant_id, student_id)
    references app.students(tenant_id, id) on delete set null (student_id)
);

create table app.payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  invoice_id uuid,
  payment_reference citext not null,
  received_at timestamptz not null,
  amount numeric(18, 2) not null check (amount > 0),
  currency_code char(3) not null default 'AUD',
  method text not null,
  status text not null default 'settled' check (status in ('pending', 'settled', 'refunded', 'failed')),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  row_version bigint not null default 1,
  unique (tenant_id, id),
  unique (tenant_id, payment_reference),
  foreign key (tenant_id, invoice_id)
    references app.invoices(tenant_id, id) on delete set null (invoice_id)
);

create table app.budgets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  academic_year_id uuid not null,
  account_id uuid not null,
  campus_id uuid,
  department_id uuid,
  amount numeric(18, 2) not null,
  notes text not null default '',
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  row_version bigint not null default 1,
  unique (tenant_id, id),
  foreign key (tenant_id, academic_year_id)
    references app.academic_years(tenant_id, id),
  foreign key (tenant_id, account_id)
    references app.chart_of_accounts(tenant_id, id),
  foreign key (tenant_id, campus_id)
    references app.campuses(tenant_id, id) on delete set null (campus_id),
  foreign key (tenant_id, department_id)
    references app.departments(tenant_id, id) on delete set null (department_id)
);

create table app.forms (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  form_key citext not null,
  title text not null,
  description text not null default '',
  form_type text not null,
  collection_mode text not null
    check (collection_mode in ('internal', 'parent_portal', 'external_webhook', 'csv_import', 'any')),
  definition jsonb not null,
  status text not null default 'draft' check (status in ('draft', 'published', 'closed', 'archived')),
  published_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  row_version bigint not null default 1,
  unique (tenant_id, id),
  unique (tenant_id, form_key),
  foreign key (tenant_id, created_by)
    references app.users(tenant_id, id) on delete set null (created_by),
  check (jsonb_typeof(definition) = 'object'),
  check (octet_length(definition::text) <= 1048576)
);

create table app.form_submissions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  form_id uuid not null,
  student_id uuid,
  family_id uuid,
  submitted_by uuid,
  submitted_by_name text,
  source text not null check (source in ('internal', 'parent_portal', 'webhook', 'csv_import')),
  status text not null default 'submitted'
    check (status in ('submitted', 'under_review', 'approved', 'rejected', 'returned', 'actioned')),
  submitted_at timestamptz not null default clock_timestamp(),
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  row_version bigint not null default 1,
  unique (tenant_id, id),
  foreign key (tenant_id, form_id)
    references app.forms(tenant_id, id) on delete cascade,
  foreign key (tenant_id, student_id)
    references app.students(tenant_id, id) on delete set null (student_id),
  foreign key (tenant_id, family_id)
    references app.families(tenant_id, id) on delete set null (family_id),
  foreign key (tenant_id, submitted_by)
    references app.users(tenant_id, id) on delete set null (submitted_by),
  foreign key (tenant_id, reviewed_by)
    references app.users(tenant_id, id) on delete set null (reviewed_by)
);

create table app.form_answers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  submission_id uuid not null,
  question_key text not null,
  answer_text text,
  answer_number numeric,
  answer_boolean boolean,
  answer_date date,
  answer_json jsonb,
  created_at timestamptz not null default clock_timestamp(),
  unique (tenant_id, id),
  unique (tenant_id, submission_id, question_key),
  foreign key (tenant_id, submission_id)
    references app.form_submissions(tenant_id, id) on delete cascade,
  check (
    (answer_text is not null)::integer +
    (answer_number is not null)::integer +
    (answer_boolean is not null)::integer +
    (answer_date is not null)::integer +
    (answer_json is not null)::integer <= 1
  ),
  check (answer_json is null or octet_length(answer_json::text) <= 262144)
);

create table app.form_review_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  submission_id uuid not null,
  from_status text,
  to_status text not null,
  note text not null default '',
  acted_by uuid,
  acted_at timestamptz not null default clock_timestamp(),
  unique (tenant_id, id),
  foreign key (tenant_id, submission_id)
    references app.form_submissions(tenant_id, id) on delete cascade,
  foreign key (tenant_id, acted_by)
    references app.users(tenant_id, id) on delete set null (acted_by)
);

create table app.events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  campus_id uuid,
  title text not null,
  description text not null default '',
  location text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  capacity integer check (capacity is null or capacity > 0),
  consent_required boolean not null default false,
  child_safety_checklist jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('draft', 'published', 'cancelled', 'completed')),
  coordinator_user_id uuid,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  row_version bigint not null default 1,
  unique (tenant_id, id),
  foreign key (tenant_id, campus_id)
    references app.campuses(tenant_id, id) on delete set null (campus_id),
  foreign key (tenant_id, coordinator_user_id)
    references app.users(tenant_id, id) on delete set null (coordinator_user_id),
  check (ends_at > starts_at),
  check (jsonb_typeof(child_safety_checklist) = 'object'),
  check (octet_length(child_safety_checklist::text) <= 262144)
);

create table app.event_participants (
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  event_id uuid not null,
  student_id uuid not null,
  status text not null default 'invited' check (status in ('invited', 'accepted', 'declined', 'waitlisted', 'attended')),
  consent_status text not null default 'not_required'
    check (consent_status in ('not_required', 'pending', 'granted', 'declined', 'withdrawn')),
  consented_by_guardian_id uuid,
  consented_at timestamptz,
  primary key (tenant_id, event_id, student_id),
  foreign key (tenant_id, event_id)
    references app.events(tenant_id, id) on delete cascade,
  foreign key (tenant_id, student_id)
    references app.students(tenant_id, id) on delete cascade,
  foreign key (tenant_id, consented_by_guardian_id)
    references app.guardians(tenant_id, id) on delete set null (consented_by_guardian_id)
);

create table app.communication_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  template_key citext not null,
  name text not null,
  channel text not null check (channel in ('email', 'sms', 'push', 'portal')),
  subject_template text,
  body_template text not null,
  active boolean not null default true,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  row_version bigint not null default 1,
  unique (tenant_id, id),
  unique (tenant_id, template_key)
);

create table app.communications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  template_id uuid,
  channel text not null check (channel in ('email', 'sms', 'push', 'portal')),
  subject text,
  body text not null,
  status text not null default 'draft' check (status in ('draft', 'scheduled', 'sending', 'sent', 'cancelled', 'failed')),
  scheduled_at timestamptz,
  sent_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  row_version bigint not null default 1,
  unique (tenant_id, id),
  foreign key (tenant_id, template_id)
    references app.communication_templates(tenant_id, id) on delete set null (template_id),
  foreign key (tenant_id, created_by)
    references app.users(tenant_id, id) on delete set null (created_by)
);

create table app.communication_recipients (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  communication_id uuid not null,
  user_id uuid,
  address text not null,
  display_name text,
  delivery_status text not null default 'queued'
    check (delivery_status in ('queued', 'sent', 'delivered', 'bounced', 'failed', 'suppressed')),
  provider_message_id text,
  delivered_at timestamptz,
  error_code text,
  created_at timestamptz not null default clock_timestamp(),
  unique (tenant_id, id),
  foreign key (tenant_id, communication_id)
    references app.communications(tenant_id, id) on delete cascade,
  foreign key (tenant_id, user_id)
    references app.users(tenant_id, id) on delete set null (user_id)
);

create table app.communication_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  name text not null,
  event_type text not null,
  condition_definition jsonb not null,
  action_definition jsonb not null,
  active boolean not null default false,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  row_version bigint not null default 1,
  unique (tenant_id, id),
  check (jsonb_typeof(condition_definition) = 'object'),
  check (jsonb_typeof(action_definition) = 'object'),
  check (octet_length(condition_definition::text) <= 131072),
  check (octet_length(action_definition::text) <= 131072)
);

create table app.alumni_profiles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  student_id uuid,
  first_name text not null,
  last_name text not null,
  preferred_email citext,
  phone text,
  graduation_year integer check (graduation_year is null or graduation_year between 1900 and 2200),
  current_organisation text,
  current_position text,
  mentoring_available boolean not null default false,
  communication_consent boolean not null default false,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  row_version bigint not null default 1,
  unique (tenant_id, id),
  unique nulls not distinct (tenant_id, student_id),
  foreign key (tenant_id, student_id)
    references app.students(tenant_id, id) on delete set null (student_id)
);

create table app.alumni_engagements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  alumni_profile_id uuid not null,
  engagement_type text not null,
  occurred_at timestamptz not null,
  summary text not null,
  recorded_by uuid,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  row_version bigint not null default 1,
  unique (tenant_id, id),
  foreign key (tenant_id, alumni_profile_id)
    references app.alumni_profiles(tenant_id, id) on delete cascade,
  foreign key (tenant_id, recorded_by)
    references app.users(tenant_id, id) on delete set null (recorded_by)
);

create table app.alumni_mentorships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  mentor_alumni_id uuid not null,
  mentee_student_id uuid not null,
  starts_on date not null,
  ends_on date,
  status text not null default 'proposed' check (status in ('proposed', 'active', 'completed', 'cancelled')),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  row_version bigint not null default 1,
  unique (tenant_id, id),
  foreign key (tenant_id, mentor_alumni_id)
    references app.alumni_profiles(tenant_id, id) on delete cascade,
  foreign key (tenant_id, mentee_student_id)
    references app.students(tenant_id, id) on delete cascade,
  check (ends_on is null or ends_on >= starts_on)
);

create table app.knowledge_articles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  slug citext not null,
  title text not null,
  summary text not null default '',
  body_markdown text not null,
  audience text not null default 'staff' check (audience in ('staff', 'students', 'parents', 'all')),
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  author_user_id uuid,
  published_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  row_version bigint not null default 1,
  unique (tenant_id, id),
  unique (tenant_id, slug),
  foreign key (tenant_id, author_user_id)
    references app.users(tenant_id, id) on delete set null (author_user_id),
  check (octet_length(body_markdown) <= 2097152)
);

create table app.sign_in_out_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  campus_id uuid not null,
  student_id uuid not null,
  requested_by_guardian_id uuid,
  request_type text not null check (request_type in ('late_arrival', 'early_departure', 'absence')),
  requested_at timestamptz not null default clock_timestamp(),
  effective_at timestamptz not null,
  reason text not null,
  status text not null default 'submitted'
    check (status in ('submitted', 'approved', 'declined', 'completed', 'cancelled')),
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  row_version bigint not null default 1,
  unique (tenant_id, id),
  foreign key (tenant_id, campus_id)
    references app.campuses(tenant_id, id),
  foreign key (tenant_id, student_id)
    references app.students(tenant_id, id) on delete cascade,
  foreign key (tenant_id, requested_by_guardian_id)
    references app.guardians(tenant_id, id) on delete set null (requested_by_guardian_id),
  foreign key (tenant_id, reviewed_by)
    references app.users(tenant_id, id) on delete set null (reviewed_by)
);

create table app.module_layouts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references app.tenants(id) on delete cascade,
  module_key text not null,
  audience_role_id uuid,
  version_number integer not null default 1,
  status text not null default 'draft' check (status in ('draft', 'published', 'superseded')),
  layout_definition jsonb not null,
  published_by uuid,
  published_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  row_version bigint not null default 1,
  unique (tenant_id, id),
  unique (tenant_id, module_key, audience_role_id, version_number),
  foreign key (tenant_id, audience_role_id)
    references app.roles(tenant_id, id) on delete set null (audience_role_id),
  foreign key (tenant_id, published_by)
    references app.users(tenant_id, id) on delete set null (published_by),
  check (jsonb_typeof(layout_definition) = 'object'),
  check (octet_length(layout_definition::text) <= 524288)
);

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'attendance_sessions', 'attendance_marks', 'student_movements', 'attendance_alerts',
    'assessments', 'grade_results', 'enrolment_applications', 'chart_of_accounts',
    'journal_entries', 'invoices', 'payments', 'budgets', 'forms', 'form_submissions',
    'events', 'communication_templates', 'communications', 'communication_rules',
    'alumni_profiles', 'alumni_engagements', 'alumni_mentorships', 'knowledge_articles',
    'sign_in_out_requests', 'module_layouts'
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

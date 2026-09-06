/**
 * @fileoverview Implements the protected resource-config React feature, linking session-authorised UI state to same-origin Edutex API contracts.
 *
 * @remarks
 * Direct links: `@edutex/contracts`.
 * Security: Browser trust boundary; no database/AWS credentials or protected server decisions may enter this bundle.
 */

import { roadmapResources, type ResourceName } from '@edutex/contracts';

export interface ResourceFieldConfiguration {
  readonly key: string;
  readonly label: string;
  readonly type?:
    | 'text'
    | 'email'
    | 'number'
    | 'date'
    | 'datetime-local'
    | 'boolean'
    | 'textarea'
    | 'time'
    | 'select'
    | 'reference'
    | 'tags'
    | 'money'
    | 'encrypted'
    | 'colour';
  readonly reference?: string;
  readonly options?: readonly string[];
  readonly min?: number;
  readonly max?: number;
  readonly required?: boolean;
  readonly manageOnly?: boolean;
  readonly defaultValue?: unknown;
  readonly placeholder?: string;
}

export interface ResourcePageConfiguration {
  readonly resource: ResourceName;
  readonly title: string;
  readonly singular: string;
  readonly description: string;
  readonly columns: readonly (readonly [string, string])[];
  readonly permissionModule?: string;
  readonly workflow?: boolean;
  readonly adminOnly?: boolean;
  readonly createFields: readonly ResourceFieldConfiguration[];
}

const statusField = { key: 'status', label: 'Status', defaultValue: 'active' } as const;

/**
 * Maps UI routes to the API's audited resource allowlist. This configuration is
 * display metadata only; the API remains the authority for fields and access.
 */
export const resourcePageConfigurations: Record<string, ResourcePageConfiguration> = {
  students: {
    resource: 'students',
    title: 'Students',
    singular: 'student',
    description: 'A clear, current view of every learner and their school record.',
    columns: [
      ['studentNumber', 'Student ID'],
      ['firstName', 'First name'],
      ['lastName', 'Last name'],
      ['yearLevel', 'Year'],
      ['status', 'Status'],
    ],
    createFields: [
      {
        key: 'campusId',
        label: 'Campus ID',
        required: true,
        placeholder: 'UUID from school configuration',
      },
      { key: 'studentNumber', label: 'Student ID', required: true },
      {
        key: 'userId',
        label: 'Student sign-in account',
        type: 'reference',
        reference: 'users',
        manageOnly: true,
      },
      { key: 'genderIdentity', label: 'Gender value used by school filters' },
      { key: 'firstName', label: 'First name', required: true },
      { key: 'preferredName', label: 'Preferred name' },
      { key: 'lastName', label: 'Last name', required: true },
      { key: 'email', label: 'Email', type: 'email' },
      { key: 'dateOfBirth', label: 'Date of birth', type: 'date' },
      { key: 'yearLevel', label: 'Year level', required: true },
      { ...statusField, defaultValue: 'current' },
    ],
  },
  staff: {
    resource: 'staff',
    title: 'Staff',
    singular: 'staff member',
    description: 'People, roles and employment details in one trusted directory.',
    columns: [
      ['staffNumber', 'Staff ID'],
      ['firstName', 'First name'],
      ['lastName', 'Last name'],
      ['jobTitle', 'Role'],
      ['employmentStatus', 'Status'],
    ],
    createFields: [
      { key: 'staffNumber', label: 'Staff ID', required: true },
      {
        key: 'userId',
        label: 'Staff sign-in account',
        type: 'reference',
        reference: 'users',
        manageOnly: true,
      },
      { key: 'firstName', label: 'First name', required: true },
      { key: 'lastName', label: 'Last name', required: true },
      { key: 'email', label: 'Email', type: 'email', required: true },
      { key: 'jobTitle', label: 'Job title', required: true },
      { key: 'employmentType', label: 'Employment type', defaultValue: 'ongoing' },
      { key: 'employmentStatus', label: 'Employment status', defaultValue: 'active' },
      { key: 'teachingStaff', label: 'Teaching staff', type: 'boolean', defaultValue: false },
      { key: 'casualRelief', label: 'Casual relief', type: 'boolean', defaultValue: false },
    ],
  },
  families: {
    resource: 'families',
    title: 'Families',
    singular: 'family',
    description: 'Household contacts and communication details, kept connected.',
    columns: [
      ['familyNumber', 'Family ID'],
      ['displayName', 'Family'],
      ['primaryEmail', 'Email'],
      ['primaryPhone', 'Phone'],
      ['status', 'Status'],
    ],
    createFields: [
      { key: 'familyNumber', label: 'Family ID', required: true },
      { key: 'displayName', label: 'Display name', required: true },
      { key: 'primaryEmail', label: 'Primary email', type: 'email' },
      { key: 'primaryPhone', label: 'Primary phone' },
      { key: 'suburb', label: 'Suburb' },
      { key: 'stateRegion', label: 'State / region' },
      { key: 'postalCode', label: 'Postcode' },
      statusField,
    ],
  },
  classes: {
    resource: 'classes',
    title: 'Classes',
    singular: 'class',
    description: 'Teaching groups, subjects and capacity across the school.',
    columns: [
      ['code', 'Code'],
      ['name', 'Class'],
      ['yearLevel', 'Year'],
      ['capacity', 'Capacity'],
      ['status', 'Status'],
    ],
    createFields: [
      { key: 'campusId', label: 'Campus ID', required: true },
      { key: 'academicYearId', label: 'Academic year ID', required: true },
      { key: 'code', label: 'Class code', required: true },
      { key: 'name', label: 'Class name', required: true },
      { key: 'yearLevel', label: 'Year level' },
      { key: 'capacity', label: 'Capacity', type: 'number' },
      statusField,
    ],
  },
  activities: {
    resource: 'activities',
    title: 'Activities',
    singular: 'activity',
    description: 'Co-curricular programs, clubs and enrichment opportunities.',
    columns: [
      ['code', 'Code'],
      ['name', 'Activity'],
      ['category', 'Category'],
      ['status', 'Status'],
    ],
    createFields: [
      { key: 'campusId', label: 'Campus ID', required: true },
      { key: 'code', label: 'Code', required: true },
      { key: 'name', label: 'Name', required: true },
      { key: 'category', label: 'Category', required: true },
      statusField,
    ],
  },
  timetables: {
    resource: 'timetables',
    title: 'Timetables',
    singular: 'timetable',
    description: 'Published schedules and planning sets for every campus.',
    columns: [
      ['name', 'Timetable'],
      ['mode', 'Mode'],
      ['publishedAt', 'Published'],
    ],
    createFields: [
      { key: 'campusId', label: 'Campus ID', required: true },
      { key: 'academicYearId', label: 'Academic year ID', required: true },
      { key: 'name', label: 'Name', required: true },
      { key: 'mode', label: 'Mode', defaultValue: 'draft' },
    ],
  },
  enrolments: {
    resource: 'enrolments',
    title: 'Enrolments',
    singular: 'application',
    description: 'Follow each application from enquiry to accepted place.',
    columns: [
      ['applicationNumber', 'Application'],
      ['applicantFirstName', 'First name'],
      ['applicantLastName', 'Last name'],
      ['requestedYearLevel', 'Year'],
      ['status', 'Status'],
    ],
    createFields: [
      { key: 'campusId', label: 'Campus ID', required: true },
      { key: 'applicationNumber', label: 'Application number', required: true },
      { key: 'applicantFirstName', label: 'First name', required: true },
      { key: 'applicantLastName', label: 'Last name', required: true },
      { key: 'requestedYearLevel', label: 'Requested year', required: true },
      { key: 'requestedStartYear', label: 'Start year', type: 'number', required: true },
      { key: 'primaryContactName', label: 'Contact name', required: true },
      { key: 'primaryContactEmail', label: 'Contact email', type: 'email', required: true },
      { ...statusField, defaultValue: 'submitted' },
    ],
  },
  events: {
    resource: 'events',
    title: 'Events',
    singular: 'event',
    description: 'School events, capacity and consent at a glance.',
    columns: [
      ['title', 'Event'],
      ['location', 'Location'],
      ['startsAt', 'Starts'],
      ['endsAt', 'Ends'],
      ['status', 'Status'],
    ],
    createFields: [
      { key: 'title', label: 'Title', required: true },
      { key: 'description', label: 'Description', type: 'textarea', defaultValue: '' },
      { key: 'location', label: 'Location' },
      { key: 'startsAt', label: 'Starts', type: 'datetime-local', required: true },
      { key: 'endsAt', label: 'Ends', type: 'datetime-local', required: true },
      { key: 'capacity', label: 'Capacity', type: 'number' },
      { key: 'consentRequired', label: 'Consent required', type: 'boolean', defaultValue: false },
      { ...statusField, defaultValue: 'draft' },
    ],
  },
  forms: {
    resource: 'forms',
    title: 'Forms',
    singular: 'form',
    description: 'Build and publish structured school workflows without loose documents.',
    columns: [
      ['formKey', 'Key'],
      ['title', 'Form'],
      ['formType', 'Type'],
      ['collectionMode', 'Collection'],
      ['status', 'Status'],
    ],
    createFields: [
      { key: 'formKey', label: 'Form key', required: true },
      { key: 'title', label: 'Title', required: true },
      { key: 'description', label: 'Description', type: 'textarea', defaultValue: '' },
      { key: 'formType', label: 'Form type', required: true },
      {
        key: 'collectionMode',
        label: 'Form audience',
        type: 'select',
        options: [
          'internal',
          'parent_portal',
          'student_portal',
          'any',
          'external_webhook',
          'csv_import',
        ],
        required: true,
        defaultValue: 'internal',
      },
      {
        key: 'definition',
        label: 'Definition JSON',
        type: 'textarea',
        required: true,
        defaultValue: '{}',
      },
      { ...statusField, defaultValue: 'draft' },
    ],
  },
  communications: {
    resource: 'communications',
    title: 'Communications',
    singular: 'message',
    description: 'Plan clear, accountable communication across every channel.',
    columns: [
      ['channel', 'Channel'],
      ['subject', 'Subject'],
      ['status', 'Status'],
      ['scheduledAt', 'Scheduled'],
      ['sentAt', 'Sent'],
    ],
    createFields: [
      { key: 'channel', label: 'Channel', required: true, defaultValue: 'email' },
      { key: 'subject', label: 'Subject' },
      { key: 'body', label: 'Message', type: 'textarea', required: true },
      { ...statusField, defaultValue: 'draft' },
      { key: 'scheduledAt', label: 'Schedule for', type: 'datetime-local' },
    ],
  },
  alumni: {
    resource: 'alumni',
    title: 'Alumni',
    singular: 'alumni profile',
    description: 'Maintain lifelong school connections with clear consent.',
    columns: [
      ['firstName', 'First name'],
      ['lastName', 'Last name'],
      ['graduationYear', 'Graduated'],
      ['currentOrganisation', 'Organisation'],
      ['communicationConsent', 'Consent'],
    ],
    createFields: [
      { key: 'firstName', label: 'First name', required: true },
      { key: 'lastName', label: 'Last name', required: true },
      { key: 'preferredEmail', label: 'Email', type: 'email' },
      { key: 'graduationYear', label: 'Graduation year', type: 'number' },
      { key: 'currentOrganisation', label: 'Current organisation' },
      { key: 'currentRole', label: 'Current role' },
      {
        key: 'mentoringAvailable',
        label: 'Available to mentor',
        type: 'boolean',
        defaultValue: false,
      },
      {
        key: 'communicationConsent',
        label: 'Communication consent',
        type: 'boolean',
        defaultValue: false,
      },
    ],
  },
  grades: {
    resource: 'assessments',
    title: 'Grades & assessments',
    singular: 'assessment',
    description: 'Assessment plans, weighting and published learning outcomes.',
    columns: [
      ['title', 'Assessment'],
      ['assessmentType', 'Type'],
      ['maximumScore', 'Maximum'],
      ['weightPercent', 'Weight'],
      ['status', 'Status'],
    ],
    createFields: [
      { key: 'classId', label: 'Class ID', required: true },
      { key: 'title', label: 'Title', required: true },
      { key: 'description', label: 'Description', type: 'textarea', defaultValue: '' },
      { key: 'assessmentType', label: 'Type', required: true },
      { key: 'maximumScore', label: 'Maximum score', type: 'number', required: true },
      { key: 'weightPercent', label: 'Weight (%)', type: 'number' },
      { key: 'dueAt', label: 'Due', type: 'datetime-local' },
      { ...statusField, defaultValue: 'draft' },
    ],
  },
  finance: {
    resource: 'invoices',
    title: 'Finance',
    singular: 'invoice',
    description: 'Accurate invoices, balances and accountable financial operations.',
    columns: [
      ['invoiceNumber', 'Invoice'],
      ['issueDate', 'Issued'],
      ['dueDate', 'Due'],
      ['balanceDue', 'Balance'],
      ['status', 'Status'],
    ],
    createFields: [
      { key: 'invoiceNumber', label: 'Invoice number', required: true },
      { key: 'issueDate', label: 'Issue date', type: 'date', required: true },
      { key: 'dueDate', label: 'Due date', type: 'date', required: true },
      { key: 'currencyCode', label: 'Currency', defaultValue: 'AUD' },
      { key: 'subtotal', label: 'Subtotal', type: 'number', defaultValue: 0 },
      { key: 'taxTotal', label: 'Tax', type: 'number', defaultValue: 0 },
      { key: 'notes', label: 'Notes', type: 'textarea', defaultValue: '' },
    ],
  },
  'knowledge-base': {
    resource: 'knowledge-articles',
    title: 'Knowledge base',
    singular: 'article',
    description: 'Trusted procedures and guidance available where work happens.',
    columns: [
      ['title', 'Article'],
      ['summary', 'Summary'],
      ['audience', 'Audience'],
      ['status', 'Status'],
    ],
    createFields: [
      { key: 'slug', label: 'URL slug', required: true },
      { key: 'title', label: 'Title', required: true },
      { key: 'summary', label: 'Summary', type: 'textarea', defaultValue: '' },
      { key: 'bodyMarkdown', label: 'Content', type: 'textarea', required: true },
      { key: 'audience', label: 'Audience', defaultValue: 'staff' },
      { ...statusField, defaultValue: 'draft' },
    ],
  },
  'sign-in-out': {
    resource: 'sign-in-out-requests',
    title: 'Sign in / out',
    singular: 'movement request',
    description: 'Safe, visible student movement approvals throughout the day.',
    columns: [
      ['requestType', 'Request'],
      ['effectiveAt', 'Effective'],
      ['reason', 'Reason'],
      ['status', 'Status'],
    ],
    createFields: [
      { key: 'campusId', label: 'Campus ID', required: true },
      { key: 'studentId', label: 'Student ID', required: true },
      {
        key: 'requestType',
        label: 'Request type',
        required: true,
        defaultValue: 'early_departure',
      },
      { key: 'effectiveAt', label: 'Effective at', type: 'datetime-local', required: true },
      { key: 'reason', label: 'Reason', type: 'textarea', required: true },
      { ...statusField, defaultValue: 'submitted' },
    ],
  },
};

/** Adds roadmap tabs while preserving every RC5 resource configuration. */
for (const resource of roadmapResources) {
  resourcePageConfigurations[resource.name] = {
    resource: resource.name as ResourceName,
    title: resource.title,
    singular: resource.singular,
    description: `Manage ${resource.title.toLowerCase()} with a shared, current school record.`,
    permissionModule: resource.module,
    ...(resource.workflow ? { workflow: true } : {}),
    ...(resource.adminOnly ? { adminOnly: true } : {}),
    columns: resource.fields
      .filter(
        /** Keeps encrypted and long narrative fields in the full record view. */ (field) =>
          !['encrypted', 'textarea'].includes(field.type),
      )
      .slice(0, 6)
      .map(/** Produces readable table headings. */ (field) => [field.key, field.label] as const),
    createFields: resource.fields
      .filter(
        /** Workflow status can only change through its action endpoint. */ (field) =>
          !(resource.workflow && field.key === 'status'),
      )
      .map(
        /** Carries shared validation metadata into semantic inputs. */ (field) =>
          ({
            ...field,
            type: field.type as ResourceFieldConfiguration['type'],
          }) as ResourceFieldConfiguration,
      ),
  };
}
const referenceTypes: Readonly<Record<string, string>> = {
  campusId: 'campuses',
  academicYearId: 'academic-years',
  classId: 'classes',
  studentId: 'students',
  familyId: 'families',
  staffId: 'staff',
  houseId: 'houses',
  accountId: 'finance-accounts',
  subjectId: 'subjects',
  timetableSetId: 'timetables',
};
for (const [key, config] of Object.entries(resourcePageConfigurations)) {
  resourcePageConfigurations[key] = {
    ...config,
    createFields: config.createFields.map(
      /** Turns existing technical relationship fields into label searches. */ (field) =>
        referenceTypes[field.key]
          ? {
              ...field,
              type: 'reference',
              reference: requiredValue(referenceTypes[field.key]),
              label: field.label.replace(/ ID$/, ''),
            }
          : field,
    ),
  };
}

import { requiredValue } from '@edutex/contracts';

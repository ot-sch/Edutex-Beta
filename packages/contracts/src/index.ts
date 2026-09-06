/**
 * @fileoverview Defines the shared runtime-validated Zod contracts and TypeScript types used on both sides of Edutex API boundaries.
 *
 * @remarks
 * Direct links: `zod`.
 * Security: Maintained source boundary; changes require strict type, test, lint, format and security review.
 */

import { z } from 'zod';
import { roadmapResourceNames } from './roadmap.js';
export * from './roadmap.js';
export * from './workflow-rules.js';
export * from './insights.js';

/** Stable permission actions used by the API and administration interface. */
export const permissionActionSchema = z.enum([
  'view',
  'create',
  'edit',
  'delete',
  'export',
  'approve',
  'manage',
  'sensitive-view',
  'sensitive-edit',
]);
export type PermissionAction = z.infer<typeof permissionActionSchema>;

/** Domain modules retained from the prototype and expanded production portals. */
export const moduleIdSchema = z.enum([
  'dashboard',
  'students',
  'attendance',
  'timetables',
  'classes',
  'activities',
  'families',
  'finance',
  'forms',
  'staff',
  'enrolments',
  'communications',
  'events',
  'alumni',
  'grades',
  'photos',
  'knowledge-base',
  'sign-in-out',
  'import-export',
  'audit',
  'admin',
  'management',
  'insights',
  'smart-alerts',
  'risk',
  'nurse',
  'wellbeing',
  'maintenance',
  'technician',
  'parent-portal',
  'student-portal',
]);
export type ModuleId = z.infer<typeof moduleIdSchema>;

/**
 * A permission is intentionally represented as a compact, immutable string.
 * The API expands role assignments into this set at session creation and still
 * rechecks account status on every request.
 */
export const permissionSchema = z
  .string()
  .regex(
    /^[a-z][a-z0-9-]*:(view|create|edit|delete|export|approve|manage|sensitive-view|sensitive-edit)$/,
  );
export type Permission = z.infer<typeof permissionSchema>;

export const userCategorySchema = z.enum([
  'student',
  'teacher',
  'corporate_staff',
  'it_staff',
  'executive_staff',
  'parent_guardian',
  'contractor',
]);
export type UserCategory = z.infer<typeof userCategorySchema>;

export const sessionUserSchema = z.object({
  id: z.uuid(),
  tenantId: z.uuid(),
  displayName: z.string().min(1).max(160),
  email: z.email(),
  category: userCategorySchema,
  campusIds: z.array(z.uuid()),
  roleNames: z.array(z.string().min(1).max(100)),
  permissions: z.array(permissionSchema),
  enabledModules: z.array(moduleIdSchema),
  authenticationMethods: z.array(z.string().min(1).max(80)),
  mfaSatisfiedAt: z.iso.datetime().nullable(),
});
export type SessionUser = z.infer<typeof sessionUserSchema>;

export const sessionResponseSchema = z.object({
  user: sessionUserSchema,
  csrfToken: z.string().min(32).max(256),
  expiresAt: z.iso.datetime(),
});
export type SessionResponse = z.infer<typeof sessionResponseSchema>;

export const authenticationMethodSchema = z.enum([
  'password',
  'passkey',
  'microsoft',
  'google',
  'saml',
]);
export type AuthenticationMethod = z.infer<typeof authenticationMethodSchema>;

export const authenticationProviderSchema = z.object({
  id: z.uuid(),
  type: z.enum(['microsoft', 'google', 'oidc', 'saml']),
  key: z.string().regex(/^[a-z][a-z0-9-]{1,62}$/),
  displayName: z.string().min(1).max(80),
  buttonLabel: z.string().min(1).max(80),
  enabled: z.boolean(),
});
export type AuthenticationProvider = z.infer<typeof authenticationProviderSchema>;

/** Public tenant branding and sign-in choices. Contains no IdP or AWS secrets. */
export const publicTenantConfigurationSchema = z.object({
  tenantId: z.uuid(),
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/),
  name: z.string().min(1).max(160),
  logoUrl: z.string().startsWith('/'),
  primaryColour: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  supportUrl: z.url().optional(),
  enabledMethods: z.array(authenticationMethodSchema),
  providers: z.array(authenticationProviderSchema),
  maintenanceMessage: z.string().max(500).nullable(),
});
export type PublicTenantConfiguration = z.infer<typeof publicTenantConfigurationSchema>;

export const resourceNameSchema = z.enum([
  ...roadmapResourceNames,
  'students',
  'staff',
  'families',
  'classes',
  'activities',
  'timetables',
  'attendance-sessions',
  'enrolments',
  'events',
  'forms',
  'communications',
  'alumni',
  'assessments',
  'finance-accounts',
  'invoices',
  'knowledge-articles',
  'sign-in-out-requests',
]);
export type ResourceName = z.infer<typeof resourceNameSchema>;

export const listQuerySchema = z.object({
  search: z.string().trim().max(200).default(''),
  status: z
    .string()
    .regex(/^[a-z][a-z0-9_]{0,40}$/)
    .optional(),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  sort: z
    .string()
    .regex(/^[a-z][a-zA-Z0-9_]*$/)
    .optional(),
  direction: z.enum(['asc', 'desc']).default('asc'),
});
export type ListQuery = z.infer<typeof listQuerySchema>;

export const resourceRecordSchema = z.object({
  id: z.uuid(),
  rowVersion: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  fields: z.record(z.string(), z.unknown()),
});
export type ResourceRecord = z.infer<typeof resourceRecordSchema>;

export const resourceListResponseSchema = z.object({
  items: z.array(resourceRecordSchema),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  total: z.number().int().nonnegative(),
});
export type ResourceListResponse = z.infer<typeof resourceListResponseSchema>;

export const resourceMutationSchema = z.object({
  id: z.uuid().optional(),
  fields: z.record(z.string(), z.unknown()),
  rowVersion: z.number().int().nonnegative().optional(),
});
export type ResourceMutation = z.infer<typeof resourceMutationSchema>;

export const encryptedFieldEnvelopeSchema = z.object({
  version: z.literal(1),
  keyId: z.uuid(),
  algorithm: z.literal('AES-256-GCM'),
  iv: z.base64(),
  ciphertext: z.base64(),
});
export type EncryptedFieldEnvelope = z.infer<typeof encryptedFieldEnvelopeSchema>;

export const wrappedDataKeyRequestSchema = z.object({
  clientPublicKey: z.base64(),
  keyId: z.uuid().optional(),
});
export type WrappedDataKeyRequest = z.infer<typeof wrappedDataKeyRequestSchema>;

export const wrappedDataKeyResponseSchema = z.object({
  keyId: z.uuid(),
  serverPublicKey: z.base64(),
  salt: z.base64(),
  iv: z.base64(),
  wrappedKey: z.base64(),
  expiresAt: z.iso.datetime(),
});
export type WrappedDataKeyResponse = z.infer<typeof wrappedDataKeyResponseSchema>;

export const apiErrorSchema = z.object({
  statusCode: z.number().int().min(400).max(599),
  code: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
  message: z.string().min(1).max(500),
  requestId: z.string().min(1).max(100),
  details: z.record(z.string(), z.unknown()).optional(),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

export const healthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  service: z.literal('edutex-api'),
  version: z.string().min(1),
  time: z.iso.datetime(),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;
export { requiredValue, scalarText, errorMessage, stringValues } from './values.js';

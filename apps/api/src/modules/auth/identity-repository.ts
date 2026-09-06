/**
 * @fileoverview Implements the authentication/session boundary that connects Cognito OAuth, tenant identity resolution, opaque server-side sessions and protected Fastify requests.
 *
 * @remarks
 * Direct links: `@edutex/contracts`, `@edutex/database`, `zod`.
 * Security: Authentication/session security boundary; changes require negative tests for replay, binding, MFA and unauthenticated access.
 */

import {
  moduleIdSchema,
  publicTenantConfigurationSchema,
  sessionUserSchema,
  type PublicTenantConfiguration,
} from '@edutex/contracts';
import { runInSystemTransaction } from '@edutex/database';
import { z } from 'zod';

const authRuntimeSchema = z.object({
  tenantId: z.uuid(),
  tenantSlug: z.string().min(1),
  cognitoUserPoolId: z.string().min(1),
  cognitoClientId: z.string().min(1),
  cognitoDomain: z.string().min(1),
  sessionIdleMinutes: z.number().int().min(5).max(240),
  sessionAbsoluteHours: z.number().int().min(1).max(72),
  stepUpMinutes: z.number().int().min(1).max(60),
  passwordEnabled: z.boolean(),
  passkeyEnabled: z.boolean(),
  totpMode: z.enum(['disabled', 'optional', 'required_for_password']),
  providers: z.record(z.string(), z.string()),
});
export type AuthRuntime = z.infer<typeof authRuntimeSchema>;

const databaseIdentitySchema = sessionUserSchema
  .omit({
    authenticationMethods: true,
    mfaSatisfiedAt: true,
  })
  .extend({ identityVersion: z.number().int().positive() });
export type DatabaseIdentity = z.infer<typeof databaseIdentitySchema>;
const databaseIdentityWithoutModulesSchema = databaseIdentitySchema.omit({ enabledModules: true });

const publicBrandingSchema = z.object({
  storageBucket: z.string().min(1),
  storageKey: z.string().min(1),
  mediaType: z.string().regex(/^image\/(?:png|jpeg|webp|svg\+xml)$/),
  sizeBytes: z.coerce.number().int().min(1).max(5_242_880),
  sha256Hex: z.string().regex(/^[0-9a-f]{64}$/),
});
export type PublicBranding = z.infer<typeof publicBrandingSchema>;

/** Resolves safe public branding from an exact, verified tenant hostname. */
export async function resolvePublicTenant(
  hostname: string,
): Promise<PublicTenantConfiguration | undefined> {
  const result = await runInSystemTransaction(
    /** Executes the `resolvePublicTenant` privileged database work on one controlled PostgreSQL transaction reserved for bootstrap/identity system operations. It receives `client`. Direct links: `client.query`, `hostname.toLowerCase`. */ (
      client,
    ) =>
      client.query<{ configuration: unknown }>(
        'select app.resolve_public_tenant($1) as configuration',
        [hostname.toLowerCase()],
      ),
  );
  const value = result.rows[0]?.configuration;
  return value ? publicTenantConfigurationSchema.parse(value) : undefined;
}

/** Returns the Cognito identifiers and session policy required by the BFF only. */
export async function resolveAuthRuntime(tenantId: string): Promise<AuthRuntime> {
  const result = await runInSystemTransaction(
    /** Executes the `resolveAuthRuntime` privileged database work on one controlled PostgreSQL transaction reserved for bootstrap/identity system operations. It receives `client`. Direct links: `client.query`. */ (
      client,
    ) =>
      client.query<{ configuration: unknown }>(
        'select app.resolve_auth_runtime($1) as configuration',
        [tenantId],
      ),
  );
  return authRuntimeSchema.parse(result.rows[0]?.configuration);
}

/** Resolves only the active tenant logo object for an exact verified hostname. */
export async function resolvePublicBranding(
  hostname: string,
  fileId: string,
): Promise<PublicBranding | undefined> {
  const result = await runInSystemTransaction(
    /** Executes the `resolvePublicBranding` privileged database work on one controlled PostgreSQL transaction reserved for bootstrap/identity system operations. It receives `client`. Direct links: `client.query`, `hostname.toLowerCase`. */ (
      client,
    ) =>
      client.query<{ configuration: unknown }>(
        'select app.resolve_public_branding($1, $2::uuid) as configuration',
        [hostname.toLowerCase(), fileId],
      ),
  );
  const value = result.rows[0]?.configuration;
  return value ? publicBrandingSchema.parse(value) : undefined;
}

/**
 * Resolves or provisions a federated identity only after Cognito token validation.
 * Raw access/refresh tokens are never passed into PostgreSQL or retained in logs.
 */
export async function establishIdentity(
  input: Readonly<{
    tenantId: string;
    subject: string;
    email: string;
    displayName: string;
    providerKey: string;
    claims: Readonly<Record<string, unknown>>;
  }>,
): Promise<DatabaseIdentity> {
  const result = await runInSystemTransaction(
    /** Executes the `establishIdentity` privileged database work on one controlled PostgreSQL transaction reserved for bootstrap/identity system operations. It receives `client`. Direct links: `client.query`, `JSON.stringify`. */ async (
      client,
    ) => {
      const identity = await client.query<{ identity: unknown }>(
        `select app.establish_identity_session(
        $1, $2, $3::public.citext, $4, $5, $6::jsonb
      ) as identity`,
        [
          input.tenantId,
          input.subject,
          input.email,
          input.displayName,
          input.providerKey,
          JSON.stringify(input.claims),
        ],
      );
      const modules = await client.query<{ modules: string[] }>(
        'select app.resolve_enabled_modules($1) as modules',
        [input.tenantId],
      );
      return { identity: identity.rows[0]?.identity, modules: modules.rows[0]?.modules ?? [] };
    },
  );
  return databaseIdentitySchema.parse({
    ...databaseIdentityWithoutModulesSchema.parse(result.identity),
    enabledModules: moduleIdSchema.array().parse(result.modules),
  });
}

/** Rechecks disablement, role changes and campus scope for a live session. */
export async function refreshIdentity(
  tenantId: string,
  userId: string,
): Promise<DatabaseIdentity | undefined> {
  const result = await runInSystemTransaction(
    /** Executes the `refreshIdentity` privileged database work on one controlled PostgreSQL transaction reserved for bootstrap/identity system operations. It receives `client`. Direct links: `client.query`. */ async (
      client,
    ) => {
      const identity = await client.query<{ identity: unknown }>(
        'select app.refresh_session_identity($1, $2) as identity',
        [tenantId, userId],
      );
      const modules = await client.query<{ modules: string[] }>(
        'select app.resolve_enabled_modules($1) as modules',
        [tenantId],
      );
      return { identity: identity.rows[0]?.identity, modules: modules.rows[0]?.modules ?? [] };
    },
  );
  if (!result.identity) return undefined;
  return databaseIdentitySchema.parse({
    ...databaseIdentityWithoutModulesSchema.parse(result.identity),
    enabledModules: moduleIdSchema.array().parse(result.modules),
  });
}

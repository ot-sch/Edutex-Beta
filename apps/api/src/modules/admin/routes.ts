/**
 * @fileoverview Registers the admin HTTP API routes, validates untrusted requests and connects authenticated Fastify handlers to tenant-scoped services/PostgreSQL transactions.
 *
 * @remarks
 * Direct links: `node:net`, `@edutex/contracts`, `@edutex/database`, `fastify`, `zod`, `../../shared/errors.js`, `../auth/identity-repository.js`, `../auth/session.js`, `/api/v1/admin/authentication`, `/api/v1/admin/authentication/policy`, `/api/v1/admin/modules`, `/api/v1/admin/identity-providers`, `/api/v1/admin/identity-providers/:providerId/status`, `/api/v1/admin/directory-role-mappings`.
 * Security: Maintained source boundary; changes require strict type, test, lint, format and security review.
 */

import { isIP } from 'node:net';

import { moduleIdSchema } from '@edutex/contracts';
import { runInTenantTransaction } from '@edutex/database';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { ApplicationError } from '../../shared/errors.js';
import { resolveAuthRuntime } from '../auth/identity-repository.js';
import { requireCsrf, requirePermission, requireSession } from '../auth/session.js';
import { CognitoTenantIdentityService } from './cognito-identity-service.js';

const policySchema = z
  .object({
    passwordEnabled: z.boolean(),
    passkeyEnabled: z.boolean(),
    totpMode: z.enum(['disabled', 'optional', 'required_for_password']),
    microsoftEnabled: z.boolean(),
    googleEnabled: z.boolean(),
    samlEnabled: z.boolean(),
    sessionIdleMinutes: z.number().int().min(5).max(240),
    sessionAbsoluteHours: z.number().int().min(1).max(72),
    stepUpMinutes: z.number().int().min(1).max(60),
  })
  .superRefine(
    /** Performs the local `z .object({ passwordEnabled: z.boolean(), passkeyEnabled: z.` operation inside `routes` and returns control to the surrounding feature only after this body completes. It receives `value`, `context`. Direct links: `context.addIssue`. */ (
      value,
      context,
    ) => {
      if (value.passwordEnabled && value.totpMode !== 'required_for_password') {
        context.addIssue({
          code: 'custom',
          path: ['totpMode'],
          message: 'Password sign-in requires TOTP MFA in production Edutex policy.',
        });
      }
      if (value.passkeyEnabled && !value.passwordEnabled) {
        context.addIssue({
          code: 'custom',
          path: ['passwordEnabled'],
          message:
            'Cognito managed login requires PASSWORD alongside WEB_AUTHN; enable both or disable both local methods.',
        });
      }
    },
  );

/** Rejects loopback, link-local, RFC1918/ULA and local-use names before accepting IdP endpoints. */
function isPrivateHostname(hostname: string): boolean {
  const value = hostname.toLowerCase();
  if (value === 'localhost' || value.endsWith('.local') || value.endsWith('.internal')) return true;
  if (isIP(value) === 4) {
    const parts = value.split('.').map(Number);
    return (
      parts[0] === 10 ||
      parts[0] === 127 ||
      (parts[0] === 169 && parts[1] === 254) ||
      (parts[0] === 172 && (parts[1] ?? 0) >= 16 && (parts[1] ?? 0) <= 31) ||
      (parts[0] === 192 && parts[1] === 168)
    );
  }
  return (
    isIP(value) === 6 &&
    (value === '::1' ||
      value.startsWith('fc') ||
      value.startsWith('fd') ||
      value.startsWith('fe80'))
  );
}

const publicHttpsUrl = z.url().refine(
  /** Performs the cross-field/domain validation that the surrounding Zod schema cannot express with individual field rules. It receives `value`. Direct links: `isPrivateHostname`. */ (
    value,
  ) => {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !isPrivateHostname(url.hostname)
    );
  },
  'URL must be a public HTTPS endpoint.',
);

const providerSchema = z
  .object({
    providerKey: z.string().regex(/^[a-z][a-z0-9-]{1,40}$/),
    providerType: z.enum(['microsoft', 'google', 'oidc', 'saml']),
    displayName: z.string().trim().min(1).max(80),
    buttonLabel: z.string().trim().min(1).max(80),
    issuerUrl: publicHttpsUrl.optional(),
    metadataUrl: publicHttpsUrl.optional(),
    clientId: z.string().trim().max(500).optional(),
    clientSecret: z.string().min(16).max(4096).optional(),
    scopes: z
      .array(z.string().regex(/^[A-Za-z0-9_:/.-]{1,100}$/))
      .min(1)
      .max(20),
    attributeMapping: z.record(z.string().max(80), z.string().max(200)),
  })
  .superRefine(
    /** Performs the local `z .object({ providerKey: z.string().regex(/^[a-z][a-z0-9-]{1` operation inside `routes` and returns control to the surrounding feature only after this body completes. It receives `value`, `context`. Direct links: `context.addIssue`, `['microsoft', 'oidc'].includes`. */ (
      value,
      context,
    ) => {
      if (value.providerType === 'saml' && !value.metadataUrl) {
        context.addIssue({
          code: 'custom',
          path: ['metadataUrl'],
          message: 'SAML metadata URL is required.',
        });
      }
      if (value.providerType !== 'saml' && (!value.clientId || !value.clientSecret)) {
        context.addIssue({
          code: 'custom',
          path: ['clientSecret'],
          message: 'Client credentials are required.',
        });
      }
      if (['microsoft', 'oidc'].includes(value.providerType) && !value.issuerUrl) {
        context.addIssue({
          code: 'custom',
          path: ['issuerUrl'],
          message: 'OIDC issuer URL is required.',
        });
      }
    },
  );

const providerStatusSchema = z.object({
  enabled: z.boolean(),
  rowVersion: z.number().int().positive(),
});

/** A new or reconfigured provider must pass mapping and sign-in tests before publication. */
export const STAGED_IDENTITY_PROVIDER_ENABLED = false;

/** Prevents a staged identity provider from becoming public before an explicit role rule exists. */
export function identityProviderActivationAllowed(enabled: boolean, mappingCount: number): boolean {
  return !enabled || mappingCount > 0;
}

const roleMappingSchema = z.object({
  identityProviderId: z.uuid(),
  claimName: z.string().regex(/^[A-Za-z0-9_:./-]{1,80}$/),
  claimValue: z.string().min(1).max(512),
  roleId: z.uuid(),
  userCategory: z.enum([
    'student',
    'teacher',
    'corporate_staff',
    'it_staff',
    'executive_staff',
    'parent_guardian',
    'contractor',
  ]),
  priority: z.number().int().min(1).max(10_000).default(100),
});

const moduleSettingsSchema = z
  .object({
    modules: z
      .array(
        z.object({
          key: moduleIdSchema,
          enabled: z.boolean(),
          displayOrder: z.number().int().min(1).max(1000),
          rowVersion: z.number().int().nonnegative(),
        }),
      )
      .min(2)
      .max(21),
  })
  .superRefine(
    /** Performs the local `z .object({ modules: z .array( z.object({ key: moduleIdSchem` operation inside `routes` and returns control to the surrounding feature only after this body completes. It receives `value`, `context`. Direct links: `value.modules.map`, `context.addIssue`, `value.modules.some`. */ (
      value,
      context,
    ) => {
      const keys = value.modules.map(
        /** Transforms each input item for `routes` into the derived value or React element consumed by the surrounding collection. It receives `module`. It uses only the local values shown in its body. */ (
          module,
        ) => module.key,
      );
      if (new Set(keys).size !== keys.length) {
        context.addIssue({
          code: 'custom',
          path: ['modules'],
          message: 'Module keys must be unique.',
        });
      }
      for (const required of ['dashboard', 'admin'] as const) {
        if (
          !value.modules.some(
            /** Reports whether at least one input item satisfies this authorization/validation condition for `routes`. It receives `module`. It uses only the local values shown in its body. */ (
              module,
            ) => module.key === required && module.enabled,
          )
        ) {
          context.addIssue({
            code: 'custom',
            path: ['modules'],
            message: `${required} must remain enabled.`,
          });
        }
      }
    },
  );

interface AuthenticationPolicyRow {
  readonly passwordEnabled: boolean;
  readonly passkeyEnabled: boolean;
  readonly totpMode: 'disabled' | 'optional' | 'required_for_password';
  readonly microsoftEnabled: boolean;
  readonly googleEnabled: boolean;
  readonly samlEnabled: boolean;
  readonly sessionIdleMinutes: number;
  readonly sessionAbsoluteHours: number;
  readonly stepUpMinutes: number;
  readonly rowVersion: string | number;
}

interface IdentityProviderRow {
  readonly id: string;
  readonly providerKey: string;
  readonly providerType: 'microsoft' | 'google' | 'oidc' | 'saml';
  readonly displayName: string;
  readonly buttonLabel: string;
  readonly enabled: boolean;
  readonly issuerUrl: string | null;
  readonly metadataUrl: string | null;
  readonly clientId: string | null;
  readonly scopes: readonly string[];
  readonly attributeMapping: Readonly<Record<string, string>>;
  readonly rowVersion: string | number;
}

interface DirectoryRoleMappingRow {
  readonly id: string;
  readonly identityProviderId: string;
  readonly claimName: string;
  readonly claimValue: string;
  readonly roleId: string;
  readonly userCategory: z.infer<typeof roleMappingSchema>['userCategory'];
  readonly priority: number;
  readonly rowVersion: string | number;
}

interface DirectoryRoleRow {
  readonly id: string;
  readonly name: string;
}

interface TenantModuleRow {
  readonly key: z.infer<typeof moduleIdSchema>;
  readonly enabled: boolean;
  readonly displayOrder: number;
  readonly rowVersion: string | number;
}

/** Registers school-controlled login policy, SSO providers and directory role mapping. */
export function registerAdminRoutes(server: FastifyInstance): void {
  const cognitoService = new CognitoTenantIdentityService(server.configuration);

  server.get('/api/v1/admin/authentication', {
    preHandler: [requireSession, requirePermission('admin:view')],
    /** Implements `handler` for registers the admin http api routes, validates untrusted requests and connects authenticated fastify handlers to tenant-scoped services/postgresql transactions. It receives `request`. Direct links: `runInTenantTransaction`. */ handler:
      async (request) => {
        if (!request.identity)
          throw new ApplicationError(401, 'AUTHENTICATION_REQUIRED', 'Please sign in.');
        const identity = request.identity;
        return runInTenantTransaction(
          {
            tenantId: identity.user.tenantId,
            userId: identity.user.id,
            permissions: identity.user.permissions,
            requestId: request.id,
          },
          /** Executes the `handler` database work on the same PostgreSQL client after transaction-local tenant/user/permission context is set, preserving RLS isolation. It receives `client`. Direct links: `client.query`, `Number`, `providers.rows.map`, `mappings.rows.map`, `modules.rows.map`. */ async (
            client,
          ) => {
            const policy = await client.query<AuthenticationPolicyRow>(
              `select password_enabled as "passwordEnabled", passkey_enabled as "passkeyEnabled",
                    totp_mode as "totpMode", microsoft_enabled as "microsoftEnabled",
                    google_enabled as "googleEnabled", saml_enabled as "samlEnabled",
                    session_idle_minutes as "sessionIdleMinutes",
                    session_absolute_hours as "sessionAbsoluteHours",
                    step_up_minutes as "stepUpMinutes", row_version as "rowVersion"
             from app.authentication_policies where tenant_id = $1`,
              [identity.user.tenantId],
            );
            const providers = await client.query<IdentityProviderRow>(
              `select id, provider_key as "providerKey", provider_type as "providerType",
                    display_name as "displayName", button_label as "buttonLabel", enabled,
                    issuer_url as "issuerUrl", metadata_url as "metadataUrl", client_id as "clientId",
                    scopes, attribute_mapping as "attributeMapping", row_version as "rowVersion"
             from app.identity_providers where tenant_id = $1 order by display_name`,
              [identity.user.tenantId],
            );
            const mappings = await client.query<DirectoryRoleMappingRow>(
              `select id, identity_provider_id as "identityProviderId", claim_name as "claimName",
                    claim_value as "claimValue", role_id as "roleId",
                    user_category as "userCategory", priority, row_version as "rowVersion"
             from app.directory_role_mappings where tenant_id = $1 order by priority, claim_name`,
              [identity.user.tenantId],
            );
            const roles = await client.query<DirectoryRoleRow>(
              `select id, name from app.roles where tenant_id = $1 order by name`,
              [identity.user.tenantId],
            );
            const modules = await client.query<TenantModuleRow>(
              `select module_key as key, enabled, display_order as "displayOrder",
                    row_version as "rowVersion"
             from app.tenant_modules where tenant_id = $1 order by display_order, module_key`,
              [identity.user.tenantId],
            );
            return {
              policy: policy.rows[0]
                ? { ...policy.rows[0], rowVersion: Number(policy.rows[0].rowVersion) }
                : undefined,
              providers: providers.rows.map(
                /** Transforms each input item for `handler` into the derived value or React element consumed by the surrounding collection. It receives `provider`. Direct links: `Number`. */ (
                  provider,
                ) => ({
                  ...provider,
                  rowVersion: Number(provider.rowVersion),
                }),
              ),
              roleMappings: mappings.rows.map(
                /** Transforms each input item for `handler` into the derived value or React element consumed by the surrounding collection. It receives `mapping`. Direct links: `Number`. */ (
                  mapping,
                ) => ({
                  ...mapping,
                  rowVersion: Number(mapping.rowVersion),
                }),
              ),
              roles: roles.rows,
              modules: modules.rows.map(
                /** Transforms each input item for `handler` into the derived value or React element consumed by the surrounding collection. It receives `module`. Direct links: `Number`. */ (
                  module,
                ) => ({
                  ...module,
                  rowVersion: Number(module.rowVersion),
                }),
              ),
            };
          },
        );
      },
  });

  server.put('/api/v1/admin/authentication/policy', {
    preHandler: [requireSession, requirePermission('admin:manage'), requireCsrf],
    /** Implements `handler` for registers the admin http api routes, validates untrusted requests and connects authenticated fastify handlers to tenant-scoped services/postgresql transactions. It receives `request`. Direct links: `policySchema .extend({ rowVersion: z.number()`, `policySchema .extend`, `z.number().int().nonnegative`, `z.number().int`, `z.number`. */ handler:
      async (request) => {
        if (!request.identity)
          throw new ApplicationError(401, 'AUTHENTICATION_REQUIRED', 'Please sign in.');
        const identity = request.identity;
        const body = policySchema
          .extend({ rowVersion: z.number().int().nonnegative() })
          .parse(request.body);
        const runtime = await resolveAuthRuntime(identity.user.tenantId);
        const result = await runInTenantTransaction(
          {
            tenantId: identity.user.tenantId,
            userId: identity.user.id,
            permissions: identity.user.permissions,
            requestId: request.id,
          },
          /** Executes the `handler` database work on the same PostgreSQL client after transaction-local tenant/user/permission context is set, preserving RLS isolation. It receives `client`. Direct links: `client.query`, `Number`, `cognitoService.applyAuthenticationPolicy`. */ async (
            client,
          ) => {
            const current = await client.query<{ row_version: string }>(
              `select row_version from app.authentication_policies
             where tenant_id = $1 for update`,
              [identity.user.tenantId],
            );
            if (Number(current.rows[0]?.row_version) !== body.rowVersion) {
              throw new ApplicationError(
                409,
                'VERSION_CONFLICT',
                'The policy changed elsewhere. Refresh before saving.',
              );
            }
            await cognitoService.applyAuthenticationPolicy(runtime, {
              passwordEnabled: body.passwordEnabled,
              passkeyEnabled: body.passkeyEnabled,
              totpMode: body.totpMode,
            });
            return client.query<{ rowVersion: string | number }>(
              `update app.authentication_policies set
               password_enabled = $2, passkey_enabled = $3, totp_mode = $4,
               microsoft_enabled = $5, google_enabled = $6, saml_enabled = $7,
               session_idle_minutes = $8, session_absolute_hours = $9,
               step_up_minutes = $10, updated_by = $11
             where tenant_id = $1 and row_version = $12
             returning row_version as "rowVersion"`,
              [
                identity.user.tenantId,
                body.passwordEnabled,
                body.passkeyEnabled,
                body.totpMode,
                body.microsoftEnabled,
                body.googleEnabled,
                body.samlEnabled,
                body.sessionIdleMinutes,
                body.sessionAbsoluteHours,
                body.stepUpMinutes,
                identity.user.id,
                body.rowVersion,
              ],
            );
          },
        );
        if (!result.rows[0])
          throw new ApplicationError(
            409,
            'VERSION_CONFLICT',
            'The policy changed elsewhere. Refresh before saving.',
          );
        return { ...result.rows[0], rowVersion: Number(result.rows[0].rowVersion) };
      },
  });

  server.put('/api/v1/admin/modules', {
    preHandler: [requireSession, requirePermission('admin:manage'), requireCsrf],
    /** Implements `handler` for registers the admin http api routes, validates untrusted requests and connects authenticated fastify handlers to tenant-scoped services/postgresql transactions. It receives `request`. Direct links: `moduleSettingsSchema.parse`, `runInTenantTransaction`. */ handler:
      async (request) => {
        if (!request.identity)
          throw new ApplicationError(401, 'AUTHENTICATION_REQUIRED', 'Please sign in.');
        const identity = request.identity;
        const body = moduleSettingsSchema.parse(request.body);
        await runInTenantTransaction(
          {
            tenantId: identity.user.tenantId,
            userId: identity.user.id,
            permissions: identity.user.permissions,
            requestId: request.id,
          },
          /** Executes the `handler` database work on the same PostgreSQL client after transaction-local tenant/user/permission context is set, preserving RLS isolation. It receives `client`. Direct links: `client.query`, `body.modules.map`, `Number`. */ async (
            client,
          ) => {
            const updated = await client.query<{ updatedCount: string | number }>(
              `with requested as (
               select * from unnest($3::text[], $4::boolean[], $5::smallint[], $6::bigint[])
                 as settings(module_key, enabled, display_order, row_version)
             ), updated as (
               update app.tenant_modules as modules set
                 enabled = requested.enabled,
                 display_order = requested.display_order,
                 updated_by = $2
               from requested
               where modules.tenant_id = $1
                 and modules.module_key = requested.module_key
                 and modules.row_version = requested.row_version
               returning modules.module_key
             )
             select count(*) as "updatedCount" from updated`,
              [
                identity.user.tenantId,
                identity.user.id,
                body.modules.map(
                  /** Transforms each input item for `handler` into the derived value or React element consumed by the surrounding collection. It receives `module`. It uses only the local values shown in its body. */ (
                    module,
                  ) => module.key,
                ),
                body.modules.map(
                  /** Transforms each input item for `handler` into the derived value or React element consumed by the surrounding collection. It receives `module`. It uses only the local values shown in its body. */ (
                    module,
                  ) => module.enabled,
                ),
                body.modules.map(
                  /** Transforms each input item for `handler` into the derived value or React element consumed by the surrounding collection. It receives `module`. It uses only the local values shown in its body. */ (
                    module,
                  ) => module.displayOrder,
                ),
                body.modules.map(
                  /** Transforms each input item for `handler` into the derived value or React element consumed by the surrounding collection. It receives `module`. It uses only the local values shown in its body. */ (
                    module,
                  ) => module.rowVersion,
                ),
              ],
            );
            if (Number(updated.rows[0]?.updatedCount) !== body.modules.length) {
              throw new ApplicationError(
                409,
                'VERSION_CONFLICT',
                'Module settings changed elsewhere. Refresh before saving.',
              );
            }
          },
        );
        return { modules: body.modules };
      },
  });

  server.post('/api/v1/admin/identity-providers', {
    preHandler: [requireSession, requirePermission('admin:manage'), requireCsrf],
    config: { rateLimit: { max: 10, timeWindow: '10 minutes' } },
    /** Implements `handler` for registers the admin http api routes, validates untrusted requests and connects authenticated fastify handlers to tenant-scoped services/postgresql transactions. It receives `request`, `reply`. Direct links: `providerSchema.parse`, `resolveAuthRuntime`, `runInTenantTransaction`, `cognitoService.configure`, `reply .status(201) .send`. */ handler:
      async (request, reply) => {
        if (!request.identity)
          throw new ApplicationError(401, 'AUTHENTICATION_REQUIRED', 'Please sign in.');
        const identity = request.identity;
        const body = providerSchema.parse(request.body);
        const runtime = await resolveAuthRuntime(identity.user.tenantId);
        const transactionContext = {
          tenantId: identity.user.tenantId,
          userId: identity.user.id,
          permissions: identity.user.permissions,
          requestId: request.id,
        };
        // Withdraw an existing provider before changing its upstream trust configuration. If the
        // external call fails, the safe disabled state remains and an operator can investigate.
        await runInTenantTransaction(
          transactionContext,
          /** Executes the `handler` database work on the same PostgreSQL client after transaction-local tenant/user/permission context is set, preserving RLS isolation. It receives `client`. Direct links: `client.query`. */ (
            client,
          ) =>
            client.query(
              `update app.identity_providers
           set enabled = $3, updated_by = $4
           where tenant_id = $1 and provider_key = $2 and enabled is distinct from $3`,
              [
                identity.user.tenantId,
                body.providerKey,
                STAGED_IDENTITY_PROVIDER_ENABLED,
                identity.user.id,
              ],
            ),
        );
        const configured = await cognitoService.configure(runtime, {
          tenantId: identity.user.tenantId,
          tenantSlug: runtime.tenantSlug,
          providerKey: body.providerKey,
          providerType: body.providerType,
          ...(body.issuerUrl ? { issuerUrl: body.issuerUrl } : {}),
          ...(body.metadataUrl ? { metadataUrl: body.metadataUrl } : {}),
          ...(body.clientId ? { clientId: body.clientId } : {}),
          ...(body.clientSecret ? { clientSecret: body.clientSecret } : {}),
          scopes: body.scopes,
          attributeMapping: body.attributeMapping,
        });
        const result = await runInTenantTransaction(
          transactionContext,
          /** Executes the `handler` database work on the same PostgreSQL client after transaction-local tenant/user/permission context is set, preserving RLS isolation. It receives `client`. Direct links: `client.query`, `JSON.stringify`. */ (
            client,
          ) =>
            client.query<{ id: string; enabled: boolean; rowVersion: string | number }>(
              `insert into app.identity_providers (
               tenant_id, provider_key, provider_type, display_name, button_label, enabled,
               cognito_provider_name, issuer_url, metadata_url, client_id, client_secret_arn,
               scopes, attribute_mapping
             ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb)
             on conflict (tenant_id, provider_key) do update set
               provider_type = excluded.provider_type, display_name = excluded.display_name,
               button_label = excluded.button_label, enabled = excluded.enabled,
               cognito_provider_name = excluded.cognito_provider_name,
               issuer_url = excluded.issuer_url, metadata_url = excluded.metadata_url,
               client_id = excluded.client_id,
               client_secret_arn = coalesce(excluded.client_secret_arn, app.identity_providers.client_secret_arn),
               scopes = excluded.scopes, attribute_mapping = excluded.attribute_mapping
             returning id, enabled, row_version as "rowVersion"`,
              [
                identity.user.tenantId,
                body.providerKey,
                body.providerType,
                body.displayName,
                body.buttonLabel,
                STAGED_IDENTITY_PROVIDER_ENABLED,
                configured.cognitoProviderName,
                body.issuerUrl ?? null,
                body.metadataUrl ?? null,
                body.clientId ?? null,
                configured.clientSecretArn ?? null,
                body.scopes,
                JSON.stringify(body.attributeMapping),
              ],
            ),
        );
        const provider = result.rows[0];
        return reply
          .status(201)
          .send(provider ? { ...provider, rowVersion: Number(provider.rowVersion) } : undefined);
      },
  });

  server.put('/api/v1/admin/identity-providers/:providerId/status', {
    preHandler: [requireSession, requirePermission('admin:manage'), requireCsrf],
    config: { rateLimit: { max: 20, timeWindow: '10 minutes' } },
    /** Implements `handler` for registers the admin http api routes, validates untrusted requests and connects authenticated fastify handlers to tenant-scoped services/postgresql transactions. It receives `request`. Direct links: `z.object({ providerId: z.uuid() }).parse`, `z.object`, `z.uuid`, `providerStatusSchema.parse`, `runInTenantTransaction`. */ handler:
      async (request) => {
        if (!request.identity)
          throw new ApplicationError(401, 'AUTHENTICATION_REQUIRED', 'Please sign in.');
        const identity = request.identity;
        const { providerId } = z.object({ providerId: z.uuid() }).parse(request.params);
        const body = providerStatusSchema.parse(request.body);
        const result = await runInTenantTransaction(
          {
            tenantId: identity.user.tenantId,
            userId: identity.user.id,
            permissions: identity.user.permissions,
            requestId: request.id,
          },
          /** Executes the `handler` database work on the same PostgreSQL client after transaction-local tenant/user/permission context is set, preserving RLS isolation. It receives `client`. Direct links: `client.query`, `Number`, `identityProviderActivationAllowed`. */ async (
            client,
          ) => {
            const provider = await client.query<{ rowVersion: string | number }>(
              `select row_version as "rowVersion"
             from app.identity_providers
             where tenant_id = $1 and id = $2
             for update`,
              [identity.user.tenantId, providerId],
            );
            if (!provider.rows[0]) {
              throw new ApplicationError(
                404,
                'IDENTITY_PROVIDER_NOT_FOUND',
                'That identity provider does not exist.',
              );
            }
            if (Number(provider.rows[0].rowVersion) !== body.rowVersion) {
              throw new ApplicationError(
                409,
                'VERSION_CONFLICT',
                'The identity provider changed elsewhere. Refresh before saving.',
              );
            }
            if (body.enabled) {
              const mappings = await client.query<{ mappingCount: string | number }>(
                `select count(*) as "mappingCount"
               from app.directory_role_mappings
               where tenant_id = $1 and identity_provider_id = $2`,
                [identity.user.tenantId, providerId],
              );
              if (
                !identityProviderActivationAllowed(
                  true,
                  Number(mappings.rows[0]?.mappingCount ?? 0),
                )
              ) {
                throw new ApplicationError(
                  409,
                  'IDENTITY_PROVIDER_MAPPING_REQUIRED',
                  'Add at least one approved directory claim mapping before enabling this provider.',
                );
              }
            }
            return client.query<{ enabled: boolean; rowVersion: string | number }>(
              `update app.identity_providers
             set enabled = $3
             where tenant_id = $1 and id = $2 and row_version = $4
             returning enabled, row_version as "rowVersion"`,
              [identity.user.tenantId, providerId, body.enabled, body.rowVersion],
            );
          },
        );
        if (!result.rows[0]) {
          throw new ApplicationError(
            409,
            'VERSION_CONFLICT',
            'The identity provider changed elsewhere. Refresh before saving.',
          );
        }
        return { ...result.rows[0], rowVersion: Number(result.rows[0].rowVersion) };
      },
  });

  server.post('/api/v1/admin/directory-role-mappings', {
    preHandler: [requireSession, requirePermission('admin:manage'), requireCsrf],
    /** Implements `handler` for registers the admin http api routes, validates untrusted requests and connects authenticated fastify handlers to tenant-scoped services/postgresql transactions. It receives `request`, `reply`. Direct links: `roleMappingSchema.parse`, `runInTenantTransaction`, `reply.status(201).send`, `reply.status`. */ handler:
      async (request, reply) => {
        if (!request.identity)
          throw new ApplicationError(401, 'AUTHENTICATION_REQUIRED', 'Please sign in.');
        const identity = request.identity;
        const body = roleMappingSchema.parse(request.body);
        const result = await runInTenantTransaction(
          {
            tenantId: identity.user.tenantId,
            userId: identity.user.id,
            permissions: identity.user.permissions,
            requestId: request.id,
          },
          /** Executes the `handler` database work on the same PostgreSQL client after transaction-local tenant/user/permission context is set, preserving RLS isolation. It receives `client`. Direct links: `client.query`. */ (
            client,
          ) =>
            client.query<{ id: string }>(
              `insert into app.directory_role_mappings (
               tenant_id, identity_provider_id, claim_name, claim_value,
               role_id, user_category, priority
             ) values ($1, $2, $3, $4, $5, $6, $7)
             returning id`,
              [
                identity.user.tenantId,
                body.identityProviderId,
                body.claimName,
                body.claimValue,
                body.roleId,
                body.userCategory,
                body.priority,
              ],
            ),
        );
        return reply.status(201).send({ id: result.rows[0]?.id });
      },
  });
}

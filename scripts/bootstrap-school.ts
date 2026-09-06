/**
 * @fileoverview Implements a controlled operator, provisioning, migration, deployment or quality-assurance utility executed outside the long-running API.
 *
 * @remarks
 * Direct links: `node:crypto`, `@aws-sdk/client-cognito-identity-provider`, `@aws-sdk/client-kms`, `@edutex/database`, `zod`.
 * Security: Privileged operator boundary; fail closed, keep secrets out of arguments/files/logs and retain approved evidence.
 */

import { randomBytes, randomUUID } from 'node:crypto';

import {
  AdminCreateUserCommand,
  CognitoIdentityProviderClient,
  CreateUserPoolClientCommand,
  CreateUserPoolCommand,
  CreateUserPoolDomainCommand,
  DeleteUserPoolCommand,
  SetUserPoolMfaConfigCommand,
  UpdateUserPoolCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { GenerateDataKeyCommand, KMSClient } from '@aws-sdk/client-kms';
import { CreateSecretCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { closeDatabase, createDatabasePool, runInSystemTransaction } from '@edutex/database';
import { z } from 'zod';

const argumentsSchema = z
  .object({
    slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,40}$/),
    name: z.string().trim().min(2).max(160),
    hostname: z
      .string()
      .regex(
        /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/,
        'Hostname must be a complete lower-case DNS name.',
      ),
    adminEmail: z.email(),
    adminName: z.string().trim().min(2).max(160),
    campusName: z.string().trim().min(2).max(160),
    academicYearName: z.string().trim().min(2).max(80),
    academicYearStart: z.iso.date(),
    academicYearEnd: z.iso.date(),
    timezone: z
      .string()
      .min(3)
      .max(80)
      .refine(
        /** Performs the cross-field/domain validation that the surrounding Zod schema cannot express with individual field rules. It receives `value`. Direct links: `new Intl.DateTimeFormat('en-GB', { timeZone: `. */ (
          value,
        ) => {
          try {
            new Intl.DateTimeFormat('en-GB', { timeZone: value }).format();
            return true;
          } catch {
            return false;
          }
        },
        'Timezone must be a recognised IANA time-zone name.',
      )
      .default('Australia/Melbourne'),
    country: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .default('AU'),
    region: z
      .string()
      .regex(/^[a-z]{2}(?:-[a-z]+)+-\d$/, 'Region must be a valid AWS region identifier.')
      .default('ap-southeast-2'),
    dataKeyId: z.string().min(3),
    sesSourceArn: z.string().regex(/^arn:[a-z0-9-]+:ses:[a-z0-9-]+:\d{12}:identity\/.+$/),
    sesFromAddress: z.email(),
    sesConfigurationSet: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,64}$/)
      .optional(),
  })
  .refine(
    /** Performs the local `z .object({ slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,40}` operation inside `bootstrap-school` and returns control to the surrounding feature only after this body completes. It receives `value`. It uses only the local values shown in its body. */ (
      value,
    ) => value.academicYearEnd >= value.academicYearStart,
    {
      path: ['academicYearEnd'],
      message: 'Academic year end must be on or after its start.',
    },
  );

/** Generates a high-entropy, composition-compatible temporary password for forced first change. */
function temporaryAdministratorPassword(): string {
  return `${randomBytes(18).toString('base64url')}Aa1!`;
}

/** Parses strict `--flag value` bootstrap arguments and rejects incomplete or positional input. */
function commandArguments(values: readonly string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let index = 0; index < values.length; index += 2) {
    const flag = values[index];
    const value = values[index + 1];
    if (!flag?.startsWith('--') || !value)
      throw new Error(`Invalid argument near ${flag ?? 'end of input'}.`);
    result[
      flag
        .slice(2)
        .replace(
          /-([a-z])/g,
          /** Performs the local `flag.slice(2).replace` operation inside `commandArguments` and returns control to the surrounding feature only after this body completes. It receives `_match`, `letter`. Direct links: `letter.toUpperCase`. */ (
            _match,
            letter: string,
          ) => letter.toUpperCase(),
        )
    ] = value;
  }
  return result;
}

/**
 * Creates an isolated Cognito pool, one-time administrator, relational tenant
 * defaults and the first KMS envelope key. It never accepts an admin password.
 */
async function bootstrap(): Promise<void> {
  const suppliedArguments = commandArguments(process.argv.slice(2));
  const options = argumentsSchema.parse({
    ...suppliedArguments,
    dataKeyId: suppliedArguments.dataKeyId ?? process.env.TENANT_DATA_KEY_KMS_KEY_ID,
  });
  process.env.AWS_REGION = options.region;
  await createDatabasePool();

  const existing = await runInSystemTransaction(
    /** Executes the `bootstrap` privileged database work on one controlled PostgreSQL transaction reserved for bootstrap/identity system operations. It receives `client`. Direct links: `client.query`. */ (
      client,
    ) =>
      client.query(
        'select 1 from app.tenants where slug = $1::public.citext or exists (select 1 from app.tenant_domains where hostname = $2::public.citext)',
        [options.slug, options.hostname],
      ),
  );
  if (existing.rowCount) throw new Error('That school slug or hostname already exists.');

  const cognito = new CognitoIdentityProviderClient({ region: options.region });
  const secrets = new SecretsManagerClient({ region: options.region });
  const tenantId = randomUUID();
  const domainPrefix = `edutex-${options.slug}-${tenantId.slice(0, 8)}`;
  const cognitoDomain = `${domainPrefix}.auth.${options.region}.amazoncognito.com`;
  let userPoolId: string | undefined;
  let databaseProvisioned = false;
  let campusId: string | undefined;
  let academicYearId: string | undefined;
  let browserClientSecretCreated = false;
  try {
    const createPool = new CreateUserPoolCommand({
      PoolName: `edutex-${options.slug}`,
      UserPoolTier: 'PLUS',
      UsernameAttributes: ['email'],
      AutoVerifiedAttributes: ['email'],
      AdminCreateUserConfig: { AllowAdminCreateUserOnly: true },
      Schema: [
        {
          Name: 'directory_groups',
          AttributeDataType: 'String',
          Mutable: true,
          StringAttributeConstraints: { MinLength: '0', MaxLength: '2048' },
        },
        {
          Name: 'directory_role',
          AttributeDataType: 'String',
          Mutable: true,
          StringAttributeConstraints: { MinLength: '0', MaxLength: '512' },
        },
        {
          Name: 'user_category',
          AttributeDataType: 'String',
          Mutable: true,
          StringAttributeConstraints: { MinLength: '0', MaxLength: '80' },
        },
        {
          Name: 'authentication_assurance',
          AttributeDataType: 'String',
          Mutable: true,
          StringAttributeConstraints: { MinLength: '0', MaxLength: '256' },
        },
      ],
      MfaConfiguration: 'ON',
      Policies: {
        PasswordPolicy: {
          MinimumLength: 15,
          RequireLowercase: false,
          RequireNumbers: false,
          RequireSymbols: false,
          RequireUppercase: false,
          TemporaryPasswordValidityDays: 2,
          PasswordHistorySize: 24,
        },
        SignInPolicy: { AllowedFirstAuthFactors: ['PASSWORD'] },
      },
      AccountRecoverySetting: {
        RecoveryMechanisms: [{ Name: 'verified_email', Priority: 1 }],
      },
      DeletionProtection: 'ACTIVE',
      DeviceConfiguration: {
        ChallengeRequiredOnNewDevice: true,
        DeviceOnlyRememberedOnUserPrompt: true,
      },
      UserAttributeUpdateSettings: {
        AttributesRequireVerificationBeforeUpdate: ['email'],
      },
      UserPoolAddOns: { AdvancedSecurityMode: 'ENFORCED' },
      EmailConfiguration: {
        EmailSendingAccount: 'DEVELOPER',
        SourceArn: options.sesSourceArn,
        From: options.sesFromAddress,
        ...(options.sesConfigurationSet ? { ConfigurationSet: options.sesConfigurationSet } : {}),
      },
      UserPoolTags: { application: 'edutex', tenantId, school: options.slug },
    });
    const poolResult = await cognito.send(createPool);
    userPoolId = poolResult.UserPool?.Id;
    if (!userPoolId) throw new Error('Cognito did not return a user pool identifier.');
    await cognito.send(
      new SetUserPoolMfaConfigCommand({
        UserPoolId: userPoolId,
        MfaConfiguration: 'ON',
        SoftwareTokenMfaConfiguration: { Enabled: true },
        WebAuthnConfiguration: {
          // Managed login performs WebAuthn ceremonies on the Cognito domain. Using the portal
          // hostname here would violate WebAuthn origin/RP-ID matching and break registration.
          RelyingPartyId: cognitoDomain,
          UserVerification: 'required',
          FactorConfiguration: 'MULTI_FACTOR_WITH_USER_VERIFICATION',
        },
      }),
    );

    // Enable passkeys only after Cognito has the required user-verification MFA factor configuration.
    // Carry every mutable security/email setting from the creation request: UpdateUserPool resets omitted values.
    await cognito.send(
      new UpdateUserPoolCommand({
        UserPoolId: userPoolId,
        PoolName: createPool.input.PoolName,
        UserPoolTier: createPool.input.UserPoolTier,
        AdminCreateUserConfig: createPool.input.AdminCreateUserConfig,
        AutoVerifiedAttributes: createPool.input.AutoVerifiedAttributes,
        MfaConfiguration: 'ON',
        Policies: {
          ...createPool.input.Policies,
          SignInPolicy: { AllowedFirstAuthFactors: ['PASSWORD', 'WEB_AUTHN'] },
        },
        AccountRecoverySetting: createPool.input.AccountRecoverySetting,
        DeletionProtection: createPool.input.DeletionProtection,
        DeviceConfiguration: createPool.input.DeviceConfiguration,
        UserAttributeUpdateSettings: createPool.input.UserAttributeUpdateSettings,
        UserPoolAddOns: createPool.input.UserPoolAddOns,
        EmailConfiguration: createPool.input.EmailConfiguration,
        UserPoolTags: createPool.input.UserPoolTags,
      }),
    );

    const clientResult = await cognito.send(
      new CreateUserPoolClientCommand({
        UserPoolId: userPoolId,
        ClientName: 'edutex-browser-bff',
        GenerateSecret: true,
        // Managed login uses ALLOW_USER_AUTH. Excluding ALLOW_REFRESH_TOKEN_AUTH prevents public
        // Cognito API refresh; the BFF does not retain refresh tokens after the one-time exchange.
        ExplicitAuthFlows: ['ALLOW_USER_AUTH'],
        AllowedOAuthFlowsUserPoolClient: true,
        AllowedOAuthFlows: ['code'],
        AllowedOAuthScopes: ['openid', 'email', 'profile'],
        CallbackURLs: [`https://${options.hostname}/api/v1/auth/callback`],
        LogoutURLs: [`https://${options.hostname}/auth/`],
        SupportedIdentityProviders: ['COGNITO'],
        ReadAttributes: [
          'email',
          'email_verified',
          'name',
          'preferred_username',
          'custom:directory_groups',
          'custom:directory_role',
          'custom:user_category',
          'custom:authentication_assurance',
        ],
        // Federated claim destinations must be writable for Cognito attribute mapping. The OAuth
        // client deliberately omits aws.cognito.signin.user.admin, so its browser token cannot use
        // UpdateUserAttributes even though Cognito can write these fields during federation.
        WriteAttributes: [
          'email',
          'name',
          'preferred_username',
          'custom:directory_groups',
          'custom:directory_role',
          'custom:user_category',
          'custom:authentication_assurance',
        ],
        PreventUserExistenceErrors: 'ENABLED',
        EnableTokenRevocation: true,
        EnablePropagateAdditionalUserContextData: true,
        AccessTokenValidity: 5,
        IdTokenValidity: 5,
        RefreshTokenValidity: 1,
        TokenValidityUnits: { AccessToken: 'minutes', IdToken: 'minutes', RefreshToken: 'days' },
        RefreshTokenRotation: { Feature: 'ENABLED', RetryGracePeriodSeconds: 0 },
        AuthSessionValidity: 3,
      }),
    );
    const clientId = clientResult.UserPoolClient?.ClientId;
    const clientSecret = clientResult.UserPoolClient?.ClientSecret;
    if (!clientId || !clientSecret) {
      throw new Error('Cognito did not return confidential application-client credentials.');
    }
    await secrets.send(
      new CreateSecretCommand({
        Name: `edutex/tenants/${tenantId}/cognito/browser-client-secret`,
        Description: `Confidential Cognito OAuth client secret for tenant ${tenantId}`,
        SecretString: clientSecret,
        Tags: [
          { Key: 'edutex:tenant-id', Value: tenantId },
          { Key: 'edutex:purpose', Value: 'cognito-browser-client' },
        ],
      }),
    );
    browserClientSecretCreated = true;

    await cognito.send(
      new CreateUserPoolDomainCommand({
        Domain: domainPrefix,
        UserPoolId: userPoolId,
        ManagedLoginVersion: 2,
      }),
    );
    const userResult = await cognito.send(
      new AdminCreateUserCommand({
        UserPoolId: userPoolId,
        Username: options.adminEmail,
        TemporaryPassword: temporaryAdministratorPassword(),
        DesiredDeliveryMediums: ['EMAIL'],
        UserAttributes: [
          { Name: 'email', Value: options.adminEmail },
          // The invitation is delivered only to the supplied address. Marking the attribute here
          // allows the forced-change first sign-in to satisfy the BFF's verified-email invariant.
          { Name: 'email_verified', Value: 'true' },
          { Name: 'name', Value: options.adminName },
        ],
        ClientMetadata: { purpose: 'initial-school-administrator' },
      }),
    );
    const subject = userResult.User?.Attributes?.find(
      /** Selects the first input item matching this lookup condition for `bootstrap`; no match deliberately returns undefined. It receives `attribute`. It uses only the local values shown in its body. */ (
        attribute,
      ) => attribute.Name === 'sub',
    )?.Value;
    if (!subject) throw new Error('Cognito did not return the administrator subject.');

    const kms = new KMSClient({ region: options.region });
    const dataKey = await kms.send(
      new GenerateDataKeyCommand({
        KeyId: options.dataKeyId,
        KeySpec: 'AES_256',
        EncryptionContext: { tenantId, purpose: 'student-sensitive-data' },
      }),
    );
    const encryptedDataKey = dataKey.CiphertextBlob;
    if (!encryptedDataKey) throw new Error('KMS did not return the encrypted data key.');
    dataKey.Plaintext?.fill(0);

    await runInSystemTransaction(
      /** Executes the `bootstrap` privileged database work on one controlled PostgreSQL transaction reserved for bootstrap/identity system operations. It receives `client`. Direct links: `client.query`, `Buffer.from`. */ async (
        client,
      ) => {
        await client.query(
          `select set_config('app.tenant_id', $1, true),
              set_config('app.permissions', '["platform:manage"]', true),
              set_config('app.request_id', 'school-bootstrap', true)`,
          [tenantId],
        );
        const tenant = await client.query<{ id: string }>(
          `insert into app.tenants (
         id, slug, legal_name, display_name, status, default_timezone, data_region,
         cognito_user_pool_id, cognito_client_id, cognito_domain
       ) values ($1, $2, $3, $3, 'active', $4, $5, $6, $7, $8)
       returning id`,
          [
            tenantId,
            options.slug,
            options.name,
            options.timezone,
            options.region,
            userPoolId,
            clientId,
            cognitoDomain,
          ],
        );
        if (!tenant.rows[0]) throw new Error('Tenant provisioning did not return a record.');
        await client.query(
          `insert into app.tenant_domains (tenant_id, hostname, is_primary, verified_at)
       values ($1, $2, true, clock_timestamp())`,
          [tenantId, options.hostname],
        );
        const campus = await client.query<{ id: string }>(
          `insert into app.campuses (tenant_id, code, name, timezone, country_code)
       values ($1, 'MAIN', $2, $3, $4) returning id`,
          [tenantId, options.campusName, options.timezone, options.country],
        );
        campusId = campus.rows[0]?.id;
        const academicYear = await client.query<{ id: string }>(
          `insert into app.academic_years (tenant_id, name, starts_on, ends_on, status)
         values (
           $1, $2, $3::date, $4::date,
           case when current_date between $3::date and $4::date then 'active' else 'planned' end
         ) returning id`,
          [tenantId, options.academicYearName, options.academicYearStart, options.academicYearEnd],
        );
        academicYearId = academicYear.rows[0]?.id;
        const administrator = await client.query<{ id: string }>(
          `insert into app.users (
         tenant_id, cognito_subject, email, display_name, category, status
       ) values ($1, $2, $3::public.citext, $4, 'it_staff', 'active') returning id`,
          [tenantId, subject, options.adminEmail, options.adminName],
        );
        const adminId = administrator.rows[0]?.id;
        if (!adminId || !campusId || !academicYearId)
          throw new Error('Initial campus, academic year or administrator was not created.');
        await client.query('select app.provision_tenant_defaults($1, $2)', [tenantId, adminId]);
        await client.query(
          `insert into app.tenant_modules (tenant_id, module_key, display_order, updated_by)
       select $1, module_key, display_order, $2
       from unnest(
         array[
           'dashboard', 'students', 'attendance', 'timetables', 'classes', 'activities',
           'grades', 'families', 'staff', 'enrolments', 'finance', 'forms',
           'communications', 'events', 'alumni', 'photos', 'knowledge-base',
           'sign-in-out', 'import-export', 'audit', 'admin', 'management', 'insights', 'smart-alerts', 'risk', 'nurse', 'wellbeing', 'maintenance', 'technician', 'parent-portal', 'student-portal'
         ]::text[],
         array[10,20,30,40,50,60,70,80,90,100,110,120,130,140,150,160,170,180,190,200,210,220,230,240,250,260,270,280,290,300,310]::smallint[]
       ) as defaults(module_key, display_order)
       on conflict (tenant_id, module_key) do nothing`,
          [tenantId, adminId],
        );
        await client.query(
          'insert into app.user_campuses (tenant_id, user_id, campus_id) values ($1, $2, $3)',
          [tenantId, adminId, campusId],
        );
        await client.query(
          `insert into app.tenant_encryption_keys (
         tenant_id, kms_key_id, encrypted_data_key, status
       ) values ($1, $2, $3, 'active')`,
          [tenantId, options.dataKeyId, Buffer.from(encryptedDataKey)],
        );
        await client.query(
          `select audit.append_event($1, $2, 'tenant.bootstrap', 'tenant', $1::text,
         'success', null, null, jsonb_build_object('hostname', $3, 'userPoolId', $4))`,
          [tenantId, adminId, options.hostname, userPoolId],
        );
      },
    );
    databaseProvisioned = true;
  } catch (error) {
    if (userPoolId && !databaseProvisioned) {
      try {
        await cognito.send(
          new UpdateUserPoolCommand({
            UserPoolId: userPoolId,
            DeletionProtection: 'INACTIVE',
          }),
        );
        await cognito.send(new DeleteUserPoolCommand({ UserPoolId: userPoolId }));
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          `School provisioning failed and Cognito cleanup also failed for ${userPoolId}.`,
          { cause: cleanupError },
        );
      }
    }
    if (browserClientSecretCreated && !databaseProvisioned) {
      // Secrets Manager recovery-window deletion is intentionally left to the incident/onboarding
      // operator so a partial-bootstrap investigation retains the credential-creation evidence.
      process.stderr.write(
        `Provisioning stopped after creating edutex/tenants/${tenantId}/cognito/browser-client-secret; quarantine or schedule deletion after investigation.\n`,
      );
    }
    throw error;
  }

  process.stdout.write(
    `School created. Tenant ${tenantId}; campus ${campusId}; academic year ${academicYearId}; ` +
      `initial administrator invitation sent to ${options.adminEmail}.\n`,
  );
}

try {
  await bootstrap();
} finally {
  await closeDatabase();
}

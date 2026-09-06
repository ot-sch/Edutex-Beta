/**
 * @fileoverview Implements tenant administration for authentication policy, identity providers, directory-role mappings and module publication.
 *
 * @remarks
 * Direct links: `node:crypto`, `@aws-sdk/client-cognito-identity-provider`, `@aws-sdk/client-secrets-manager`, `../../config.js`, `../auth/identity-repository.js`.
 * Security: Maintained source boundary; changes require strict type, test, lint, format and security review.
 */

import { createHash } from 'node:crypto';

import {
  CognitoIdentityProviderClient,
  CreateIdentityProviderCommand,
  DescribeUserPoolCommand,
  DescribeUserPoolClientCommand,
  SetUserPoolMfaConfigCommand,
  UpdateIdentityProviderCommand,
  UpdateUserPoolCommand,
  UpdateUserPoolClientCommand,
  type IdentityProviderTypeType,
  type UpdateUserPoolCommandInput,
} from '@aws-sdk/client-cognito-identity-provider';
import {
  CreateSecretCommand,
  DescribeSecretCommand,
  PutSecretValueCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';

import type { ApplicationConfiguration } from '../../config.js';
import type { AuthRuntime } from '../auth/identity-repository.js';

export interface IdentityProviderInput {
  readonly tenantId: string;
  readonly tenantSlug: string;
  readonly providerKey: string;
  readonly providerType: 'microsoft' | 'google' | 'oidc' | 'saml';
  readonly issuerUrl?: string;
  readonly metadataUrl?: string;
  readonly clientId?: string;
  readonly clientSecret?: string;
  readonly scopes: readonly string[];
  readonly attributeMapping: Readonly<Record<string, string>>;
}

export interface ConfiguredIdentityProvider {
  readonly cognitoProviderName: string;
  readonly clientSecretArn?: string;
}

/** Returns the tenant-bounded Secrets Manager name allowed by the ECS task-role policy. */
export function identityProviderSecretName(tenantId: string, providerKey: string): string {
  return `edutex/tenants/${tenantId}/identity/${providerKey}/client-secret`;
}

/** Configures Cognito federation while keeping provider secrets in Secrets Manager. */
export class CognitoTenantIdentityService {
  private readonly cognito: CognitoIdentityProviderClient;
  private readonly secrets: SecretsManagerClient;

  /** Constructs `cognito-identity-service` and assembles the AWS/resource relationships defined in this class without exposing a public origin or broader credentials. It receives `configuration`. It uses only the local values shown in its body. */ public constructor(
    private readonly configuration: ApplicationConfiguration,
  ) {
    this.cognito = new CognitoIdentityProviderClient({ region: configuration.awsRegion });
    this.secrets = new SecretsManagerClient({ region: configuration.awsRegion });
  }

  /**
   * Creates or updates one tenant-scoped Cognito federation provider, rotates any supplied client
   * secret through Secrets Manager, and registers it as supported on the tenant app client. This
   * does not publish the provider in Edutex: the database status and mapping gate remain the
   * authoritative BFF controls for starting a federated transaction.
   */
  public async configure(
    runtime: AuthRuntime,
    input: IdentityProviderInput,
  ): Promise<ConfiguredIdentityProvider> {
    const cognitoProviderName = this.providerName(input.tenantSlug, input.providerKey);
    const clientSecretArn = input.clientSecret
      ? await this.storeClientSecret(input.tenantId, input.providerKey, input.clientSecret)
      : undefined;
    const providerType: IdentityProviderTypeType =
      input.providerType === 'google' ? 'Google' : input.providerType === 'saml' ? 'SAML' : 'OIDC';
    const providerDetails = this.providerDetails(input);
    const commandInput = {
      UserPoolId: runtime.cognitoUserPoolId,
      ProviderName: cognitoProviderName,
      ProviderDetails: providerDetails,
      AttributeMapping: input.attributeMapping,
    };

    try {
      await this.cognito.send(
        new CreateIdentityProviderCommand({ ...commandInput, ProviderType: providerType }),
      );
    } catch (error) {
      if ((error as { name?: string }).name !== 'DuplicateProviderException') throw error;
      await this.cognito.send(new UpdateIdentityProviderCommand(commandInput));
    }
    await this.enableOnAppClient(runtime, cognitoProviderName);
    return { cognitoProviderName, ...(clientSecretArn ? { clientSecretArn } : {}) };
  }

  /**
   * Applies local first-factor and MFA policy to the tenant-owned Cognito pool.
   * A verified passkey can satisfy required MFA, while password users receive a
   * managed-login TOTP challenge. Existing delivery and trigger configuration is
   * copied forward because Cognito update operations replace omitted settings.
   */
  public async applyAuthenticationPolicy(
    runtime: AuthRuntime,
    policy: Readonly<{
      passwordEnabled: boolean;
      passkeyEnabled: boolean;
      totpMode: 'disabled' | 'optional' | 'required_for_password';
    }>,
  ): Promise<void> {
    const described = await this.cognito.send(
      new DescribeUserPoolCommand({ UserPoolId: runtime.cognitoUserPoolId }),
    );
    const pool = described.UserPool;
    if (!pool) throw new Error('Cognito user pool could not be loaded.');
    const allowedFirstAuthFactors = [
      ...(policy.passwordEnabled ? (['PASSWORD'] as const) : []),
      ...(policy.passkeyEnabled ? (['WEB_AUTHN'] as const) : []),
    ];
    // Cognito requires at least one pool-level factor. When all local methods are
    // hidden, PASSWORD remains configured but the BFF issues no local transaction.
    if (allowedFirstAuthFactors.length === 0) allowedFirstAuthFactors.push('PASSWORD');
    const mfaConfiguration =
      policy.passkeyEnabled || policy.totpMode === 'required_for_password'
        ? ('ON' as const)
        : policy.totpMode === 'disabled'
          ? ('OFF' as const)
          : ('OPTIONAL' as const);
    const update: UpdateUserPoolCommandInput = {
      UserPoolId: runtime.cognitoUserPoolId,
      Policies: {
        ...pool.Policies,
        SignInPolicy: { AllowedFirstAuthFactors: allowedFirstAuthFactors },
      },
      MfaConfiguration: mfaConfiguration,
    };
    if (pool.AccountRecoverySetting) update.AccountRecoverySetting = pool.AccountRecoverySetting;
    if (pool.AdminCreateUserConfig) update.AdminCreateUserConfig = pool.AdminCreateUserConfig;
    if (pool.AutoVerifiedAttributes) update.AutoVerifiedAttributes = pool.AutoVerifiedAttributes;
    if (pool.DeletionProtection) update.DeletionProtection = pool.DeletionProtection;
    if (pool.DeviceConfiguration) update.DeviceConfiguration = pool.DeviceConfiguration;
    if (pool.EmailConfiguration) update.EmailConfiguration = pool.EmailConfiguration;
    if (pool.LambdaConfig) update.LambdaConfig = pool.LambdaConfig;
    if (pool.Name) update.PoolName = pool.Name;
    if (pool.SmsConfiguration) update.SmsConfiguration = pool.SmsConfiguration;
    if (pool.UserAttributeUpdateSettings)
      update.UserAttributeUpdateSettings = pool.UserAttributeUpdateSettings;
    if (pool.UserPoolAddOns) update.UserPoolAddOns = pool.UserPoolAddOns;
    if (pool.UserPoolTags) update.UserPoolTags = pool.UserPoolTags;
    if (pool.UserPoolTier) update.UserPoolTier = pool.UserPoolTier;
    if (pool.VerificationMessageTemplate)
      update.VerificationMessageTemplate = pool.VerificationMessageTemplate;
    await this.cognito.send(new UpdateUserPoolCommand(update));
    await this.cognito.send(
      new SetUserPoolMfaConfigCommand({
        UserPoolId: runtime.cognitoUserPoolId,
        MfaConfiguration: mfaConfiguration,
        ...(policy.totpMode === 'disabled'
          ? {}
          : { SoftwareTokenMfaConfiguration: { Enabled: true } }),
        WebAuthnConfiguration: {
          // Registration and authentication occur on managed login, so the Cognito domain is the
          // WebAuthn relying party. Portal-host RP IDs are only valid for an SDK-hosted ceremony.
          RelyingPartyId: new URL(
            runtime.cognitoDomain.includes('://')
              ? runtime.cognitoDomain
              : `https://${runtime.cognitoDomain}`,
          ).hostname,
          UserVerification: 'required',
          FactorConfiguration: policy.passkeyEnabled
            ? 'MULTI_FACTOR_WITH_USER_VERIFICATION'
            : 'SINGLE_FACTOR',
        },
      }),
    );
  }

  /** Produces a readable, length-bounded and collision-resistant Cognito provider name. */
  private providerName(tenantSlug: string, providerKey: string): string {
    const readable = `${tenantSlug}-${providerKey}`.replace(/[^A-Za-z0-9_-]/g, '-');
    const digest = createHash('sha256').update(readable).digest('hex').slice(0, 8);
    return `edutex-${readable.slice(0, 22)}-${digest}`;
  }

  /** Validates provider-specific prerequisites and maps the approved input to Cognito detail keys. */
  private providerDetails(input: IdentityProviderInput): Record<string, string> {
    if (input.providerType === 'saml') {
      if (!input.metadataUrl) throw new Error('SAML metadata URL is required.');
      return { MetadataURL: input.metadataUrl, IDPSignout: 'true' };
    }
    if (!input.clientId || !input.clientSecret) {
      throw new Error('OIDC/Google client credentials are required.');
    }
    if (input.providerType === 'google') {
      return {
        client_id: input.clientId,
        client_secret: input.clientSecret,
        authorize_scopes: input.scopes.join(' '),
      };
    }
    if (!input.issuerUrl) throw new Error('OIDC issuer URL is required.');
    return {
      attributes_request_method: 'GET',
      authorize_scopes: input.scopes.join(' '),
      client_id: input.clientId,
      client_secret: input.clientSecret,
      oidc_issuer: input.issuerUrl,
    };
  }

  /**
   * Creates or versions the tenant/provider client secret and returns only its ARN. The plaintext
   * is sent directly to Secrets Manager and is never persisted in PostgreSQL.
   */
  private async storeClientSecret(
    tenantId: string,
    providerKey: string,
    secretValue: string,
  ): Promise<string> {
    // This prefix is intentionally identical to the task-role resource policy in the CDK stack.
    // Keeping each school below edutex/tenants/<tenant-id> prevents an SSO setup request from
    // writing outside the tenant identity-secret namespace.
    const name = identityProviderSecretName(tenantId, providerKey);
    try {
      const created = await this.secrets.send(
        new CreateSecretCommand({
          Name: name,
          Description: `Edutex identity-provider secret for tenant ${tenantId}`,
          SecretString: secretValue,
          Tags: [
            { Key: 'edutex:tenant-id', Value: tenantId },
            { Key: 'edutex:purpose', Value: 'identity-provider' },
          ],
        }),
      );
      if (!created.ARN) throw new Error('Secrets Manager did not return an ARN.');
      return created.ARN;
    } catch (error) {
      if ((error as { name?: string }).name !== 'ResourceExistsException') throw error;
      await this.secrets.send(
        new PutSecretValueCommand({ SecretId: name, SecretString: secretValue }),
      );
      const existing = await this.secrets.send(new DescribeSecretCommand({ SecretId: name }));
      if (!existing.ARN)
        throw new Error('Secrets Manager did not return an ARN.', { cause: error });
      return existing.ARN;
    }
  }

  /** Adds a provider to the existing app client while copying every security-sensitive client setting. */
  private async enableOnAppClient(runtime: AuthRuntime, providerName: string): Promise<void> {
    const result = await this.cognito.send(
      new DescribeUserPoolClientCommand({
        UserPoolId: runtime.cognitoUserPoolId,
        ClientId: runtime.cognitoClientId,
      }),
    );
    const client = result.UserPoolClient;
    if (!client) throw new Error('Cognito app client could not be loaded.');
    const supportedProviders = [
      ...new Set([...(client.SupportedIdentityProviders ?? ['COGNITO']), providerName]),
    ];
    await this.cognito.send(
      new UpdateUserPoolClientCommand({
        UserPoolId: runtime.cognitoUserPoolId,
        ClientId: runtime.cognitoClientId,
        AccessTokenValidity: client.AccessTokenValidity,
        AllowedOAuthFlows: client.AllowedOAuthFlows,
        AllowedOAuthFlowsUserPoolClient: client.AllowedOAuthFlowsUserPoolClient,
        AllowedOAuthScopes: client.AllowedOAuthScopes,
        AuthSessionValidity: client.AuthSessionValidity,
        CallbackURLs: client.CallbackURLs,
        EnablePropagateAdditionalUserContextData: client.EnablePropagateAdditionalUserContextData,
        EnableTokenRevocation: client.EnableTokenRevocation,
        ExplicitAuthFlows: client.ExplicitAuthFlows,
        IdTokenValidity: client.IdTokenValidity,
        LogoutURLs: client.LogoutURLs,
        PreventUserExistenceErrors: client.PreventUserExistenceErrors,
        ReadAttributes: client.ReadAttributes,
        RefreshTokenRotation: client.RefreshTokenRotation,
        RefreshTokenValidity: client.RefreshTokenValidity,
        SupportedIdentityProviders: supportedProviders,
        TokenValidityUnits: client.TokenValidityUnits,
        // Cognito requires federated destination attributes to be writable on this app client.
        // The OAuth server issues only OIDC scopes (not aws.cognito.signin.user.admin), so the
        // browser cannot call token-authorized profile mutation APIs with its returned token.
        WriteAttributes: client.WriteAttributes,
      }),
    );
  }
}

/**
 * @fileoverview Implements the authentication/session boundary that connects Cognito OAuth, tenant identity resolution, opaque server-side sessions and protected Fastify requests.
 *
 * @remarks
 * Direct links: `node:crypto`, `jose`, `zod`, `../../shared/errors.js`, `../../shared/encoding.js`, `./identity-repository.js`.
 * Security: Authentication/session security boundary; changes require negative tests for replay, binding, MFA and unauthenticated access.
 */

import { createHash } from 'node:crypto';

import {
  CognitoIdentityProviderClient,
  GetUserPoolMfaConfigCommand,
  type GetUserPoolMfaConfigCommandOutput,
} from '@aws-sdk/client-cognito-identity-provider';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { z } from 'zod';

import { ApplicationError } from '../../shared/errors.js';
import { randomToken } from '../../shared/encoding.js';
import type { AuthRuntime } from './identity-repository.js';

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive(),
  id_token: z.string().min(1),
  // A refresh token can be present in Cognito's authorization-code response. It is parsed only so
  // malformed responses fail closed, then discarded immediately; Edutex issues its own opaque
  // device session and never persists or sends this token to the browser.
  refresh_token: z.string().min(1).optional(),
  token_type: z.literal('Bearer'),
});

export interface AuthorizationTransactionMaterial {
  readonly state: string;
  readonly stateHash: string;
  readonly nonce: string;
  readonly codeVerifier: string;
  readonly codeChallenge: string;
}

/** Returns the tenant-specific Secrets Manager name created by the school bootstrap task. */
export function cognitoBrowserClientSecretName(tenantId: string): string {
  return `edutex/tenants/${tenantId}/cognito/browser-client-secret`;
}

/** Encodes confidential-client credentials for Cognito's `client_secret_basic` token endpoint. */
export function clientSecretBasicAuthorization(clientId: string, clientSecret: string): string {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`, 'utf8').toString('base64')}`;
}

/**
 * Retrieves the confidential OAuth client secret directly into backend memory for one code
 * exchange. The value is neither persisted in PostgreSQL nor returned to the browser.
 */
async function readCognitoBrowserClientSecret(
  runtime: AuthRuntime,
  region: string,
): Promise<string> {
  const client = new SecretsManagerClient({ region });
  try {
    let result;
    try {
      result = await client.send(
        new GetSecretValueCommand({
          SecretId: cognitoBrowserClientSecretName(runtime.tenantId),
          VersionStage: 'AWSCURRENT',
        }),
      );
    } catch {
      // Do not forward provider exception names/details; the server request log still captures the
      // request ID while the browser receives one stable availability error.
      throw new ApplicationError(
        503,
        'IDENTITY_CLIENT_SECRET_UNAVAILABLE',
        'Sign-in is temporarily unavailable.',
      );
    }
    if (!result.SecretString || result.SecretString.length > 4096) {
      throw new ApplicationError(
        503,
        'IDENTITY_CLIENT_SECRET_UNAVAILABLE',
        'Sign-in is temporarily unavailable.',
      );
    }
    return result.SecretString;
  } finally {
    client.destroy();
  }
}

/** Generates OAuth state, OIDC nonce and RFC 7636 PKCE material. */
export function createAuthorizationMaterial(): AuthorizationTransactionMaterial {
  const state = randomToken(32);
  const codeVerifier = randomToken(64);
  return {
    state,
    stateHash: createHash('sha256').update(state).digest('base64url'),
    nonce: randomToken(32),
    codeVerifier,
    codeChallenge: createHash('sha256').update(codeVerifier).digest('base64url'),
  };
}

/** Normalises a configured Cognito domain and fails closed if it is not HTTPS. */
function cognitoBaseUrl(domain: string): URL {
  const url = new URL(domain.includes('://') ? domain : `https://${domain}`);
  if (url.protocol !== 'https:') {
    throw new ApplicationError(
      500,
      'IDENTITY_CONFIGURATION_INVALID',
      'Identity service is unavailable.',
    );
  }
  return url;
}

/** Builds a Cognito managed-login authorization URL for a tenant-approved provider. */
export function buildAuthorizationUrl(
  runtime: AuthRuntime,
  input: Readonly<{
    callbackUrl: string;
    state: string;
    nonce: string;
    codeChallenge: string;
    cognitoProviderName: string;
    stepUp: boolean;
  }>,
): string {
  const url = new URL('/oauth2/authorize', cognitoBaseUrl(runtime.cognitoDomain));
  url.search = new URLSearchParams({
    client_id: runtime.cognitoClientId,
    code_challenge: input.codeChallenge,
    code_challenge_method: 'S256',
    identity_provider: input.cognitoProviderName,
    nonce: input.nonce,
    redirect_uri: input.callbackUrl,
    response_type: 'code',
    scope: 'openid email profile',
    state: input.state,
    ...(input.stepUp ? { prompt: 'login' } : {}),
  }).toString();
  return url.toString();
}

/**
 * Builds the managed-login passkey-registration URL as a fresh PKCE transaction. Cognito permits
 * only an already authenticated user to open this page; the BFF callback then re-verifies the
 * resulting authorization code and replaces the current device session.
 */
export function buildPasskeyRegistrationUrl(
  runtime: AuthRuntime,
  input: Readonly<{
    callbackUrl: string;
    state: string;
    nonce: string;
    codeChallenge: string;
  }>,
): string {
  const url = new URL('/passkeys/add', cognitoBaseUrl(runtime.cognitoDomain));
  url.search = new URLSearchParams({
    client_id: runtime.cognitoClientId,
    code_challenge: input.codeChallenge,
    code_challenge_method: 'S256',
    nonce: input.nonce,
    redirect_uri: input.callbackUrl,
    response_type: 'code',
    scope: 'openid email profile',
    state: input.state,
  }).toString();
  return url.toString();
}

/** Exchanges an authorization code server-side; no Cognito token reaches browser storage. */
export async function exchangeAuthorizationCode(
  runtime: AuthRuntime,
  code: string,
  codeVerifier: string,
  callbackUrl: string,
  region: string,
): Promise<z.infer<typeof tokenResponseSchema>> {
  const tokenUrl = new URL('/oauth2/token', cognitoBaseUrl(runtime.cognitoDomain));
  const clientSecret = await readCognitoBrowserClientSecret(runtime, region);
  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      authorization: clientSecretBasicAuthorization(runtime.cognitoClientId, clientSecret),
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: runtime.cognitoClientId,
      code,
      code_verifier: codeVerifier,
      grant_type: 'authorization_code',
      redirect_uri: callbackUrl,
    }),
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new ApplicationError(
      401,
      'AUTHORIZATION_CODE_REJECTED',
      'Sign-in could not be completed.',
    );
  }
  return tokenResponseSchema.parse(await response.json());
}

/** Validates signature, issuer, audience, expiry and the transaction-bound nonce. */
export async function verifyIdentityToken(
  runtime: AuthRuntime,
  idToken: string,
  expectedNonce: string,
  region: string,
): Promise<JWTPayload> {
  const issuer = `https://cognito-idp.${region}.amazonaws.com/${runtime.cognitoUserPoolId}`;
  const jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`), {
    timeoutDuration: 5_000,
    cooldownDuration: 30_000,
  });
  const result = await jwtVerify(idToken, jwks, {
    audience: runtime.cognitoClientId,
    issuer,
    maxTokenAge: '10 minutes',
  });
  if (result.payload['nonce'] !== expectedNonce) {
    throw new ApplicationError(401, 'OIDC_NONCE_MISMATCH', 'Sign-in could not be completed.');
  }
  return result.payload;
}

/**
 * Compares the database login policy with Cognito's live MFA/passkey configuration. This pure
 * predicate is deliberately strict: a missing field, a different relying-party ID or an optional
 * pool MFA mode is configuration drift and therefore cannot establish a high-assurance session.
 */
export function localMfaConfigurationMatchesPolicy(
  runtime: AuthRuntime,
  configuration: GetUserPoolMfaConfigCommandOutput,
): boolean {
  if (!runtime.passwordEnabled && !runtime.passkeyEnabled) return false;

  const passwordPolicyMatches =
    !runtime.passwordEnabled ||
    (configuration.MfaConfiguration === 'ON' &&
      runtime.totpMode === 'required_for_password' &&
      configuration.SoftwareTokenMfaConfiguration?.Enabled === true);
  const expectedRelyingPartyId = cognitoBaseUrl(runtime.cognitoDomain).hostname;
  const passkeyPolicyMatches =
    !runtime.passkeyEnabled ||
    (configuration.MfaConfiguration === 'ON' &&
      configuration.WebAuthnConfiguration?.UserVerification === 'required' &&
      configuration.WebAuthnConfiguration.FactorConfiguration ===
        'MULTI_FACTOR_WITH_USER_VERIFICATION' &&
      configuration.WebAuthnConfiguration.RelyingPartyId === expectedRelyingPartyId);
  return passwordPolicyMatches && passkeyPolicyMatches;
}

/**
 * Reads Cognito's authoritative pool configuration during a local OAuth callback and fails closed
 * when it no longer matches the school policy stored in PostgreSQL. A successful return means that
 * managed login required TOTP for password sign-in and/or a user-verifying MFA passkey; it does not
 * infer assurance from the button that started the flow or from a browser-provided value.
 */
export async function requireLiveLocalMfaPolicy(
  runtime: AuthRuntime,
  region: string,
): Promise<readonly string[]> {
  const client = new CognitoIdentityProviderClient({ region });
  try {
    let configuration;
    try {
      configuration = await client.send(
        new GetUserPoolMfaConfigCommand({ UserPoolId: runtime.cognitoUserPoolId }),
      );
    } catch {
      throw new ApplicationError(
        503,
        'IDENTITY_ASSURANCE_CONFIGURATION_UNAVAILABLE',
        'Sign-in is temporarily unavailable while authentication policy is verified.',
      );
    }
    if (!localMfaConfigurationMatchesPolicy(runtime, configuration)) {
      throw new ApplicationError(
        503,
        'IDENTITY_ASSURANCE_CONFIGURATION_DRIFT',
        'Sign-in is temporarily unavailable while the school authentication policy is repaired.',
      );
    }
    return ['cognito:mfa-required'];
  } finally {
    client.destroy();
  }
}

/** Decodes Cognito's documented `[value1,value2]` representation for multi-valued IdP claims. */
function decodeCognitoMultiValue(value: string): string[] | undefined {
  if (!value.startsWith('[') || !value.endsWith(']')) return undefined;
  const encoded = value.slice(1, -1);
  if (!encoded) return [];
  try {
    const values = encoded
      .split(',')
      .map(
        /** Transforms each input item for `decodeCognitoMultiValue` into the derived value or React element consumed by the surrounding collection. It receives `item`. Direct links: `decodeURIComponent`. */ (
          item,
        ) => decodeURIComponent(item),
      );
    return values.length <= 200 &&
      values.every(
        /** Requires every input item to satisfy this validation condition before `decodeCognitoMultiValue` can continue. It receives `item`. It uses only the local values shown in its body. */ (
          item,
        ) => item.length <= 512,
      )
      ? values
      : undefined;
  } catch {
    return undefined;
  }
}

/** Retains only bounded identity claims needed for role mapping. */
export function selectDirectoryClaims(payload: JWTPayload): Readonly<Record<string, unknown>> {
  const selected: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (!/^[A-Za-z0-9_:./-]{1,80}$/.test(key)) continue;
    if (typeof value === 'string' && value.length <= 2048) {
      const multiValue = key.startsWith('custom:') ? decodeCognitoMultiValue(value) : undefined;
      selected[key] = multiValue ?? value;
    }
    if (typeof value === 'number' || typeof value === 'boolean') selected[key] = value;
    if (
      Array.isArray(value) &&
      value.length <= 200 &&
      value.every(
        /** Requires every input item to satisfy this validation condition before `selectDirectoryClaims` can continue. It receives `item`. It uses only the local values shown in its body. */ (
          item,
        ) => typeof item === 'string' && item.length <= 512,
      )
    ) {
      selected[key] = value;
    }
  }
  return selected;
}

/** Extracts authentication-method references without trusting the requested UI button. */
export function authenticationMethods(payload: JWTPayload, providerKey: string): string[] {
  const methods = new Set<string>([`provider:${providerKey}`]);
  for (const claimName of ['amr', 'acr', 'custom:authentication_assurance']) {
    const claim = payload[claimName];
    if (typeof claim === 'string' && claim.length <= 256) methods.add(claim);
    if (Array.isArray(claim)) {
      for (const method of claim) {
        if (typeof method === 'string' && method.length <= 256) methods.add(method);
      }
    }
  }
  return [...methods].slice(0, 10);
}

/**
 * Confirms that Cognito's signed federated-identity record names the same provider that the
 * one-time server transaction selected. Exact matching prevents a valid pool token from being
 * evaluated against a different provider's directory-role rules.
 */
export function federatedProviderMatches(
  payload: JWTPayload,
  expectedProviderName: string,
): boolean {
  const identities = payload['identities'];
  if (!Array.isArray(identities) || identities.length === 0 || identities.length > 10) return false;
  return identities.some(
    /** Matches one bounded Cognito identity object to the provider fixed in the server-side OAuth transaction. It receives `identity`. */ (
      identity,
    ) => {
      if (typeof identity !== 'object' || identity === null) return false;
      const providerName = (identity as Readonly<Record<string, unknown>>)['providerName'];
      return providerName === expectedProviderName;
    },
  );
}

/** Recognizes a recent phishing-resistant or multi-factor Cognito authentication. */
export function mfaWasSatisfied(methods: readonly string[]): boolean {
  const accepted = new Set([
    'fido',
    'fido2',
    'hwk',
    'mfa',
    'otp',
    'passkey',
    'software-token-mfa',
    'software_token',
    'totp',
    'webauthn',
  ]);
  return methods.some(
    /** Reports whether at least one input item satisfies this authorization/validation condition for `mfaWasSatisfied`. It receives `method`. Direct links: `accepted.has`, `method.toLowerCase`. */ (
      method,
    ) => accepted.has(method.toLowerCase()),
  );
}

/** Distinguishes phishing-resistant local authentication for policy enforcement. */
export function passkeyWasUsed(methods: readonly string[]): boolean {
  return methods.some(
    /** Reports whether at least one input item satisfies this authorization/validation condition for `passkeyWasUsed`. It receives `method`. Direct links: `['fido', 'fido2', 'hwk', 'passkey', 'webauthn`, `method.toLowerCase`. */ (
      method,
    ) => ['fido', 'fido2', 'hwk', 'passkey', 'webauthn'].includes(method.toLowerCase()),
  );
}

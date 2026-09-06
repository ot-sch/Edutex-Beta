/**
 * @fileoverview Regression evidence for cognito; it verifies the production behavior owned by the adjacent source module.
 *
 * @remarks
 * Direct links: `node:crypto`, `vitest`, `./cognito.js`.
 * Security: Authentication/session security boundary; changes require negative tests for replay, binding, MFA and unauthenticated access.
 */

import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  authenticationMethods,
  buildPasskeyRegistrationUrl,
  clientSecretBasicAuthorization,
  cognitoBrowserClientSecretName,
  createAuthorizationMaterial,
  federatedProviderMatches,
  localMfaConfigurationMatchesPolicy,
  mfaWasSatisfied,
  passkeyWasUsed,
  selectDirectoryClaims,
} from './cognito.js';

const runtime = {
  tenantId: '00000000-0000-4000-8000-000000000001',
  cognitoUserPoolId: 'ap-southeast-2_example',
  cognitoClientId: 'client-id',
  cognitoDomain: 'edutex-example.auth.ap-southeast-2.amazoncognito.com',
  passwordEnabled: true,
  passkeyEnabled: true,
  totpMode: 'required_for_password' as const,
  sessionIdleMinutes: 20,
  sessionAbsoluteHours: 12,
  stepUpMinutes: 10,
  providers: {},
};

describe('OIDC transaction material', /** Defines the `OIDC transaction material` regression-test suite and groups evidence for the adjacent production module. Direct links: `it`. */ () => {
  it('creates independent state, nonce and PKCE values for every attempt', /** Verifies the `creates independent state, nonce and PKCE values for every attempt` case and fails the quality gate when the expected security/functional invariant changes. Direct links: `createAuthorizationMaterial`, `expect(first.state).not.toBe`, `expect`, `expect(first.nonce).not.toBe`, `expect(first.codeVerifier).not.toBe`. */ () => {
    const first = createAuthorizationMaterial();
    const second = createAuthorizationMaterial();
    expect(first.state).not.toBe(second.state);
    expect(first.nonce).not.toBe(second.nonce);
    expect(first.codeVerifier).not.toBe(second.codeVerifier);
    expect(first.stateHash).toBe(createHash('sha256').update(first.state).digest('base64url'));
    expect(first.codeChallenge).toBe(
      createHash('sha256').update(first.codeVerifier).digest('base64url'),
    );
  });

  it('keeps confidential OAuth client credentials in the tenant secret namespace', /** Verifies the exact tenant secret path and Basic encoding used only by the backend token exchange. Direct links: `cognitoBrowserClientSecretName`, `clientSecretBasicAuthorization`, `expect`. */ () => {
    expect(cognitoBrowserClientSecretName(runtime.tenantId)).toBe(
      `edutex/tenants/${runtime.tenantId}/cognito/browser-client-secret`,
    );
    expect(clientSecretBasicAuthorization('client-id', 'client-secret')).toBe(
      `Basic ${Buffer.from('client-id:client-secret').toString('base64')}`,
    );
  });
});

describe('managed-login passkey registration', /** Defines the `managed-login passkey registration` regression-test suite and groups evidence for the adjacent production module. Direct links: `it`. */ () => {
  it('keeps the registration ceremony on the Cognito relying-party domain', /** Verifies the `keeps the registration ceremony on the Cognito relying-party domain` case and fails the quality gate when the expected security/functional invariant changes. Direct links: `buildPasskeyRegistrationUrl`, `expect(url.hostname).toBe`, `expect`, `expect(url.pathname).toBe`, `expect(url.searchParams.get('response_type'))`. */ () => {
    const url = new URL(
      buildPasskeyRegistrationUrl(runtime, {
        callbackUrl: 'https://portal.school.example/api/v1/auth/callback',
        state: 'state-value',
        nonce: 'nonce-value',
        codeChallenge: 'challenge-value',
      }),
    );
    expect(url.hostname).toBe(runtime.cognitoDomain);
    expect(url.pathname).toBe('/passkeys/add');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  });
});

describe('authentication-method assurance', /** Defines the `authentication-method assurance` regression-test suite and groups evidence for the adjacent production module. Direct links: `it`. */ () => {
  it('recognises passkeys as phishing-resistant MFA', /** Verifies the `recognises passkeys as phishing-resistant MFA` case and fails the quality gate when the expected security/functional invariant changes. Direct links: `expect(passkeyWasUsed(['local', 'webauthn']))`, `expect`, `passkeyWasUsed`, `expect(mfaWasSatisfied(['local', 'webauthn'])`, `mfaWasSatisfied`. */ () => {
    expect(passkeyWasUsed(['local', 'webauthn'])).toBe(true);
    expect(mfaWasSatisfied(['local', 'webauthn'])).toBe(true);
  });

  it('does not treat a password-only claim as MFA', /** Verifies the `does not treat a password-only claim as MFA` case and fails the quality gate when the expected security/functional invariant changes. Direct links: `expect(passkeyWasUsed(['local', 'pwd'])).toBe`, `expect`, `passkeyWasUsed`, `expect(mfaWasSatisfied(['local', 'pwd'])).toB`, `mfaWasSatisfied`. */ () => {
    expect(passkeyWasUsed(['local', 'pwd'])).toBe(false);
    expect(mfaWasSatisfied(['local', 'pwd'])).toBe(false);
  });

  it('does not infer MFA from an identity-provider display key', /** Verifies the `does not infer MFA from an identity-provider display key` case and fails the quality gate when the expected security/functional invariant changes. Direct links: `authenticationMethods`, `expect(methods).toEqual`, `expect`, `expect(mfaWasSatisfied(methods)).toBe`, `mfaWasSatisfied`. */ () => {
    const methods = authenticationMethods({}, 'passkey-consultancy');
    expect(methods).toEqual(['provider:passkey-consultancy']);
    expect(mfaWasSatisfied(methods)).toBe(false);
  });

  it('accepts only a live Cognito policy that requires TOTP and user-verifying MFA passkeys', /** Verifies that local assurance comes from Cognito's current enforcement state rather than a requested login button or stale database policy. Direct links: `localMfaConfigurationMatchesPolicy`, `expect`. */ () => {
    expect(
      localMfaConfigurationMatchesPolicy(runtime, {
        MfaConfiguration: 'ON',
        SoftwareTokenMfaConfiguration: { Enabled: true },
        WebAuthnConfiguration: {
          RelyingPartyId: runtime.cognitoDomain,
          UserVerification: 'required',
          FactorConfiguration: 'MULTI_FACTOR_WITH_USER_VERIFICATION',
        },
        $metadata: {},
      }),
    ).toBe(true);
  });

  it('rejects optional MFA, disabled TOTP, a weak passkey factor or a different relying party', /** Exercises the fail-closed branches that prevent configuration drift from becoming an authenticated session. Direct links: `localMfaConfigurationMatchesPolicy`, `expect`. */ () => {
    const base = {
      MfaConfiguration: 'ON' as const,
      SoftwareTokenMfaConfiguration: { Enabled: true },
      WebAuthnConfiguration: {
        RelyingPartyId: runtime.cognitoDomain,
        UserVerification: 'required' as const,
        FactorConfiguration: 'MULTI_FACTOR_WITH_USER_VERIFICATION' as const,
      },
      $metadata: {},
    };
    expect(
      localMfaConfigurationMatchesPolicy(runtime, { ...base, MfaConfiguration: 'OPTIONAL' }),
    ).toBe(false);
    expect(
      localMfaConfigurationMatchesPolicy(runtime, {
        ...base,
        SoftwareTokenMfaConfiguration: { Enabled: false },
      }),
    ).toBe(false);
    expect(
      localMfaConfigurationMatchesPolicy(runtime, {
        ...base,
        WebAuthnConfiguration: {
          ...base.WebAuthnConfiguration,
          FactorConfiguration: 'SINGLE_FACTOR',
        },
      }),
    ).toBe(false);
    expect(
      localMfaConfigurationMatchesPolicy(runtime, {
        ...base,
        WebAuthnConfiguration: {
          ...base.WebAuthnConfiguration,
          RelyingPartyId: 'different.auth.ap-southeast-2.amazoncognito.com',
        },
      }),
    ).toBe(false);
  });
});

describe('federated directory claims', /** Defines the `federated directory claims` regression-test suite and groups evidence for the adjacent production module. Direct links: `it`. */ () => {
  it('binds a federated token to the exact provider stored in the OAuth transaction', /** Verifies that a signed pool token cannot be evaluated against another provider's role map. Direct links: `federatedProviderMatches`, `expect`. */ () => {
    const claims = { identities: [{ providerName: 'edutex-acme-microsoft-12345678' }] };
    expect(federatedProviderMatches(claims, 'edutex-acme-microsoft-12345678')).toBe(true);
    expect(federatedProviderMatches(claims, 'edutex-acme-google-87654321')).toBe(false);
    expect(federatedProviderMatches({}, 'edutex-acme-microsoft-12345678')).toBe(false);
  });

  it('decodes Cognito multi-value custom attributes before exact role matching', /** Verifies the `decodes Cognito multi-value custom attributes before exact role matching` case and fails the quality gate when the expected security/functional invariant changes. Direct links: `expect( selectDirectoryClaims({ 'custom:direc`, `expect`, `selectDirectoryClaims`. */ () => {
    expect(
      selectDirectoryClaims({
        'custom:directory_role': '[student,executive%20staff,finance%2Cadmin]',
      }),
    ).toEqual({
      'custom:directory_role': ['student', 'executive staff', 'finance,admin'],
    });
  });

  it('leaves invalid encoded claims as scalar strings so matching fails closed', /** Verifies the `leaves invalid encoded claims as scalar strings so matching fails closed` case and fails the quality gate when the expected security/functional invariant changes. Direct links: `expect(selectDirectoryClaims({ 'custom:direct`, `expect`, `selectDirectoryClaims`. */ () => {
    expect(selectDirectoryClaims({ 'custom:directory_role': '[invalid%XX]' })).toEqual({
      'custom:directory_role': '[invalid%XX]',
    });
  });
});

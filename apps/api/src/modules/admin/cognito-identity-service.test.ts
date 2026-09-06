/**
 * @fileoverview Regression evidence for cognito-identity-service; it verifies the production behavior owned by the adjacent source module.
 *
 * @remarks
 * Direct links: `vitest`, `./cognito-identity-service.js`, `./routes.js`.
 * Security: Assurance code only; it must never be included in runtime bundles.
 */

import { describe, expect, it } from 'vitest';

import { identityProviderSecretName } from './cognito-identity-service.js';
import { identityProviderActivationAllowed, STAGED_IDENTITY_PROVIDER_ENABLED } from './routes.js';

describe('identity-provider secret isolation', /** Defines the `identity-provider secret isolation` regression-test suite and groups evidence for the adjacent production module. Direct links: `it`. */ () => {
  it('keeps every provider secret inside the tenant namespace approved by IAM', /** Verifies the `keeps every provider secret inside the tenant namespace approved by IAM` case and fails the quality gate when the expected security/functional invariant changes. Direct links: `expect(identityProviderSecretName('6b813a41-9`, `expect`, `identityProviderSecretName`. */ () => {
    expect(identityProviderSecretName('6b813a41-90bc-48e5-86e2-b64611b418fc', 'microsoft')).toBe(
      'edutex/tenants/6b813a41-90bc-48e5-86e2-b64611b418fc/identity/microsoft/client-secret',
    );
  });
});

describe('identity-provider publication gate', /** Defines the `identity-provider publication gate` regression-test suite and groups evidence for the adjacent production module. Direct links: `it`. */ () => {
  it('keeps a provider disabled until at least one approved role mapping exists', /** Verifies the `keeps a provider disabled until at least one approved role mapping exists` case and fails the quality gate when the expected security/functional invariant changes. Direct links: `expect(STAGED_IDENTITY_PROVIDER_ENABLED).toBe`, `expect`, `expect(identityProviderActivationAllowed(fals`, `identityProviderActivationAllowed`, `expect(identityProviderActivationAllowed(true`. */ () => {
    expect(STAGED_IDENTITY_PROVIDER_ENABLED).toBe(false);
    expect(identityProviderActivationAllowed(false, 0)).toBe(true);
    expect(identityProviderActivationAllowed(true, 0)).toBe(false);
    expect(identityProviderActivationAllowed(true, 1)).toBe(true);
  });
});

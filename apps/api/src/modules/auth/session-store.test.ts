/**
 * @fileoverview Regression evidence for session-store; it verifies the production behavior owned by the adjacent source module.
 *
 * @remarks
 * Direct links: `@edutex/contracts`, `vitest`, `../../config.js`, `./session-store.js`, `/app/`.
 * Security: Authentication/session security boundary; changes require negative tests for replay, binding, MFA and unauthenticated access.
 */

import { sessionUserSchema } from '@edutex/contracts';
import { describe, expect, it } from 'vitest';

import { loadConfiguration } from '../../config.js';
import { createStores, type StoredSession } from './session-store.js';

const user = sessionUserSchema.parse({
  id: '5a83c5b7-0460-4896-8fcc-f02d2eb1f779',
  tenantId: '33c622ff-57c3-438c-8e2b-8a0db11fbf3b',
  displayName: 'Test Administrator',
  email: 'admin@example.test',
  category: 'it_staff',
  campusIds: [],
  roleNames: ['System Administrator'],
  permissions: ['dashboard:view'],
  enabledModules: ['dashboard'],
  authenticationMethods: ['passkey'],
  mfaSatisfiedAt: '2026-08-08T10:00:00.000Z',
});

/** Implements `storedSession` for regression evidence for session-store; it verifies the production behavior owned by the adjacent source module. It receives `sessionHash`, `deviceHash`. It uses only the local values shown in its body. */ function storedSession(
  sessionHash: string,
  deviceHash: string,
): StoredSession {
  return {
    sessionHash,
    deviceHash,
    userAgentHash: `agent-${deviceHash}`,
    csrfToken: `csrf-${deviceHash}-012345678901234567890123456789`,
    user,
    identityVersion: 1,
    createdAtEpoch: 100,
    lastSeenAtEpoch: 100,
    identityCheckedAtEpoch: 100,
    idleExpiresAtEpoch: 500,
    absoluteExpiresAtEpoch: 1000,
    expiresAtEpoch: 500,
  };
}

describe('device session store', /** Defines the `device session store` regression-test suite and groups evidence for the adjacent production module. Direct links: `it`. */ () => {
  it('keeps sessions for the same user isolated by independent opaque keys', /** Verifies the `keeps sessions for the same user isolated by independent opaque keys` case and fails the quality gate when the expected security/functional invariant changes. Direct links: `loadConfiguration`, `createStores`, `sessionStore.create`, `storedSession`, `sessionStore.delete`. */ async () => {
    const configuration = loadConfiguration({ NODE_ENV: 'test', SESSION_STORE: 'memory' });
    const { sessionStore } = createStores(configuration);
    await sessionStore.create(storedSession('session-a', 'device-a'));
    await sessionStore.create(storedSession('session-b', 'device-b'));

    await sessionStore.delete('session-a');
    expect(await sessionStore.get('session-a')).toBeUndefined();
    expect((await sessionStore.get('session-b'))?.deviceHash).toBe('device-b');
  });

  it('updates idle expiry without changing a session absolute limit', /** Verifies the `updates idle expiry without changing a session absolute limit` case and fails the quality gate when the expected security/functional invariant changes. Direct links: `loadConfiguration`, `createStores`, `sessionStore.create`, `storedSession`, `sessionStore.touch`. */ async () => {
    const configuration = loadConfiguration({ NODE_ENV: 'test', SESSION_STORE: 'memory' });
    const { sessionStore } = createStores(configuration);
    await sessionStore.create(storedSession('session-c', 'device-c'));
    await sessionStore.touch('session-c', 1200, 1000, 200);
    const updated = await sessionStore.get('session-c');
    expect(updated?.idleExpiresAtEpoch).toBe(1200);
    expect(updated?.absoluteExpiresAtEpoch).toBe(1000);
    expect(updated?.expiresAtEpoch).toBe(1000);
  });

  it('consumes an authorization transaction exactly once with its browser binding', /** Verifies the `consumes an authorization transaction exactly once with its browser binding` case and fails the quality gate when the expected security/functional invariant changes. Direct links: `loadConfiguration`, `createStores`, `transactionStore.create`, `expect((await transactionStore.consume('state`, `expect`. */ async () => {
    const configuration = loadConfiguration({ NODE_ENV: 'test', SESSION_STORE: 'memory' });
    const { transactionStore } = createStores(configuration);
    await transactionStore.create({
      stateHash: 'state-hash',
      tenantId: user.tenantId,
      codeVerifier: 'verifier',
      bindingHash: 'browser-binding-hash',
      nonce: 'nonce',
      providerKey: 'local',
      returnTo: '/app/',
      stepUp: false,
      expiresAtEpoch: 1000,
    });
    expect((await transactionStore.consume('state-hash'))?.bindingHash).toBe(
      'browser-binding-hash',
    );
    expect(await transactionStore.consume('state-hash')).toBeUndefined();
  });
});

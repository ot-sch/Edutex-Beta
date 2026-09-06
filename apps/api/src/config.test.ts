/**
 * @fileoverview Regression evidence for config; it verifies the production behavior owned by the adjacent source module.
 *
 * @remarks
 * Direct links: `vitest`, `./config.js`.
 * Security: Assurance code only; it must never be included in runtime bundles.
 */

import { describe, expect, it } from 'vitest';

import { loadConfiguration } from './config.js';

describe('production configuration validation', /** Defines the `production configuration validation` regression-test suite and groups evidence for the adjacent production module. Direct links: `it`. */ () => {
  it('accepts the exact HTTPS origin emitted by the production stack', /** Verifies the `accepts the exact HTTPS origin emitted by the production stack` case and fails the quality gate when the expected security/functional invariant changes. Direct links: `loadConfiguration`, `expect(configuration.publicBaseUrl.toString()`, `expect`, `configuration.publicBaseUrl.toString`. */ () => {
    const configuration = loadConfiguration({
      AUTH_TRANSACTION_TABLE_NAME: 'transactions',
      NODE_ENV: 'production',
      PUBLIC_BASE_URL: 'https://portal.school.example',
      PUBLIC_HOSTNAME: 'portal.school.example',
      SESSION_STORE: 'dynamodb',
      SESSION_TABLE_NAME: 'sessions',
    });
    expect(configuration.publicBaseUrl.toString()).toBe('https://portal.school.example/');
  });

  it('rejects credentials, custom ports and paths in the production public origin', /** Verifies the `rejects credentials, custom ports and paths in the production public origin` case and fails the quality gate when the expected security/functional invariant changes. Direct links: `expect(() => loadConfiguration({ AUTH_TRANSAC`, `expect`. */ () => {
    for (const publicBaseUrl of [
      'https://user:password@portal.school.example',
      'https://portal.school.example:8443',
      'https://portal.school.example/unexpected-path',
    ]) {
      expect(
        /** Performs the local `expect` operation inside `config.test` and returns control to the surrounding feature only after this body completes. Direct links: `loadConfiguration`. */ () =>
          loadConfiguration({
            AUTH_TRANSACTION_TABLE_NAME: 'transactions',
            NODE_ENV: 'production',
            PUBLIC_BASE_URL: publicBaseUrl,
            PUBLIC_HOSTNAME: 'portal.school.example',
            SESSION_STORE: 'dynamodb',
            SESSION_TABLE_NAME: 'sessions',
          }),
      ).toThrow();
    }
  });

  it('rejects a production hostname that differs from the canonical public URL', /** Verifies the fail-closed host allowlist used before tenant resolution and browser-origin comparison. Direct links: `loadConfiguration`, `expect`. */ () => {
    expect(
      /** Invokes the production configuration parser with deliberately inconsistent host values and expects rejection. Direct links: `loadConfiguration`. */ () =>
        loadConfiguration({
          AUTH_TRANSACTION_TABLE_NAME: 'transactions',
          NODE_ENV: 'production',
          PUBLIC_BASE_URL: 'https://portal.school.example',
          PUBLIC_HOSTNAME: 'other.school.example',
          SESSION_STORE: 'dynamodb',
          SESSION_TABLE_NAME: 'sessions',
        }),
    ).toThrow(/PUBLIC_HOSTNAME/);
  });

  it('rejects static credentials or database passwords in the production API task', /** Proves the long-running service cannot start with secret-bearing environment variables that bypass workload roles or approved one-shot injection. Direct links: `loadConfiguration`, `expect`. */ () => {
    for (const secretEnvironment of [
      { AWS_ACCESS_KEY_ID: 'AKIAEXAMPLE' },
      { CLOUDFLARE_API_TOKEN: 'not-allowed' },
      { DB_PASSWORD: 'not-allowed' },
    ]) {
      expect(
        /** Parses one deliberately secret-bearing production environment and requires rejection. */
        () =>
          loadConfiguration({
            AUTH_TRANSACTION_TABLE_NAME: 'transactions',
            NODE_ENV: 'production',
            PUBLIC_BASE_URL: 'https://portal.school.example',
            PUBLIC_HOSTNAME: 'portal.school.example',
            SESSION_STORE: 'dynamodb',
            SESSION_TABLE_NAME: 'sessions',
            ...secretEnvironment,
          }),
      ).toThrow(/Production API configuration forbids/);
    }
  });
});

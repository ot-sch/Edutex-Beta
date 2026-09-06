/**
 * @fileoverview Regression evidence for app; it verifies the production behavior owned by the adjacent source module.
 *
 * @remarks
 * Direct links: `node:fs/promises`, `node:os`, `node:path`, `vitest`, `./app.js`, `./config.js`, `./release.js`, `/health/live`, `/auth/`, `/auth/edutex-logo.png`, `/auth/assets/app-a1b2c3.js`, `/api/v1/auth/logout`, `/api/v1/public/tenant`.
 * Security: Assurance code only; it must never be included in runtime bundles.
 */

import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildApplication } from './app.js';
import { loadConfiguration } from './config.js';
import { releaseVersion } from './release.js';

/** Implements `developmentConfiguration` for regression evidence for app; it verifies the production behavior owned by the adjacent source module. Direct links: `loadConfiguration`. */ function developmentConfiguration() {
  return loadConfiguration({
    AUTH_WEB_ROOT: '/tmp/edutex-missing-auth',
    NODE_ENV: 'test',
    PORTAL_WEB_ROOT: '/tmp/edutex-missing-portal',
    PUBLIC_BASE_URL: 'http://localhost:8080',
    SESSION_STORE: 'memory',
  });
}

describe('application security boundary', /** Defines the `application security boundary` regression-test suite and groups evidence for the adjacent production module. Direct links: `it`. */ () => {
  it('emits browser hardening headers on live responses', /** Verifies the `emits browser hardening headers on live responses` case and fails the quality gate when the expected security/functional invariant changes. Direct links: `buildApplication`, `developmentConfiguration`, `application.inject`, `expect(response.statusCode).toBe`, `expect`. */ async () => {
    const application = await buildApplication({
      configuration: developmentConfiguration(),
      initializeDatabase: false,
    });
    const response = await application.inject({ method: 'GET', url: '/health/live' });
    expect(response.statusCode).toBe(200);
    expect(response.json<{ version: string }>().version).toBe(releaseVersion);
    expect(response.headers['content-security-policy']).toContain("default-src 'self'");
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['permissions-policy']).toContain('camera=()');
    await application.close();
  });

  it('caches only fingerprinted public authentication assets immutably', /** Verifies the `caches only fingerprinted public authentication assets immutably` case and fails the quality gate when the expected security/functional invariant changes. Direct links: `mkdtemp`, `join`, `tmpdir`, `mkdir`, `Promise.all`. */ async () => {
    const authRoot = await mkdtemp(join(tmpdir(), 'edutex-auth-assets-'));
    await mkdir(join(authRoot, 'assets'));
    await Promise.all([
      writeFile(join(authRoot, 'index.html'), '<!doctype html><title>Edutex</title>'),
      writeFile(join(authRoot, 'edutex-logo.png'), 'replaceable-branding'),
      writeFile(join(authRoot, 'assets', 'app-a1b2c3.js'), 'export {};'),
    ]);
    const application = await buildApplication({
      configuration: loadConfiguration({
        AUTH_WEB_ROOT: authRoot,
        NODE_ENV: 'test',
        PORTAL_WEB_ROOT: '/tmp/edutex-missing-portal',
        PUBLIC_BASE_URL: 'http://localhost:8080',
        SESSION_STORE: 'memory',
      }),
      initializeDatabase: false,
    });

    const document = await application.inject({ method: 'GET', url: '/auth/' });
    const logo = await application.inject({ method: 'GET', url: '/auth/edutex-logo.png' });
    const fingerprinted = await application.inject({
      method: 'GET',
      url: '/auth/assets/app-a1b2c3.js',
    });

    expect(document.headers['cache-control']).toBe('no-store');
    expect(logo.headers['cache-control']).toBe('public, max-age=300');
    expect(fingerprinted.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    await application.close();
  });

  it('rejects cross-site state-changing requests before route handling', /** Verifies the `rejects cross-site state-changing requests before route handling` case and fails the quality gate when the expected security/functional invariant changes. Direct links: `buildApplication`, `developmentConfiguration`, `application.inject`, `expect(response.statusCode).toBe`, `expect`. */ async () => {
    const application = await buildApplication({
      configuration: developmentConfiguration(),
      initializeDatabase: false,
    });
    const response = await application.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { 'sec-fetch-site': 'cross-site' },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json<{ code: string }>().code).toBe('CROSS_SITE_REQUEST_REJECTED');
    await application.close();
  });

  it('fails closed when production API traffic bypasses Cloudflare', /** Verifies the `fails closed when production API traffic bypasses Cloudflare` case and fails the quality gate when the expected security/functional invariant changes. Direct links: `loadConfiguration`, `buildApplication`, `application.inject`, `expect(response.statusCode).toBe`, `expect`. */ async () => {
    const configuration = loadConfiguration({
      AUTH_WEB_ROOT: '/tmp/edutex-missing-auth',
      AUTH_TRANSACTION_TABLE_NAME: 'transactions',
      NODE_ENV: 'production',
      PORTAL_WEB_ROOT: '/tmp/edutex-missing-portal',
      PUBLIC_BASE_URL: 'https://school.example',
      PUBLIC_HOSTNAME: 'school.example',
      SESSION_STORE: 'dynamodb',
      SESSION_TABLE_NAME: 'sessions',
    });
    const application = await buildApplication({ configuration, initializeDatabase: false });
    const response = await application.inject({ method: 'GET', url: '/api/v1/public/tenant' });
    expect(response.statusCode).toBe(403);
    expect(response.json<{ code: string }>().code).toBe('EDGE_VERIFICATION_FAILED');
    await application.close();
  });

  it('rejects a Cloudflare-marked request when its host is not the configured production host', /** Verifies that a forged or misrouted edge marker cannot make an unapproved Host value enter tenant resolution or origin checks. Direct links: `loadConfiguration`, `buildApplication`, `application.inject`, `expect`. */ async () => {
    const configuration = loadConfiguration({
      AUTH_WEB_ROOT: '/tmp/edutex-missing-auth',
      AUTH_TRANSACTION_TABLE_NAME: 'transactions',
      NODE_ENV: 'production',
      PORTAL_WEB_ROOT: '/tmp/edutex-missing-portal',
      PUBLIC_BASE_URL: 'https://school.example',
      PUBLIC_HOSTNAME: 'school.example',
      SESSION_STORE: 'dynamodb',
      SESSION_TABLE_NAME: 'sessions',
    });
    const application = await buildApplication({ configuration, initializeDatabase: false });
    const response = await application.inject({
      method: 'GET',
      url: '/api/v1/public/tenant',
      headers: { host: 'attacker.example', 'cf-ray': '12345678-SYD' },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json<{ code: string }>().code).toBe('HOST_VERIFICATION_FAILED');
    await application.close();
  });

  it('keeps the private production health probe available on task loopback', /** Verifies that ECS can check liveness without a public Host or Cloudflare header while Cloudflare remains configured to block health paths externally. Direct links: `loadConfiguration`, `buildApplication`, `application.inject`, `expect`. */ async () => {
    const configuration = loadConfiguration({
      AUTH_WEB_ROOT: '/tmp/edutex-missing-auth',
      AUTH_TRANSACTION_TABLE_NAME: 'transactions',
      NODE_ENV: 'production',
      PORTAL_WEB_ROOT: '/tmp/edutex-missing-portal',
      PUBLIC_BASE_URL: 'https://school.example',
      PUBLIC_HOSTNAME: 'school.example',
      SESSION_STORE: 'dynamodb',
      SESSION_TABLE_NAME: 'sessions',
    });
    const application = await buildApplication({ configuration, initializeDatabase: false });
    const response = await application.inject({
      method: 'GET',
      url: '/health/live',
      headers: { host: '127.0.0.1:8080' },
    });
    expect(response.statusCode).toBe(200);
    await application.close();
  });
});

/**
 * @fileoverview Verifies fail-closed PostgreSQL production configuration before any connection is
 * attempted. These tests prove the long-running API cannot downgrade IAM authentication, TLS
 * verification or secret handling; no network or live database is contacted.
 */

import { describe, expect, it } from 'vitest';

import { createDatabasePool } from './pool.js';

const secureRuntimeEnvironment = {
  AWS_REGION: 'ap-southeast-2',
  DB_CONNECTION_PURPOSE: 'runtime',
  DB_AUTH_MODE: 'iam',
  DB_CA_BUNDLE_PATH: '/does/not/need/to/exist/when/schema-rejects-first',
  DB_HOST: 'edutex.proxy.example',
  DB_NAME: 'edutex',
  DB_PORT: '5432',
  DB_SSL_MODE: 'verify-full',
  DB_USER: 'edutex_app',
  NODE_ENV: 'production',
} as const;

describe('production database configuration', /** Groups regression evidence for fail-closed runtime database authentication and TLS settings. Direct links: `it`, `createDatabasePool`. */ () => {
  it('rejects password authentication for the production runtime role', /** Proves the production API cannot use a long-lived PostgreSQL password instead of RDS IAM authentication. Direct links: `createDatabasePool`, `expect`. */ async () => {
    await expect(
      createDatabasePool({
        ...secureRuntimeEnvironment,
        DB_AUTH_MODE: 'password',
        DB_PASSWORD: 'not-allowed',
      }),
    ).rejects.toThrow(/IAM authentication/);
  });

  it('rejects a password variable even when IAM mode is also selected', /** Proves a stray injected database credential cannot be silently ignored inside the long-running API task. Direct links: `createDatabasePool`, `expect`. */ async () => {
    await expect(
      createDatabasePool({ ...secureRuntimeEnvironment, DB_PASSWORD: 'not-allowed' }),
    ).rejects.toThrow(/must not receive a database password/);
  });

  it('rejects production TLS modes weaker than verify-full', /** Proves production cannot fall back to encrypted-but-unverified or plaintext PostgreSQL transport. Direct links: `createDatabasePool`, `expect`. */ async () => {
    await expect(
      createDatabasePool({ ...secureRuntimeEnvironment, DB_SSL_MODE: 'require' }),
    ).rejects.toThrow(/verify the complete server certificate chain/);
  });
});

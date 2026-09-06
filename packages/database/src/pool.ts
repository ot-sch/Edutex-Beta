/**
 * @fileoverview Implements PostgreSQL pool, migration or transaction behavior shared by the API and controlled one-shot tasks.
 *
 * @remarks
 * Direct links: `node:fs/promises`, `@aws-sdk/rds-signer`, `pg`, `zod`.
 * Security: Tenant-data boundary; parameterisation, same-client transaction context, RLS and relational constraints must remain intact.
 */

import { readFile } from 'node:fs/promises';

import { Signer } from '@aws-sdk/rds-signer';
import pg from 'pg';
import { z } from 'zod';

const { Pool } = pg;

const databaseEnvironmentSchema = z
  .object({
    AWS_REGION: z.string().min(1).default('ap-southeast-2'),
    DB_CONNECTION_PURPOSE: z.enum(['runtime', 'migration']).default('runtime'),
    DB_AUTH_MODE: z.enum(['iam', 'password']).default('iam'),
    DB_CA_BUNDLE_PATH: z.string().default(''),
    DB_HOST: z.string().min(1),
    DB_NAME: z.string().min(1),
    DB_PASSWORD: z.string().optional(),
    DB_PORT: z.coerce.number().int().min(1).max(65_535).default(5432),
    DB_SSL_MODE: z.enum(['verify-full', 'require', 'disable']).default('verify-full'),
    DB_USER: z.string().min(1),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  })
  .superRefine(
    /** Performs the local `z .object({ AWS_REGION: z.string().min(1).default('ap-southe` operation inside `pool` and returns control to the surrounding feature only after this body completes. It receives `value`, `context`. Direct links: `context.addIssue`. */ (
      value,
      context,
    ) => {
      if (
        value.NODE_ENV === 'production' &&
        value.DB_CONNECTION_PURPOSE === 'runtime' &&
        value.DB_AUTH_MODE !== 'iam'
      ) {
        context.addIssue({
          code: 'custom',
          path: ['DB_AUTH_MODE'],
          message: 'Production runtime database connections must use RDS IAM authentication.',
        });
      }
      if (
        value.NODE_ENV === 'production' &&
        value.DB_CONNECTION_PURPOSE === 'runtime' &&
        value.DB_PASSWORD
      ) {
        context.addIssue({
          code: 'custom',
          path: ['DB_PASSWORD'],
          message: 'Production runtime must not receive a database password environment variable.',
        });
      }
      if (value.DB_AUTH_MODE === 'password' && !value.DB_PASSWORD) {
        context.addIssue({
          code: 'custom',
          path: ['DB_PASSWORD'],
          message: 'A password is required when DB_AUTH_MODE=password.',
        });
      }
      if (value.NODE_ENV === 'production' && value.DB_SSL_MODE !== 'verify-full') {
        context.addIssue({
          code: 'custom',
          path: ['DB_SSL_MODE'],
          message: 'Production database TLS must verify the complete server certificate chain.',
        });
      }
    },
  );

let sharedPool: pg.Pool | undefined;

/**
 * Creates the process-wide PostgreSQL pool. Production passwords are short-lived
 * IAM tokens generated for each new physical connection to RDS Proxy.
 */
export async function createDatabasePool(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<pg.Pool> {
  const configuration = databaseEnvironmentSchema.parse(environment);
  const certificateAuthority = configuration.DB_CA_BUNDLE_PATH
    ? await readFile(configuration.DB_CA_BUNDLE_PATH, 'utf8')
    : undefined;

  if (configuration.NODE_ENV === 'production' && !certificateAuthority) {
    throw new Error('DB_CA_BUNDLE_PATH is required in production for verify-full TLS.');
  }

  const signer = new Signer({
    hostname: configuration.DB_HOST,
    port: configuration.DB_PORT,
    region: configuration.AWS_REGION,
    username: configuration.DB_USER,
  });

  const pool = new Pool({
    application_name: 'edutex-api',
    database: configuration.DB_NAME,
    host: configuration.DB_HOST,
    idleTimeoutMillis: 30_000,
    keepAlive: true,
    max: 20,
    maxLifetimeSeconds: 13 * 60,
    password:
      configuration.DB_AUTH_MODE === 'iam'
        ? /** Performs the local `callback` operation inside `createDatabasePool` and returns control to the surrounding feature only after this body completes. Direct links: `signer.getAuthToken`. */ async () =>
            signer.getAuthToken()
        : configuration.DB_PASSWORD,
    port: configuration.DB_PORT,
    ssl:
      configuration.DB_SSL_MODE === 'disable'
        ? false
        : {
            ca: certificateAuthority,
            rejectUnauthorized: configuration.DB_SSL_MODE === 'verify-full',
          },
    statement_timeout: 15_000,
    user: configuration.DB_USER,
  });

  pool.on(
    'connect',
    /** Performs the local `pool.on` operation inside `createDatabasePool` and returns control to the surrounding feature only after this body completes. It receives `client`. Direct links: `client.query`. */ (
      client,
    ) => {
      void client.query("set timezone = 'UTC'");
    },
  );
  sharedPool = pool;
  return pool;
}

/** Returns the initialized database pool and fails closed before startup completes. */
export function getDatabasePool(): pg.Pool {
  if (!sharedPool) {
    throw new Error('The database pool has not been initialized.');
  }
  return sharedPool;
}

/** Drains database connections during graceful shutdown. */
export async function closeDatabase(): Promise<void> {
  const pool = sharedPool;
  sharedPool = undefined;
  if (pool) {
    await pool.end();
  }
}

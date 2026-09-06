/**
 * @fileoverview Implements PostgreSQL pool, migration or transaction behavior shared by the API and controlled one-shot tasks.
 *
 * @remarks
 * Direct links: `pg`, `./pool.js`.
 * Security: Tenant-data boundary; parameterisation, same-client transaction context, RLS and relational constraints must remain intact.
 */

import type pg from 'pg';

import { getDatabasePool } from './pool.js';

export interface TenantDatabaseContext {
  readonly tenantId: string;
  readonly userId: string;
  readonly permissions: readonly string[];
  readonly requestId: string;
}

type TransactionWork<T> = (client: pg.PoolClient) => Promise<T>;

/**
 * Runs work in a transaction after setting PostgreSQL session-local security
 * attributes. Row-level-security policies consume these values, and SET LOCAL
 * guarantees that pooled connections cannot leak a prior request's tenant.
 */
export async function runInTenantTransaction<T>(
  context: TenantDatabaseContext,
  work: TransactionWork<T>,
): Promise<T> {
  const client = await getDatabasePool().connect();
  try {
    await client.query('begin');
    await client.query(
      `select
         set_config('app.tenant_id', $1, true),
         set_config('app.user_id', $2, true),
         set_config('app.permissions', $3, true),
         set_config('app.request_id', $4, true)`,
      [context.tenantId, context.userId, JSON.stringify(context.permissions), context.requestId],
    );
    const result = await work(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Runs control-plane work without tenant context. Callers must use a dedicated
 * database role and must never expose this helper to ordinary request handlers.
 */
export async function runInSystemTransaction<T>(work: TransactionWork<T>): Promise<T> {
  const client = await getDatabasePool().connect();
  try {
    await client.query('begin');
    const result = await work(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

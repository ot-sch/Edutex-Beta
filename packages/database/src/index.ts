/**
 * @fileoverview Implements PostgreSQL pool, migration or transaction behavior shared by the API and controlled one-shot tasks.
 *
 * @remarks
 * Direct links: its owning workspace entry point and adjacent typed modules.
 * Security: Tenant-data boundary; parameterisation, same-client transaction context, RLS and relational constraints must remain intact.
 */

export { closeDatabase, createDatabasePool, getDatabasePool } from './pool.js';
export {
  runInSystemTransaction,
  runInTenantTransaction,
  type TenantDatabaseContext,
} from './transaction.js';

/**
 * @fileoverview Implements PostgreSQL pool, migration or transaction behavior shared by the API and controlled one-shot tasks.
 *
 * @remarks
 * Direct links: `node:crypto`, `node:fs/promises`, `node:path`, `node:url`, `./pool.js`.
 * Security: Tenant-data boundary; parameterisation, same-client transaction context, RLS and relational constraints must remain intact.
 */

import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { closeDatabase, createDatabasePool } from './pool.js';
import { migrationCorrections } from './migration-compatibility.js';

interface AppliedMigration {
  readonly filename: string;
  readonly checksum: string;
}

const migrationDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../migrations');

/** Applies immutable SQL migrations in lexical order and detects edited history. */
async function migrate(): Promise<void> {
  const pool = await createDatabasePool();
  const client = await pool.connect();
  try {
    await client.query('select pg_advisory_lock(71427,6)');
    await client.query(`
      create schema if not exists migration;
      create table if not exists migration.schema_migrations (
        filename text primary key,
        checksum text not null,
        applied_at timestamptz not null default clock_timestamp()
      );
    `);

    const appliedResult = await client.query<AppliedMigration>(
      'select filename, checksum from migration.schema_migrations order by filename',
    );
    const applied = new Map(
      appliedResult.rows.map(
        /** Transforms each input item for `migrate` into the derived value or React element consumed by the surrounding collection. It receives `row`. It uses only the local values shown in its body. */ (
          row,
        ) => [row.filename, row.checksum],
      ),
    );
    const filenames = (await readdir(migrationDirectory))
      .filter(
        /** Keeps only input items that satisfy this predicate before `migrate` continues its lookup, render or request construction. It receives `filename`. Direct links: `/^\d{4}_[a-z0-9_]+\.sql$/.test`. */ (
          filename,
        ) => /^\d{4}_[a-z0-9_]+\.sql$/.test(filename),
      )
      .sort();

    for (const filename of filenames) {
      const sql = await readFile(resolve(migrationDirectory, filename), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const existingChecksum = applied.get(filename);
      const correction = migrationCorrections[filename];
      const exactKnownCorrection =
        correction?.original === existingChecksum && correction?.corrected === checksum;
      if (existingChecksum && existingChecksum !== checksum && !exactKnownCorrection) {
        throw new Error(
          `Applied migration ${filename} was modified; create a new migration instead.`,
        );
      }
      if (exactKnownCorrection)
        process.stdout.write(
          `Recognised original RC5 checksum for ${filename}; 0012 applies its reviewed function repair.\n`,
        );
      if (existingChecksum) continue;

      process.stdout.write(`Applying ${filename} ... `);
      await client.query('begin');
      try {
        await client.query(
          "select set_config('app.tenant_id','',true),set_config('app.user_id','',true),set_config('app.permissions','[\"platform:manage\"]',true),set_config('app.request_id',$1,true)",
          ['migration:' + filename],
        );
        await client.query(sql);
        await client.query(
          'insert into migration.schema_migrations (filename, checksum) values ($1, $2)',
          [filename, checksum],
        );
        await client.query('commit');
        process.stdout.write('done\n');
      } catch (error) {
        await client.query('rollback');
        throw error;
      }
    }
  } finally {
    await client.query('select pg_advisory_unlock(71427,6)');
    client.release();
    await closeDatabase();
  }
}

await migrate();

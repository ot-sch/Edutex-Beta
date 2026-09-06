/**
 * @fileoverview Registers the resources HTTP API routes, validates untrusted requests and connects authenticated Fastify handlers to tenant-scoped services/PostgreSQL transactions.
 *
 * @remarks
 * Direct links: `@edutex/contracts`, `@edutex/database`, `fastify`, `pg`, `zod`, `../../shared/errors.js`, `../auth/session.js`, `./registry.js`, `/api/v1/resources/:resource`, `/api/v1/resources/:resource/:id`.
 * Security: Tenant-data boundary; parameterisation, same-client transaction context, RLS and relational constraints must remain intact.
 */

import {
  listQuerySchema,
  resourceListResponseSchema,
  resourceMutationSchema,
  resourceNameSchema,
  resourceRecordSchema,
  type ResourceRecord,
} from '@edutex/contracts';
import { runInTenantTransaction, type TenantDatabaseContext } from '@edutex/database';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { DatabaseError } from 'pg';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { authorize } from '../workflows/context.js';

import { ApplicationError } from '../../shared/errors.js';
import { requireCsrf, requireSession, requireRecentMfa } from '../auth/session.js';
import {
  resourceRegistry,
  validateMutationFields,
  type ResourceConfiguration,
} from './registry.js';

const resourceParametersSchema = z.object({ resource: resourceNameSchema });
const recordParametersSchema = resourceParametersSchema.extend({ id: z.uuid() });

interface DatabaseResourceRow {
  readonly id: string;
  readonly row_version: string | number;
  readonly created_at: Date;
  readonly updated_at: Date;
  readonly fields: Record<string, unknown>;
}

/** Quotes only registry-controlled PostgreSQL identifiers after a defensive syntax check. */
function quoteIdentifier(identifier: string): string {
  if (!/^[a-z][a-z0-9_]*$/.test(identifier))
    throw new Error(`Unsafe SQL identifier: ${identifier}`);
  return `"${identifier}"`;
}

/** Builds a JSON response projection exclusively from the compile-time resource registry. */
function selectionSql(configuration: ResourceConfiguration): string {
  const pairs = Object.entries(configuration.fields).flatMap(
    /** Performs the local `Object.entries(configuration.fields).flatMap` operation inside `selectionSql` and returns control to the surrounding feature only after this body completes. It receives `[apiName, definition]`. Direct links: `apiName.replaceAll`, `quoteIdentifier`. */ ([
      apiName,
      definition,
    ]) => [`'${apiName.replaceAll("'", "''")}'`, quoteIdentifier(definition.column)],
  );
  return `jsonb_build_object(${pairs.join(', ')})`;
}

/** Enforces module/action or module/manage permission before any resource query is constructed. */
function requireResourcePermission(
  request: FastifyRequest,
  moduleName: string,
  action: string,
): void {
  authorize(request, moduleName, action);
  const permissions = request.identity?.user.permissions ?? [];
  if (
    !permissions.includes(`${moduleName}:${action}`) &&
    !permissions.includes(`${moduleName}:manage`) &&
    !permissions.includes('platform:manage')
  ) {
    throw new ApplicationError(
      403,
      'PERMISSION_DENIED',
      'You do not have permission for this action.',
    );
  }
}

/** Derives transaction-local tenant, actor, permission and request context from the verified session. */
function databaseContext(request: FastifyRequest): TenantDatabaseContext {
  if (!request.identity)
    throw new ApplicationError(401, 'AUTHENTICATION_REQUIRED', 'Please sign in.');
  return {
    tenantId: request.identity.user.tenantId,
    userId: request.identity.user.id,
    permissions: request.identity.user.permissions,
    requestId: request.id,
  } as const;
}

/** Converts PostgreSQL row metadata and allowlisted fields into the stable public resource contract. */
function toResourceRecord(row: DatabaseResourceRow): ResourceRecord {
  return resourceRecordSchema.parse({
    id: row.id,
    rowVersion: Number(row.row_version),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    fields: row.fields,
  });
}

/** Maps expected PostgreSQL constraint failures to non-sensitive API errors and rethrows all others. */
function translateDatabaseError(error: unknown): never {
  const databaseError = error as Partial<DatabaseError>;
  if (databaseError.code === '23505') {
    throw new ApplicationError(
      409,
      'DUPLICATE_RECORD',
      'A record with that unique value already exists.',
    );
  }
  if (databaseError.code === '23503') {
    throw new ApplicationError(
      409,
      'RELATED_RECORD_INVALID',
      'A referenced record does not exist or is in use.',
    );
  }
  if (databaseError.code === '23514' || databaseError.code === '22P02') {
    throw new ApplicationError(
      400,
      'DATABASE_CONSTRAINT_FAILED',
      'One or more values are not permitted.',
    );
  }
  throw error;
}

/** Registers bounded, property-allowlisted CRUD routes for production modules. */
export function registerResourceRoutes(server: FastifyInstance): void {
  server.get('/api/v1/resources/:resource/:id', {
    preHandler: [requireSession],

    /** Handles /api/v1/resources/:resource/:id using validated input and the route's authenticated authorization context. */
    handler: async (request) => {
      const { resource, id } = recordParametersSchema.parse(request.params);
      const configuration = resourceRegistry[resource];
      requireResourcePermission(request, configuration.permissionModule, 'view');
      const result = await runInTenantTransaction(
        databaseContext(request),

        /** Applies routes reads or writes with transaction-local tenant, actor and audit context. */
        async (client) =>
          client.query<DatabaseResourceRow>(
            `select id,row_version,created_at,updated_at,${selectionSql(configuration)} as fields from app.${quoteIdentifier(configuration.table)} where tenant_id=$1 and id=$2`,
            [databaseContext(request).tenantId, id],
          ),
      );
      const row = result.rows[0];
      if (!row) throw new ApplicationError(404, 'NOT_FOUND', 'This record is unavailable.');
      return toResourceRecord(row);
    },
  });
  server.get('/api/v1/resources/:resource', {
    preHandler: [requireSession],
    /** Implements `handler` for registers the resources http api routes, validates untrusted requests and connects authenticated fastify handlers to tenant-scoped services/postgresql transactions. It receives `request`. Direct links: `resourceParametersSchema.parse`, `listQuerySchema.parse`, `requireResourcePermission`, `databaseContext`, `values.push`. */ handler:
      async (request) => {
        const { resource } = resourceParametersSchema.parse(request.params);
        const query = listQuerySchema.parse(request.query);
        const configuration = resourceRegistry[resource];
        requireResourcePermission(request, configuration.permissionModule, 'view');

        const requestedSort =
          query.sort && configuration.fields[query.sort] ? query.sort : configuration.defaultSort;
        const sortColumn = configuration.fields[requestedSort]?.column;
        if (!sortColumn) throw new Error(`Resource ${resource} has an invalid default sort.`);
        const values: unknown[] = [databaseContext(request).tenantId];
        let searchPredicate = '';
        if (query.search) {
          values.push(
            `%${query.search.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`,
          );
          const parameter = `$${values.length}`;
          searchPredicate = ` and (${configuration.searchColumns
            .map(
              /** Transforms each input item for `handler` into the derived value or React element consumed by the surrounding collection. It receives `column`. Direct links: `quoteIdentifier`. */ (
                column,
              ) => `${quoteIdentifier(column)}::text ilike ${parameter} escape '\\'`,
            )
            .join(' or ')})`;
        }
        if (query.status && configuration.fields['status']) {
          values.push(query.status);
          searchPredicate += ` and ${quoteIdentifier(configuration.fields['status'].column)} = $${values.length}`;
        }
        const countValues = [...values];
        values.push(query.pageSize, (query.page - 1) * query.pageSize);
        const limitParameter = `$${values.length - 1}`;
        const offsetParameter = `$${values.length}`;
        const table = `app.${quoteIdentifier(configuration.table)}`;

        try {
          const result = await runInTenantTransaction(
            databaseContext(request),
            /** Executes the `handler` database work on the same PostgreSQL client after transaction-local tenant/user/permission context is set, preserving RLS isolation. It receives `client`. Direct links: `Promise.all`, `client.query`, `selectionSql`, `quoteIdentifier`, `values.slice`. */ async (
              client,
            ) => {
              const [items, count] = await Promise.all([
                client.query<DatabaseResourceRow>(
                  `select id, row_version, created_at, updated_at, ${selectionSql(configuration)} as fields
               from ${table}
               where tenant_id = $1${searchPredicate}
               order by ${quoteIdentifier(sortColumn)} ${query.direction}, id
               limit ${limitParameter} offset ${offsetParameter}`,
                  values,
                ),
                client.query<{ total: string }>(
                  `select count(*)::text as total from ${table} where tenant_id = $1${searchPredicate}`,
                  countValues,
                ),
              ]);
              return { items: items.rows, total: Number(count.rows[0]?.total ?? 0) };
            },
          );
          return resourceListResponseSchema.parse({
            items: result.items.map(toResourceRecord),
            page: query.page,
            pageSize: query.pageSize,
            total: result.total,
          });
        } catch (error) {
          return translateDatabaseError(error);
        }
      },
  });

  server.post('/api/v1/resources/:resource', {
    preHandler: [requireSession, requireCsrf],
    /** Implements `handler` for registers the resources http api routes, validates untrusted requests and connects authenticated fastify handlers to tenant-scoped services/postgresql transactions. It receives `request`, `reply`. Direct links: `resourceParametersSchema.parse`, `resourceMutationSchema.parse`, `requireResourcePermission`, `validateMutationFields`, `entries.map`. */ handler:
      async (request, reply) => {
        const { resource } = resourceParametersSchema.parse(request.params);
        const body = resourceMutationSchema.parse(request.body);
        const configuration = resourceRegistry[resource];
        requireResourcePermission(
          request,
          configuration.permissionModule,
          configuration.adminOnly ? 'manage' : 'create',
        );
        if (['students', 'staff'].includes(resource) && Object.hasOwn(body.fields, 'userId')) {
          requireResourcePermission(request, configuration.permissionModule, 'manage');
          await requireRecentMfa.call(server, request, reply);
        }
        const entries = validateMutationFields(configuration, body.fields, true);
        const recordId = body.id ?? randomUUID();
        const columns = entries.map(
          /** Transforms each input item for `handler` into the derived value or React element consumed by the surrounding collection. It receives `[, definition]`. Direct links: `quoteIdentifier`. */ ([
            ,
            definition,
          ]) => quoteIdentifier(definition.column),
        );
        const values = entries.map(
          /** Transforms each input item for `handler` into the derived value or React element consumed by the surrounding collection. It receives `[, , value]`. It uses only the local values shown in its body. */ ([
            ,
            ,
            value,
          ]) => value,
        );
        const parameters = values.map(
          /** Transforms each input item for `handler` into the derived value or React element consumed by the surrounding collection. It receives `_`, `index`. It uses only the local values shown in its body. */ (
            _,
            index,
          ) => `$${index + 3}`,
        );
        const table = `app.${quoteIdentifier(configuration.table)}`;
        try {
          const result = await runInTenantTransaction(
            databaseContext(request),
            /** Executes the `handler` database work on the same PostgreSQL client after transaction-local tenant/user/permission context is set, preserving RLS isolation. It receives `client`. Direct links: `client.query`, `columns.join`, `parameters.join`, `selectionSql`, `databaseContext`. */ (
              client,
            ) =>
              client.query<DatabaseResourceRow>(
                `insert into ${table} (tenant_id, id, ${columns.join(', ')})
             values ($1, $2, ${parameters.join(', ')})
             returning id, row_version, created_at, updated_at, ${selectionSql(configuration)} as fields`,
                [databaseContext(request).tenantId, recordId, ...values],
              ),
          );
          const record = result.rows[0];
          if (!record) throw new Error('Insert did not return a record.');
          return await reply.status(201).send(toResourceRecord(record));
        } catch (error) {
          return translateDatabaseError(error);
        }
      },
  });

  server.patch('/api/v1/resources/:resource/:id', {
    preHandler: [requireSession, requireCsrf],
    /** Implements `handler` for registers the resources http api routes, validates untrusted requests and connects authenticated fastify handlers to tenant-scoped services/postgresql transactions. It receives `request`. Direct links: `recordParametersSchema.parse`, `resourceMutationSchema .extend({ rowVersion: `, `resourceMutationSchema .extend`, `z.number().int().nonnegative`, `z.number().int`. */ handler:
      async (request, reply) => {
        const { resource, id } = recordParametersSchema.parse(request.params);
        const body = resourceMutationSchema
          .extend({ rowVersion: z.number().int().nonnegative() })
          .parse(request.body);
        const configuration = resourceRegistry[resource];
        requireResourcePermission(
          request,
          configuration.permissionModule,
          configuration.adminOnly ? 'manage' : 'edit',
        );
        if (['students', 'staff'].includes(resource) && Object.hasOwn(body.fields, 'userId')) {
          requireResourcePermission(request, configuration.permissionModule, 'manage');
          await requireRecentMfa.call(server, request, reply);
        }
        const entries = validateMutationFields(configuration, body.fields, false);
        if (entries.length === 0)
          throw new ApplicationError(400, 'EMPTY_MUTATION', 'No editable fields were supplied.');
        const values = entries.map(
          /** Transforms each input item for `handler` into the derived value or React element consumed by the surrounding collection. It receives `[, , value]`. It uses only the local values shown in its body. */ ([
            ,
            ,
            value,
          ]) => value,
        );
        const assignments = entries.map(
          /** Transforms each input item for `handler` into the derived value or React element consumed by the surrounding collection. It receives `[, definition]`, `index`. Direct links: `quoteIdentifier`. */ (
            [, definition],
            index,
          ) => `${quoteIdentifier(definition.column)} = $${index + 4}`,
        );
        const table = `app.${quoteIdentifier(configuration.table)}`;
        try {
          const result = await runInTenantTransaction(
            databaseContext(request),
            /** Executes the `handler` database work on the same PostgreSQL client after transaction-local tenant/user/permission context is set, preserving RLS isolation. It receives `client`. Direct links: `client.query`, `assignments.join`, `selectionSql`, `databaseContext`. */ (
              client,
            ) =>
              client.query<DatabaseResourceRow>(
                `update ${table}
             set ${assignments.join(', ')}
             where tenant_id = $1 and id = $2 and row_version = $3
             returning id, row_version, created_at, updated_at, ${selectionSql(configuration)} as fields`,
                [databaseContext(request).tenantId, id, body.rowVersion, ...values],
              ),
          );
          const record = result.rows[0];
          if (!record) {
            throw new ApplicationError(
              409,
              'VERSION_CONFLICT',
              'This record changed elsewhere. Refresh before saving.',
            );
          }
          return toResourceRecord(record);
        } catch (error) {
          return translateDatabaseError(error);
        }
      },
  });

  server.delete('/api/v1/resources/:resource/:id', {
    preHandler: [requireSession, requireCsrf],
    /** Implements `handler` for registers the resources http api routes, validates untrusted requests and connects authenticated fastify handlers to tenant-scoped services/postgresql transactions. It receives `request`, `reply`. Direct links: `recordParametersSchema.parse`, `requireResourcePermission`, `Number`, `rawVersion.replaceAll`, `Number.isSafeInteger`. */ handler:
      async (request, reply) => {
        const { resource, id } = recordParametersSchema.parse(request.params);
        const configuration = resourceRegistry[resource];
        requireResourcePermission(
          request,
          configuration.permissionModule,
          configuration.adminOnly ? 'manage' : 'delete',
        );
        const rawVersion = request.headers['if-match'];
        const version =
          typeof rawVersion === 'string' ? Number(rawVersion.replaceAll('"', '')) : NaN;
        if (!Number.isSafeInteger(version) || version < 0) {
          throw new ApplicationError(
            428,
            'VERSION_REQUIRED',
            'An If-Match row version is required.',
          );
        }
        const table = `app.${quoteIdentifier(configuration.table)}`;
        try {
          const result = await runInTenantTransaction(
            databaseContext(request),
            /** Executes the `handler` database work on the same PostgreSQL client after transaction-local tenant/user/permission context is set, preserving RLS isolation. It receives `client`. Direct links: `client.query`, `databaseContext`. */ (
              client,
            ) =>
              client.query(
                `delete from ${table} where tenant_id = $1 and id = $2 and row_version = $3 returning id`,
                [databaseContext(request).tenantId, id, version],
              ),
          );
          if (result.rowCount !== 1) {
            throw new ApplicationError(
              409,
              'VERSION_CONFLICT',
              'This record changed elsewhere. Refresh before deleting.',
            );
          }
          return await reply.status(204).send();
        } catch (error) {
          return translateDatabaseError(error);
        }
      },
  });
}

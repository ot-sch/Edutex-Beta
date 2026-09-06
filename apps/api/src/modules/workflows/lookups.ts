/** @fileoverview Permission-filtered reference labels replace copy-and-paste UUID fields in school workflows. */
import { runInTenantTransaction } from '@edutex/database';
import { resourceNameSchema } from '@edutex/contracts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireSession } from '../auth/session.js';
import { resourceRegistry } from '../resources/registry.js';
import { contextFor, identifier } from './context.js';
import { ApplicationError } from '../../shared/errors.js';

/** Returns display labels and IDs only; RLS still restricts the underlying rows. */
export function registerLookupRoutes(server: FastifyInstance): void {
  server.get('/api/v1/lookups/:kind', {
    preHandler: [requireSession],

    /** Handles /api/v1/lookups/:kind using validated input and the route's authenticated authorization context. */
    handler: async (request) => {
      const { kind } = z.object({ kind: z.string().max(80) }).parse(request.params);
      const { search, ids } = z
        .object({ search: z.string().max(100).default(''), ids: z.string().max(3699).optional() })
        .parse(request.query);
      const selected = ids ? z.array(z.uuid()).max(100).parse(ids.split(',')) : [];
      const ctx = contextFor(request);
      let table: string;
      let label: string;
      if (kind === 'users') {
        table = 'users';
        label = 'display_name';
      } else if (kind === 'houses' || kind === 'subjects') {
        table = kind;
        label = 'name';
      } else if (kind === 'guardians') {
        table = 'guardians';
        label = "first_name || ' ' || last_name";
      } else {
        const name = resourceNameSchema.parse(kind);
        const resource = resourceRegistry[name];
        table = resource.table;
        const preferred = [
          'displayName',
          'name',
          'title',
          'reference',
          'invoiceNumber',
          'paymentReference',
          'lastName',
          'code',
        ];
        const field =
          preferred.find(
            /** Selects preferred entries using the explicit resource.fields key condition. */
            (key) => resource.fields[key],
          ) ?? resource.defaultSort;
        label = identifier(requiredValue(resource.fields[field]).column) + '::text';
        if (name === 'students' || name === 'staff' || name === 'alumni')
          label = "first_name || ' ' || last_name";
      }
      if (['parent_guardian', 'student'].includes(requiredValue(request.identity).user.category))
        throw new ApplicationError(
          403,
          'PERMISSION_DENIED',
          'Use your portal to select linked records.',
        );
      const result = await runInTenantTransaction(
        ctx,

        /** Applies lookups reads or writes with transaction-local tenant, actor and audit context. */
        async (client) =>
          kind === 'users' || kind === 'guardians'
            ? client.query<Record<string, unknown>>(
                'select * from app.school_directory($1,$2,$3::uuid[])',
                [
                  kind,
                  '%' +
                    search.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_') +
                    '%',
                  selected,
                ],
              )
            : client.query<Record<string, unknown>>(
                `select id,${label} as label from app.${identifier(table)} where tenant_id=$1 and ((cardinality($3::uuid[])>0 and id=any($3::uuid[])) or (cardinality($3::uuid[])=0 and (${label}) ilike $2)) order by 2,id limit 100`,
                [
                  ctx.tenantId,
                  '%' +
                    search.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_') +
                    '%',
                  selected,
                ],
              ),
      );
      return { items: result.rows, limited: result.rows.length === 100 };
    },
  });
}

import { requiredValue } from '@edutex/contracts';

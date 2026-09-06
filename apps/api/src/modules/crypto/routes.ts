/**
 * @fileoverview Registers the crypto HTTP API routes, validates untrusted requests and connects authenticated Fastify handlers to tenant-scoped services/PostgreSQL transactions.
 *
 * @remarks
 * Direct links: `@edutex/contracts`, `@edutex/database`, `fastify`, `zod`, `../../shared/errors.js`, `../auth/session.js`, `./key-service.js`, `/api/v1/crypto/session-key`, `/api/v1/students/:studentId/sensitive`, `/api/v1/students/:studentId/sensitive/:fieldKey`.
 * Security: Cryptographic boundary; changes require protocol, AAD, key-lifecycle and cross-tenant review.
 */

import {
  encryptedFieldEnvelopeSchema,
  wrappedDataKeyRequestSchema,
  wrappedDataKeyResponseSchema,
} from '@edutex/contracts';
import { runInTenantTransaction } from '@edutex/database';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { ApplicationError } from '../../shared/errors.js';
import {
  requireCsrf,
  requirePermission,
  requireRecentMfa,
  requireSession,
} from '../auth/session.js';
import { authorize } from '../workflows/context.js';
import { TenantKeyService } from './key-service.js';

/** Registers recent-MFA-gated browser field-encryption key exchange. */
export function registerCryptoRoutes(server: FastifyInstance): void {
  const keyService = new TenantKeyService(server.configuration);
  server.post('/api/v1/crypto/session-key', {
    preHandler: [
      requireSession,
      /** Coordinates required Value within routes, preserving the caller's validation and error handling. */
      (request) => {
        if (['student', 'parent_guardian'].includes(requiredValue(request.identity).user.category))
          throw new ApplicationError(403, 'PERMISSION_DENIED', 'Use the child medical workflow.');
        const grants = [
          ['students', 'sensitive-view'],
          ['nurse', 'view'],
          ['wellbeing', 'view'],
          ['risk', 'view'],
        ];
        if (
          !grants.some(
            /** Selects grants entries using the explicit try authorize request required Value module action return true catch return false condition. */
            ([module, action]) => {
              try {
                authorize(request, requiredValue(module), action);
                return true;
              } catch {
                return false;
              }
            },
          )
        )
          throw new ApplicationError(403, 'PERMISSION_DENIED', 'Clinical access is required.');
        return Promise.resolve();
      },
      requireRecentMfa,
      requireCsrf,
    ],
    config: { rateLimit: { max: 10, timeWindow: '5 minutes' } },
    /** Implements `handler` for registers the crypto http api routes, validates untrusted requests and connects authenticated fastify handlers to tenant-scoped services/postgresql transactions. It receives `request`, `reply`. Direct links: `wrappedDataKeyRequestSchema.parse`, `keyService.wrapForBrowser`, `reply.header`, `wrappedDataKeyResponseSchema.parse`. */ handler:
      async (request, reply) => {
        if (!request.identity)
          throw new ApplicationError(401, 'AUTHENTICATION_REQUIRED', 'Please sign in.');
        const body = wrappedDataKeyRequestSchema.parse(request.body);
        const response = await keyService.wrapForBrowser(
          {
            tenantId: request.identity.user.tenantId,
            userId: request.identity.user.id,
            permissions: request.identity.user.permissions,
            requestId: request.id,
          },
          body.clientPublicKey,
          body.keyId,
        );
        reply.header('cache-control', 'no-store');
        return wrappedDataKeyResponseSchema.parse(response);
      },
  });

  server.get('/api/v1/students/:studentId/sensitive', {
    preHandler: [requireSession, requirePermission('students:sensitive-view')],
    /** Implements `handler` for registers the crypto http api routes, validates untrusted requests and connects authenticated fastify handlers to tenant-scoped services/postgresql transactions. It receives `request`, `reply`. Direct links: `z.object({ studentId: z.uuid() }).parse`, `z.object`, `z.uuid`, `runInTenantTransaction`, `reply.header`. */ handler:
      async (request, reply) => {
        if (!request.identity)
          throw new ApplicationError(401, 'AUTHENTICATION_REQUIRED', 'Please sign in.');
        const { studentId } = z.object({ studentId: z.uuid() }).parse(request.params);
        const result = await runInTenantTransaction(
          {
            tenantId: request.identity.user.tenantId,
            userId: request.identity.user.id,
            permissions: request.identity.user.permissions,
            requestId: request.id,
          },
          /** Executes the `handler` database work on the same PostgreSQL client after transaction-local tenant/user/permission context is set, preserving RLS isolation. It receives `client`. Direct links: `client.query`. */ (
            client,
          ) =>
            client.query<{
              field_key: string;
              encryption_key_id: string;
              initialization_vector: Buffer;
              ciphertext: Buffer;
              row_version: string;
            }>(
              `select field_key, encryption_key_id, initialization_vector, ciphertext, row_version
             from app.student_sensitive_fields
             where tenant_id = $1 and student_id = $2
             order by field_key`,
              [request.identity?.user.tenantId, studentId],
            ),
        );
        reply.header('cache-control', 'no-store');
        return {
          fields: result.rows.map(
            /** Transforms each input item for `handler` into the derived value or React element consumed by the surrounding collection. It receives `row`. Direct links: `Number`, `encryptedFieldEnvelopeSchema.parse`, `row.initialization_vector.toString`, `row.ciphertext.toString`. */ (
              row,
            ) => ({
              fieldKey: row.field_key,
              rowVersion: Number(row.row_version),
              envelope: encryptedFieldEnvelopeSchema.parse({
                version: 1,
                keyId: row.encryption_key_id,
                algorithm: 'AES-256-GCM',
                iv: row.initialization_vector.toString('base64'),
                ciphertext: row.ciphertext.toString('base64'),
              }),
            }),
          ),
        };
      },
  });

  server.put('/api/v1/students/:studentId/sensitive/:fieldKey', {
    preHandler: [
      requireSession,
      requirePermission('students:sensitive-edit'),
      requireRecentMfa,
      requireCsrf,
    ],
    /** Implements `handler` for registers the crypto http api routes, validates untrusted requests and connects authenticated fastify handlers to tenant-scoped services/postgresql transactions. It receives `request`. Direct links: `z .object({ studentId: z.uuid(), fieldKey: z.`, `z .object`, `z.uuid`, `z.string().regex`, `z.string`. */ handler:
      async (request) => {
        if (!request.identity)
          throw new ApplicationError(401, 'AUTHENTICATION_REQUIRED', 'Please sign in.');
        const { studentId, fieldKey } = z
          .object({
            studentId: z.uuid(),
            fieldKey: z.string().regex(/^[a-z][a-z0-9_-]{1,79}$/),
          })
          .parse(request.params);
        const body = encryptedFieldEnvelopeSchema
          .extend({ rowVersion: z.number().int().nonnegative().optional() })
          .parse(request.body);
        const iv = Buffer.from(body.iv, 'base64');
        const ciphertext = Buffer.from(body.ciphertext, 'base64');
        if (
          iv.byteLength !== 12 ||
          ciphertext.byteLength < 17 ||
          ciphertext.byteLength > 1_048_576
        ) {
          throw new ApplicationError(
            400,
            'ENCRYPTED_FIELD_INVALID',
            'The encrypted field envelope is invalid.',
          );
        }
        const result = await runInTenantTransaction(
          {
            tenantId: request.identity.user.tenantId,
            userId: request.identity.user.id,
            permissions: request.identity.user.permissions,
            requestId: request.id,
          },
          /** Executes the `handler` database work on the same PostgreSQL client after transaction-local tenant/user/permission context is set, preserving RLS isolation. It receives `client`. Direct links: `client.query`. */ (
            client,
          ) =>
            client.query<{ row_version: string }>(
              `insert into app.student_sensitive_fields (
               tenant_id, student_id, field_key, encryption_key_id,
               initialization_vector, ciphertext, created_by
             ) values ($1, $2, $3, $4, $5, $6, $7)
             on conflict (tenant_id, student_id, field_key) do update
               set encryption_key_id = excluded.encryption_key_id,
                   initialization_vector = excluded.initialization_vector,
                   ciphertext = excluded.ciphertext,
                   created_by = excluded.created_by
               where $8::bigint is not null
                 and app.student_sensitive_fields.row_version = $8::bigint
             returning row_version`,
              [
                request.identity?.user.tenantId,
                studentId,
                fieldKey,
                body.keyId,
                iv,
                ciphertext,
                request.identity?.user.id,
                body.rowVersion ?? null,
              ],
            ),
        );
        const row = result.rows[0];
        if (!row) {
          throw new ApplicationError(
            409,
            'VERSION_CONFLICT',
            'This sensitive field changed elsewhere. Refresh before saving.',
          );
        }
        return { rowVersion: Number(row.row_version) };
      },
  });
}

import { requiredValue } from '@edutex/contracts';

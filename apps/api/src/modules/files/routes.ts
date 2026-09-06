/**
 * @fileoverview Registers the files HTTP API routes, validates untrusted requests and connects authenticated Fastify handlers to tenant-scoped services/PostgreSQL transactions.
 *
 * @remarks
 * Direct links: `node:crypto`, `@aws-sdk/client-s3`, `@edutex/database`, `fastify`, `sharp`, `zod`, `../../shared/errors.js`, `../auth/identity-repository.js`, `/api/v1/public/branding/:fileId`, `/api/v1/students/:studentId/photo`, `/api/v1/files/:fileId`.
 * Security: Maintained source boundary; changes require strict type, test, lint, format and security review.
 */

import { createHash, randomUUID } from 'node:crypto';

import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { runInTenantTransaction } from '@edutex/database';
import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import { z } from 'zod';

import { ApplicationError } from '../../shared/errors.js';
import { resolvePublicBranding } from '../auth/identity-repository.js';
import { requireCsrf, requirePermission, requireSession } from '../auth/session.js';

const allowedPhotoMediaTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);

/** Re-encodes photos to remove metadata, polyglot payloads and oversized dimensions. */
async function sanitisePhoto(input: Buffer): Promise<Buffer> {
  try {
    return await sharp(input, { failOn: 'warning', limitInputPixels: 40_000_000 })
      .rotate()
      .resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 86, effort: 5 })
      .toBuffer();
  } catch {
    throw new ApplicationError(
      400,
      'PHOTO_INVALID',
      'The uploaded file is not a valid supported image.',
    );
  }
}

/** Registers Cloudflare-proxied, S3-backed photo upload and download routes. */
export function registerFileRoutes(server: FastifyInstance): void {
  const s3 = new S3Client({ region: server.configuration.awsRegion });

  server.get('/api/v1/public/branding/:fileId', {
    config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
    /** Implements `handler` for registers the files http api routes, validates untrusted requests and connects authenticated fastify handlers to tenant-scoped services/postgresql transactions. It receives `request`, `reply`. Direct links: `z.object({ fileId: z.uuid() }).parse`, `z.object`, `z.uuid`, `request.hostname.toLowerCase().replace(/:\d+$`, `request.hostname.toLowerCase().replace`. */ handler:
      async (request, reply) => {
        const { fileId } = z.object({ fileId: z.uuid() }).parse(request.params);
        const hostname = request.hostname.toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');
        const file = await resolvePublicBranding(hostname, fileId);
        if (!file)
          throw new ApplicationError(404, 'BRANDING_NOT_FOUND', 'The school logo was not found.');
        const object = await s3.send(
          new GetObjectCommand({ Bucket: file.storageBucket, Key: file.storageKey }),
        );
        if (!object.Body)
          throw new ApplicationError(404, 'BRANDING_NOT_FOUND', 'The school logo was not found.');
        reply.header('content-type', file.mediaType);
        reply.header('content-length', file.sizeBytes);
        reply.header('cache-control', 'public, max-age=3600, stale-while-revalidate=86400');
        reply.header('etag', `"${file.sha256Hex}"`);
        return reply.send(object.Body);
      },
  });

  server.put('/api/v1/students/:studentId/photo', {
    preHandler: [requireSession, requirePermission('photos:create'), requireCsrf],
    config: { rateLimit: { max: 20, timeWindow: '10 minutes' } },
    /** Implements `handler` for registers the files http api routes, validates untrusted requests and connects authenticated fastify handlers to tenant-scoped services/postgresql transactions. It receives `request`, `reply`. Direct links: `z.object({ studentId: z.uuid() }).parse`, `z.object`, `z.uuid`, `Number`, `Number.isSafeInteger`. */ handler:
      async (request, reply) => {
        if (!request.identity)
          throw new ApplicationError(401, 'AUTHENTICATION_REQUIRED', 'Please sign in.');
        const identity = request.identity;
        const { studentId } = z.object({ studentId: z.uuid() }).parse(request.params);
        const rowVersion = Number(request.headers['x-record-version']);
        if (!Number.isSafeInteger(rowVersion) || rowVersion < 0) {
          throw new ApplicationError(
            428,
            'VERSION_REQUIRED',
            'The current student row version is required.',
          );
        }
        const upload = await request.file();
        if (!upload || !allowedPhotoMediaTypes.has(upload.mimetype)) {
          throw new ApplicationError(400, 'PHOTO_TYPE_REJECTED', 'Use a JPEG, PNG or WebP image.');
        }
        const raw = await upload.toBuffer();
        const photo = await sanitisePhoto(raw);
        const fileId = randomUUID();
        const storageKey = `${identity.user.tenantId}/student-photos/${fileId}.webp`;
        const digest = createHash('sha256').update(photo).digest();

        await s3.send(
          new PutObjectCommand({
            Bucket: server.configuration.filesBucketName,
            Key: storageKey,
            Body: photo,
            ContentType: 'image/webp',
            CacheControl: 'private, max-age=3600',
            ServerSideEncryption: 'aws:kms',
            SSEKMSKeyId: server.configuration.filesKmsKeyId,
            Metadata: { tenant: identity.user.tenantId, purpose: 'student-photo' },
          }),
        );

        let oldStorageKey: string | undefined;
        try {
          await runInTenantTransaction(
            {
              tenantId: identity.user.tenantId,
              userId: identity.user.id,
              permissions: identity.user.permissions,
              requestId: request.id,
            },
            /** Executes the `handler` database work on the same PostgreSQL client after transaction-local tenant/user/permission context is set, preserving RLS isolation. It receives `client`. Direct links: `client.query`, `upload.filename.slice`. */ async (
              client,
            ) => {
              const current = await client.query<{
                photo_file_id: string | null;
                storage_key: string | null;
              }>(
                `select students.photo_file_id, files.storage_key
               from app.students
               left join app.files on files.tenant_id = students.tenant_id and files.id = students.photo_file_id
               where students.tenant_id = $1 and students.id = $2`,
                [identity.user.tenantId, studentId],
              );
              oldStorageKey = current.rows[0]?.storage_key ?? undefined;
              await client.query(
                `insert into app.files (
                 id, tenant_id, owner_user_id, purpose, storage_bucket, storage_key,
                 original_filename, media_type, size_bytes, sha256, scan_status,
                 encryption_key_arn, scanned_at
               ) values ($1, $2, $3, 'student-photo', $4, $5, $6, 'image/webp', $7, $8, 'clean', $9, clock_timestamp())`,
                [
                  fileId,
                  identity.user.tenantId,
                  identity.user.id,
                  server.configuration.filesBucketName,
                  storageKey,
                  upload.filename.slice(0, 255),
                  photo.byteLength,
                  digest,
                  server.configuration.filesKmsKeyId,
                ],
              );
              const updated = await client.query(
                `update app.students set photo_file_id = $3
               where tenant_id = $1 and id = $2 and row_version = $4
               returning id, row_version`,
                [identity.user.tenantId, studentId, fileId, rowVersion],
              );
              if (updated.rowCount !== 1) {
                throw new ApplicationError(
                  409,
                  'VERSION_CONFLICT',
                  'The student changed elsewhere. Refresh before uploading.',
                );
              }
              if (current.rows[0]?.photo_file_id) {
                await client.query(
                  `update app.files set deleted_at = clock_timestamp()
                 where tenant_id = $1 and id = $2`,
                  [identity.user.tenantId, current.rows[0].photo_file_id],
                );
              }
            },
          );
        } catch (error) {
          try {
            await s3.send(
              new DeleteObjectCommand({
                Bucket: server.configuration.filesBucketName,
                Key: storageKey,
              }),
            );
          } catch (cleanupError) {
            request.log.error(
              { err: cleanupError, storageKey },
              'Failed to remove rolled-back upload',
            );
          }
          throw error;
        }

        if (oldStorageKey) {
          try {
            await s3.send(
              new DeleteObjectCommand({
                Bucket: server.configuration.filesBucketName,
                Key: oldStorageKey,
              }),
            );
          } catch (cleanupError) {
            request.log.warn({ err: cleanupError, oldStorageKey }, 'Deferred old photo cleanup');
          }
        }
        return reply.status(201).send({ fileId, url: `/api/v1/files/${fileId}` });
      },
  });

  server.get('/api/v1/files/:fileId', {
    preHandler: [requireSession, requirePermission('photos:view')],
    /** Implements `handler` for registers the files http api routes, validates untrusted requests and connects authenticated fastify handlers to tenant-scoped services/postgresql transactions. It receives `request`, `reply`. Direct links: `z.object({ fileId: z.uuid() }).parse`, `z.object`, `z.uuid`, `runInTenantTransaction`, `s3.send`. */ handler:
      async (request, reply) => {
        if (!request.identity)
          throw new ApplicationError(401, 'AUTHENTICATION_REQUIRED', 'Please sign in.');
        const identity = request.identity;
        const { fileId } = z.object({ fileId: z.uuid() }).parse(request.params);
        const file = await runInTenantTransaction(
          {
            tenantId: identity.user.tenantId,
            userId: identity.user.id,
            permissions: identity.user.permissions,
            requestId: request.id,
          },
          /** Executes the `handler` database work on the same PostgreSQL client after transaction-local tenant/user/permission context is set, preserving RLS isolation. It receives `client`. Direct links: `client.query`. */ async (
            client,
          ) => {
            const result = await client.query<{
              storage_bucket: string;
              storage_key: string;
              media_type: string;
              size_bytes: string;
              sha256: Buffer;
            }>(
              `select storage_bucket, storage_key, media_type, size_bytes, sha256
             from app.files
             where tenant_id = $1 and id = $2 and scan_status = 'clean' and deleted_at is null`,
              [identity.user.tenantId, fileId],
            );
            return result.rows[0];
          },
        );
        if (!file) throw new ApplicationError(404, 'FILE_NOT_FOUND', 'The file was not found.');
        const object = await s3.send(
          new GetObjectCommand({ Bucket: file.storage_bucket, Key: file.storage_key }),
        );
        if (!object.Body)
          throw new ApplicationError(404, 'FILE_NOT_FOUND', 'The file was not found.');
        reply.header('content-type', file.media_type);
        reply.header('content-length', file.size_bytes);
        reply.header('cache-control', 'private, max-age=300, no-transform');
        reply.header('etag', `"${file.sha256.toString('hex')}"`);
        return reply.send(object.Body);
      },
  });
}

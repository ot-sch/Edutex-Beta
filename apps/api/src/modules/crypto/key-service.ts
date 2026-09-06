/**
 * @fileoverview Implements restricted-field key exchange and KMS envelope-encryption operations used by the protected student-data workflow.
 *
 * @remarks
 * Direct links: `node:crypto`, `@aws-sdk/client-kms`, `@edutex/database`, `../../config.js`, `../../shared/errors.js`.
 * Security: Cryptographic boundary; changes require protocol, AAD, key-lifecycle and cross-tenant review.
 */

import { hkdfSync, randomBytes, webcrypto } from 'node:crypto';

import { DecryptCommand, KMSClient } from '@aws-sdk/client-kms';
import { runInTenantTransaction, type TenantDatabaseContext } from '@edutex/database';

import type { ApplicationConfiguration } from '../../config.js';
import { ApplicationError } from '../../shared/errors.js';

const subtle = webcrypto.subtle;

interface StoredTenantKey {
  readonly id: string;
  readonly kms_key_id: string;
  readonly encrypted_data_key: Buffer;
}

export interface WrappedTenantKey {
  readonly keyId: string;
  readonly serverPublicKey: string;
  readonly salt: string;
  readonly iv: string;
  readonly wrappedKey: string;
  readonly expiresAt: string;
}

/**
 * Unwraps a KMS envelope key only long enough to re-wrap it to an ephemeral
 * browser ECDH key. The plaintext data key is never logged, cached or stored.
 */
export class TenantKeyService {
  private readonly kms: KMSClient;

  /** Constructs `key-service` and assembles the AWS/resource relationships defined in this class without exposing a public origin or broader credentials. It receives `configuration`. It uses only the local values shown in its body. */ public constructor(
    private readonly configuration: ApplicationConfiguration,
  ) {
    this.kms = new KMSClient({ region: configuration.awsRegion });
  }

  /**
   * Loads the tenant-bound encrypted data key, asks KMS to unwrap it with an exact encryption
   * context, and returns a five-minute ECDH/HKDF/AES-GCM browser envelope. Plaintext is zeroed in a
   * finally block and invalid client keys become a safe 400 response.
   */
  public async wrapForBrowser(
    context: TenantDatabaseContext,
    clientPublicKeyBase64: string,
    requestedKeyId?: string,
    medicalStudentId?: string,
  ): Promise<WrappedTenantKey> {
    const key = await runInTenantTransaction(
      context,
      /** Executes the `wrapForBrowser` database work on the same PostgreSQL client after transaction-local tenant/user/permission context is set, preserving RLS isolation. It receives `client`. Direct links: `client.query`. */ async (
        client,
      ) => {
        const result = medicalStudentId
          ? await client.query<StoredTenantKey>('select * from app.medical_encryption_key($1,$2)', [
              medicalStudentId,
              requestedKeyId ?? null,
            ])
          : await client.query<StoredTenantKey>(
              `select id, kms_key_id, encrypted_data_key
         from app.tenant_encryption_keys
         where tenant_id = $1
           and ($2::uuid is null and status = 'active' or id = $2::uuid and status <> 'retired')
         order by case when status = 'active' then 0 else 1 end, created_at desc
         limit 1`,
              [context.tenantId, requestedKeyId ?? null],
            );
        return result.rows[0];
      },
    );
    if (!key) {
      throw new ApplicationError(
        503,
        'ENCRYPTION_KEY_UNAVAILABLE',
        'Sensitive data encryption is not configured.',
      );
    }

    const decrypted = await this.kms.send(
      new DecryptCommand({
        CiphertextBlob: key.encrypted_data_key,
        KeyId: key.kms_key_id,
        EncryptionContext: {
          tenantId: context.tenantId,
          purpose: 'student-sensitive-data',
        },
      }),
    );
    if (decrypted.Plaintext?.byteLength !== 32) {
      throw new ApplicationError(
        503,
        'ENCRYPTION_KEY_INVALID',
        'Sensitive data encryption is unavailable.',
      );
    }

    const masterKey = new Uint8Array(decrypted.Plaintext);
    const plaintextKey = medicalStudentId
      ? new Uint8Array(
          hkdfSync(
            'sha256',
            masterKey,
            Buffer.from(context.tenantId),
            Buffer.from('edutex-medical:v1:' + medicalStudentId),
            32,
          ),
        )
      : masterKey;
    try {
      const clientPublicKey = await subtle.importKey(
        'raw',
        Buffer.from(clientPublicKeyBase64, 'base64'),
        { name: 'ECDH', namedCurve: 'P-256' },
        false,
        [],
      );
      const serverKeyPair = (await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
        'deriveBits',
      ])) as CryptoKeyPair;
      const sharedSecret = await subtle.deriveBits(
        { name: 'ECDH', public: clientPublicKey },
        serverKeyPair.privateKey,
        256,
      );
      const hkdfInput = await subtle.importKey('raw', sharedSecret, 'HKDF', false, ['deriveKey']);
      const salt = randomBytes(32);
      const information = new TextEncoder().encode(
        `edutex-field-key-wrap:v1:${context.tenantId}:${key.id}${medicalStudentId ? ':medical:' + medicalStudentId : ''}`,
      );
      const wrappingKey = await subtle.deriveKey(
        { name: 'HKDF', hash: 'SHA-256', salt, info: information },
        hkdfInput,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt'],
      );
      const iv = randomBytes(12);
      const wrappedKey = await subtle.encrypt(
        { name: 'AES-GCM', iv, additionalData: information, tagLength: 128 },
        wrappingKey,
        plaintextKey,
      );
      const serverPublicKey = await subtle.exportKey('raw', serverKeyPair.publicKey);
      return {
        keyId: key.id,
        serverPublicKey: Buffer.from(serverPublicKey).toString('base64'),
        salt: salt.toString('base64'),
        iv: iv.toString('base64'),
        wrappedKey: Buffer.from(wrappedKey).toString('base64'),
        expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      };
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      throw new ApplicationError(
        400,
        'CLIENT_KEY_INVALID',
        'The client encryption key was invalid.',
      );
    } finally {
      plaintextKey.fill(0);
      masterKey.fill(0);
      decrypted.Plaintext.fill(0);
    }
  }
}

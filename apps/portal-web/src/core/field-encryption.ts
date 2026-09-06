/**
 * @fileoverview Implements a protected-portal trust helper for same-origin API access, navigation, session state or browser-side restricted-field encryption.
 *
 * @remarks
 * Direct links: `@edutex/contracts`, `./api.js`, `/api/v1/crypto/session-key`.
 * Security: Cryptographic boundary; changes require protocol, AAD, key-lifecycle and cross-tenant review.
 */

import {
  encryptedFieldEnvelopeSchema,
  wrappedDataKeyResponseSchema,
  type EncryptedFieldEnvelope,
} from '@edutex/contracts';

import { apiRequest, jsonBody } from './api.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
let keyGeneration = 0;
const keyCache = new Map<
  string,
  { readonly tenantId: string; readonly key: CryptoKey; readonly expiresAt: number }
>();

/** Rejects a late key exchange or crypto result after logout, page lock or view teardown. */
function assertCurrentGeneration(generation: number): void {
  if (generation !== keyGeneration)
    throw new Error('Sensitive access has locked. Reopen the record to verify access again.');
}

/** Encodes binary Web Crypto output for the JSON envelope without altering its bytes. */
function toBase64(value: ArrayBuffer | ArrayBufferView): string {
  const bytes =
    value instanceof ArrayBuffer
      ? new Uint8Array(value)
      : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Decodes a validated envelope component into a fresh mutable byte array. */
function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/** Binds AES-GCM authenticated data to the tenant, student, field and protocol version. */
function fieldContext(
  tenantId: string,
  studentId: string,
  fieldKey: string,
): Uint8Array<ArrayBuffer> {
  return encoder.encode(`edutex-field:v1:${tenantId}:${studentId}:${fieldKey}`);
}

/**
 * Performs ephemeral ECDH with the API and unwraps the KMS-protected tenant key
 * into a non-extractable browser CryptoKey. Key bytes never enter storage.
 */
async function obtainTenantKey(
  tenantId: string,
  requestedKeyId?: string,
  medicalStudentId?: string,
): Promise<{ readonly id: string; readonly key: CryptoKey }> {
  const generation = keyGeneration;
  const cacheSuffix = medicalStudentId ? ':medical:' + medicalStudentId : '';
  if (requestedKeyId) {
    const cached = keyCache.get(requestedKeyId + cacheSuffix);
    if (cached?.tenantId === tenantId && cached.expiresAt > Date.now()) {
      return { id: requestedKeyId, key: cached.key };
    }
    keyCache.delete(requestedKeyId + cacheSuffix);
  }

  const clientKeyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveBits'],
  );
  const publicKey = await crypto.subtle.exportKey('raw', clientKeyPair.publicKey);
  const response = wrappedDataKeyResponseSchema.parse(
    await apiRequest(
      medicalStudentId ? `/api/v1/medical/${medicalStudentId}/key` : '/api/v1/crypto/session-key',
      {
        method: 'POST',
        ...jsonBody({
          clientPublicKey: toBase64(publicKey),
          ...(requestedKeyId ? { keyId: requestedKeyId } : {}),
        }),
      },
    ),
  );
  const serverPublicKey = await crypto.subtle.importKey(
    'raw',
    fromBase64(response.serverPublicKey),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const sharedSecret = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: serverPublicKey },
    clientKeyPair.privateKey,
    256,
  );
  const hkdfInput = await crypto.subtle.importKey('raw', sharedSecret, 'HKDF', false, [
    'deriveKey',
  ]);
  const information = encoder.encode(
    `edutex-field-key-wrap:v1:${tenantId}:${response.keyId}${cacheSuffix}`,
  );
  const wrappingKey = await crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: fromBase64(response.salt), info: information },
    hkdfInput,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  );
  const plaintextDataKey = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: fromBase64(response.iv),
      additionalData: information,
      tagLength: 128,
    },
    wrappingKey,
    fromBase64(response.wrappedKey),
  );
  try {
    const key = await crypto.subtle.importKey(
      'raw',
      plaintextDataKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
    const expiresAt = Date.parse(response.expiresAt);
    if (
      !Number.isFinite(expiresAt) ||
      expiresAt <= Date.now() ||
      expiresAt > Date.now() + 5 * 60_000
    ) {
      throw new Error('The sensitive-field key response had an invalid expiry.');
    }
    assertCurrentGeneration(generation);
    keyCache.set(response.keyId + cacheSuffix, { tenantId, key, expiresAt });
    return { id: response.keyId, key };
  } finally {
    new Uint8Array(plaintextDataKey).fill(0);
    new Uint8Array(sharedSecret).fill(0);
  }
}

/** Encrypts one field with AES-256-GCM and record-bound authenticated data. */
export async function encryptSensitiveField(input: {
  readonly tenantId: string;
  readonly studentId: string;
  readonly fieldKey: string;
  readonly plaintext: string;
  readonly medicalStudentId?: string;
}): Promise<EncryptedFieldEnvelope> {
  const generation = keyGeneration;
  const tenantKey = await obtainTenantKey(input.tenantId, undefined, input.medicalStudentId);
  assertCurrentGeneration(generation);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = encoder.encode(input.plaintext);
  try {
    const ciphertext = await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv,
        additionalData: fieldContext(input.tenantId, input.studentId, input.fieldKey),
        tagLength: 128,
      },
      tenantKey.key,
      plaintext,
    );
    assertCurrentGeneration(generation);
    return encryptedFieldEnvelopeSchema.parse({
      version: 1,
      keyId: tenantKey.id,
      algorithm: 'AES-256-GCM',
      iv: toBase64(iv),
      ciphertext: toBase64(ciphertext),
    });
  } finally {
    plaintext.fill(0);
  }
}

/** Decrypts a field only after recent MFA has allowed the key exchange. */
export async function decryptSensitiveField(input: {
  readonly tenantId: string;
  readonly studentId: string;
  readonly fieldKey: string;
  readonly envelope: EncryptedFieldEnvelope;
  readonly medicalStudentId?: string;
}): Promise<string> {
  const generation = keyGeneration;
  const tenantKey = await obtainTenantKey(
    input.tenantId,
    input.envelope.keyId,
    input.medicalStudentId,
  );
  assertCurrentGeneration(generation);
  const plaintext = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: fromBase64(input.envelope.iv),
      additionalData: fieldContext(input.tenantId, input.studentId, input.fieldKey),
      tagLength: 128,
    },
    tenantKey.key,
    fromBase64(input.envelope.ciphertext),
  );
  const bytes = new Uint8Array(plaintext);
  try {
    assertCurrentGeneration(generation);
    return decoder.decode(bytes);
  } finally {
    bytes.fill(0);
  }
}

/** Drops all in-memory key references at sign-out or page lock. */
export function clearSensitiveFieldKeys(): void {
  keyGeneration += 1;
  keyCache.clear();
}

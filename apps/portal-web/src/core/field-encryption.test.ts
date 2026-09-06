/** @fileoverview Exercises real browser-compatible cryptography and rejects stale, rebound or expired key material. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from './api.js';
import {
  clearSensitiveFieldKeys,
  decryptSensitiveField,
  encryptSensitiveField,
} from './field-encryption.js';

vi.mock(
  './api.js',
  /** Replaces only transport; the field encryption and Web Crypto operations remain real. */
  () => ({
    apiRequest: vi.fn(),
    /** Serialises the synthetic key-exchange request for the test server. */
    jsonBody: (value: unknown) => ({ body: JSON.stringify(value) }),
  }),
);

const tenantId = '10000000-0000-4000-8000-000000000001';
const studentId = '10000000-0000-4000-8000-000000000002';
const keyId = '10000000-0000-4000-8000-000000000003';
const context = { tenantId, studentId, fieldKey: 'medical-record', medicalStudentId: studentId };
const rawKey = crypto.getRandomValues(new Uint8Array(32));
const transport = vi.mocked(apiRequest);

/** Implements the documented ECDH/HKDF wrap protocol using a synthetic data key. */
async function wrap(path: string, options: RequestInit = {}) {
  if (typeof options.body !== 'string') throw new Error('Expected a JSON request body.');
  const request = JSON.parse(options.body) as { clientPublicKey: string };
  const peer = await crypto.subtle.importKey(
    'raw',
    Uint8Array.from(
      atob(request.clientPublicKey),
      /** Decodes the public key's transport encoding. */
      (character) => character.charCodeAt(0),
    ),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, [
    'deriveBits',
  ]);
  const shared = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: peer },
    pair.privateKey,
    256,
  );
  const input = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  const salt = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const suffix = path.includes('/medical/') ? ':medical:' + studentId : '';
  const info = new TextEncoder().encode(`edutex-field-key-wrap:v1:${tenantId}:${keyId}${suffix}`);
  const key = await crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info },
    input,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  );
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: info },
    key,
    rawKey,
  );
  return {
    keyId,
    serverPublicKey: Buffer.from(await crypto.subtle.exportKey('raw', pair.publicKey)).toString(
      'base64',
    ),
    salt: Buffer.from(salt).toString('base64'),
    iv: Buffer.from(iv).toString('base64'),
    wrappedKey: Buffer.from(ciphertext).toString('base64'),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
}

beforeEach(
  /** Starts each test with no cached keys or pending transport configuration. */
  () => {
    clearSensitiveFieldKeys();
    transport.mockReset();
    transport.mockImplementation(wrap);
  },
);

describe('restricted-field cryptographic lifecycle', /** Covers decryption integrity, a lock during exchange, and server key expiry. */ () => {
  it('round-trips the authorised record and rejects a different student or field', /** Verifies record-bound authenticated data with actual AES-GCM. */ async () => {
    const envelope = await encryptSensitiveField({ ...context, plaintext: 'Synthetic care note' });
    expect(await decryptSensitiveField({ ...context, envelope })).toBe('Synthetic care note');
    expect(transport).toHaveBeenCalledTimes(1);
    await expect(
      decryptSensitiveField({ ...context, studentId: keyId, envelope }),
    ).rejects.toThrow();
    await expect(
      decryptSensitiveField({ ...context, fieldKey: 'different-field', envelope }),
    ).rejects.toThrow();
  });
  it('rejects a response arriving after lock and performs a new exchange when reopened', /** Delays transport so a page lock occurs while the key request is in flight. */ async () => {
    const envelope = await encryptSensitiveField({ ...context, plaintext: 'Synthetic care note' });
    clearSensitiveFieldKeys();
    const started = Promise.withResolvers<undefined>();
    const release = Promise.withResolvers<undefined>();
    transport.mockImplementationOnce(
      /** Returns the stale server response only after the simulated page lock. */
      async (path, options) => {
        started.resolve(undefined);
        await release.promise;
        return wrap(path, options);
      },
    );
    const pending = decryptSensitiveField({ ...context, envelope });
    const rejected = expect(pending).rejects.toThrow('Sensitive access has locked');
    await started.promise;
    clearSensitiveFieldKeys();
    release.resolve(undefined);
    await rejected;
    expect(await decryptSensitiveField({ ...context, envelope })).toBe('Synthetic care note');
    expect(transport).toHaveBeenCalledTimes(3);
  });
  it('rejects expired key responses', /** Ensures a syntactically valid but expired response cannot unlock a record. */ async () => {
    transport.mockImplementationOnce(
      /** Supplies an expired server lease without changing the valid cryptographic payload. */
      async (path, options) => ({
        ...(await wrap(path, options)),
        expiresAt: new Date(Date.now() - 1_000).toISOString(),
      }),
    );
    await expect(
      encryptSensitiveField({ ...context, plaintext: 'Synthetic care note' }),
    ).rejects.toThrow('invalid expiry');
  });
});

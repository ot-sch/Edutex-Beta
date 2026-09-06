/**
 * @fileoverview Implements the Fastify backend application boundary, runtime configuration or shared server behavior consumed by Edutex API modules.
 *
 * @remarks
 * Direct links: `node:crypto`.
 * Security: Maintained source boundary; changes require strict type, test, lint, format and security review.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** Generates a cryptographically random base64url token with the requested entropy. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Hashes bearer material before it is used as a database or DynamoDB key. */
export function hashToken(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('base64url');
}

/** Compares untrusted tokens in constant time while safely handling length differences. */
export function safeTokenEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'utf8');
  const rightBuffer = Buffer.from(right, 'utf8');
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

/** Returns a SHA-256 digest suitable for privacy-preserving telemetry correlation. */
export function privacyHash(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

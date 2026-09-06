/** @fileoverview Generates opaque record identifiers with browser cryptographic randomness across supported browser environments. */
/** Uses native UUID generation when available, with a cryptographically equivalent UUIDv4 fallback for preview and older browsers. */
export function newRecordId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] ?? 0) & 15) | 64;
  bytes[8] = ((bytes[8] ?? 0) & 63) | 128;
  const hex = Array.from(
    bytes,

    /** Coordinates record id within record id, preserving the caller's validation and error handling. */
    (value) => value.toString(16).padStart(2, '0'),
  ).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

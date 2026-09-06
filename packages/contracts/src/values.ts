/** @fileoverview Runtime guards for required values, scalar UI text and safe error presentation. */
/** Rejects a missing trusted value at the point of use instead of hiding the possibility with a type assertion. */
export function requiredValue<T>(value: T | null | undefined): T {
  if (value === null || value === undefined)
    throw new Error('A required application value is missing.');
  return value;
}
/** Formats only scalar values; structured or untrusted objects never stringify to misleading display text. */
export function scalarText(value: unknown, fallback = ''): string {
  return typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
    ? String(value)
    : fallback;
}
/** Uses known Error messages and a bounded fallback for other rejected values. */
export function errorMessage(
  value: unknown,
  fallback = 'The request could not be completed.',
): string {
  return value instanceof Error ? value.message : fallback;
}
/** Extracts only text values from unknown collection input for tags and filter controls. */
export function stringValues(value: unknown): string[] {
  return Array.isArray(value)
    ? (value as unknown[]).filter(
        /** Selects value as unknown entries using the explicit typeof item string condition. */
        (item): item is string => typeof item === 'string',
      )
    : [];
}

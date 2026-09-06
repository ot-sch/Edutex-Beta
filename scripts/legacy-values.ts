/**
 * @fileoverview Implements a controlled operator, provisioning, migration, deployment or quality-assurance utility executed outside the long-running API.
 *
 * @remarks
 * Direct links: its owning workspace entry point and adjacent typed modules.
 * Security: Privileged operator boundary; fail closed, keep secrets out of arguments/files/logs and retain approved evidence.
 */

/** Selects a positive integer legacy alias and rejects values that would violate PostgreSQL. */
export function positiveIntegerValue(
  record: Record<string, unknown>,
  keys: readonly string[],
): number | null {
  for (const key of keys) {
    const raw = record[key];
    if (raw === undefined || raw === null || raw === '') continue;
    const value = Number(raw);
    if (Number.isSafeInteger(value) && value > 0) return value;
    throw new Error(`Legacy ${key} must be a positive whole number.`);
  }
  return null;
}

/** Converts common prototype boolean encodings without treating the string "false" as true. */
export function booleanValue(
  record: Record<string, unknown>,
  keys: readonly string[],
  fallback = false,
): boolean {
  for (const key of keys) {
    const raw = record[key];
    if (raw === undefined || raw === null || raw === '') continue;
    if (typeof raw === 'boolean') return raw;
    if (raw === 1 || raw === '1') return true;
    if (raw === 0 || raw === '0') return false;
    if (typeof raw === 'string') {
      const value = raw.trim().toLowerCase();
      if (['true', 'yes', 'y'].includes(value)) return true;
      if (['false', 'no', 'n'].includes(value)) return false;
    }
    throw new Error(`Legacy ${key} must contain a recognised boolean value.`);
  }
  return fallback;
}

/** Normalises an approved legacy enum and fails before SQL when the value is unsupported. */
export function choiceValue<T extends string>(
  record: Record<string, unknown>,
  keys: readonly string[],
  allowed: readonly T[],
  fallback: T,
  aliases: Readonly<Record<string, T>> = {},
): T {
  let raw = '';
  for (const key of keys) {
    const candidate = record[key];
    if (typeof candidate === 'string' && candidate.trim()) {
      raw = candidate.trim();
      break;
    }
  }
  if (!raw) return fallback;
  const normalised = raw.toLowerCase().replace(/[\s-]+/g, '_');
  const candidate = aliases[normalised] ?? normalised;
  if ((allowed as readonly string[]).includes(candidate)) return candidate as T;
  throw new Error(`Legacy ${keys[0] ?? 'enum'} contains an unsupported value.`);
}

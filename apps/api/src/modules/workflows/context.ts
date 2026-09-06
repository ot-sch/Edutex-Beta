/** @fileoverview Shared workflow authorization; session identity supplies all tenant and actor attributes. */
import type { FastifyRequest } from 'fastify';
import type { TenantDatabaseContext } from '@edutex/database';
import { ApplicationError } from '../../shared/errors.js';

/** Builds tenant transaction context from a verified session, never request body fields. */
export function contextFor(request: FastifyRequest): TenantDatabaseContext {
  const identity = request.identity;
  if (!identity) throw new ApplicationError(401, 'AUTHENTICATION_REQUIRED', 'Please sign in.');
  return {
    tenantId: identity.user.tenantId,
    userId: identity.user.id,
    permissions: identity.user.permissions,
    requestId: request.id,
  };
}

/** Requires an enabled module and an explicit action or management grant. */
export function authorize(request: FastifyRequest, module: string, action = 'view'): void {
  const context = contextFor(request);
  if (
    !request.identity?.user.enabledModules.includes(module as never) ||
    !context.permissions.some(
      /** Accepts only the action, module management, or platform grant. */ (p) =>
        [`${module}:${action}`, `${module}:manage`, 'platform:manage'].includes(p),
    )
  ) {
    throw new ApplicationError(403, 'PERMISSION_DENIED', 'Your role does not include this action.');
  }
}

/** Quotes only compile-time registry identifiers, with a defensive syntax assertion. */
export function identifier(value: string): string {
  if (!/^[a-z][a-z0-9_]*$/.test(value)) throw new Error('Untrusted SQL identifier');
  return `"${value}"`;
}

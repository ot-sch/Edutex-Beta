/**
 * @fileoverview Implements the public authentication-only React bundle that discovers tenant login methods and begins server-owned OAuth/passkey flows.
 *
 * @remarks
 * Direct links: `@edutex/contracts`, `/api/v1/public/tenant`, `/app/`.
 * Security: Authentication/session security boundary; changes require negative tests for replay, binding, MFA and unauthenticated access.
 */

import { publicTenantConfigurationSchema, type PublicTenantConfiguration } from '@edutex/contracts';

/** Fetches the hostname-scoped public login policy; no identity secrets are returned. */
export async function loadTenantConfiguration(
  signal: AbortSignal,
): Promise<PublicTenantConfiguration> {
  const response = await fetch('/api/v1/public/tenant', {
    credentials: 'same-origin',
    headers: { accept: 'application/json' },
    signal,
  });
  if (!response.ok) throw new Error('This school sign-in page is not available.');
  return publicTenantConfigurationSchema.parse(await response.json());
}

/** Starts a one-time PKCE authorization transaction at the server. */
export function beginAuthentication(method: string): void {
  const query = new URLSearchParams({ method, returnTo: '/app/' });
  window.location.assign(`/api/v1/auth/start?${query.toString()}`);
}

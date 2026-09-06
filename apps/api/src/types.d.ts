/**
 * @fileoverview Implements the Fastify backend application boundary, runtime configuration or shared server behavior consumed by Edutex API modules.
 *
 * @remarks
 * Direct links: `@edutex/contracts`, `./config.js`, `./modules/auth/session-store.js`.
 * Security: Maintained source boundary; changes require strict type, test, lint, format and security review.
 */

import type { SessionUser } from '@edutex/contracts';

import type { ApplicationConfiguration } from './config.js';
import type { SessionStore, TransactionStore } from './modules/auth/session-store.js';

export interface RequestIdentity {
  readonly sessionHash: string;
  readonly csrfToken: string;
  readonly deviceHash: string;
  readonly expiresAt: string;
  readonly user: SessionUser;
}

declare module 'fastify' {
  interface FastifyInstance {
    configuration: ApplicationConfiguration;
    sessionStore: SessionStore;
    transactionStore: TransactionStore;
  }

  interface FastifyRequest {
    identity?: RequestIdentity;
  }
}

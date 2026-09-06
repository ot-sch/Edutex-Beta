/**
 * @fileoverview Implements the Fastify backend application boundary, runtime configuration or shared server behavior consumed by Edutex API modules.
 *
 * @remarks
 * Direct links: `../package.json`.
 * Security: Maintained source boundary; changes require strict type, test, lint, format and security review.
 */

import apiPackage from '../package.json' with { type: 'json' };

/**
 * Exposes the API workspace version as the single runtime release identifier.
 * Reading package metadata prevents health responses from drifting from the
 * version approved in the lockfile and release documentation.
 */
export const releaseVersion: string = apiPackage.version;

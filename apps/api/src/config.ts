/**
 * @fileoverview Implements the Fastify backend application boundary, runtime configuration or shared server behavior consumed by Edutex API modules.
 *
 * @remarks
 * Direct links: `node:path`, `zod`.
 * Security: Maintained source boundary; changes require strict type, test, lint, format and security review.
 */

import { resolve } from 'node:path';

import { z } from 'zod';

const environmentSchema = z
  .object({
    ALERT_EMAIL_FROM: z.email().or(z.literal('')).default(''),
    ALERT_SMS_ENABLED: z.enum(['true', 'false']).default('false'),
    AUTH_TRANSACTION_TABLE_NAME: z.string().min(1).default('edutex-auth-transactions'),
    AUTH_WEB_ROOT: z.string().min(1).default('apps/auth-web/dist'),
    AWS_REGION: z.string().min(1).default('ap-southeast-2'),
    FILES_BUCKET_NAME: z.string().min(1).default('edutex-files'),
    FILES_KMS_KEY_ID: z.string().min(1).default('alias/edutex-files'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(8080),
    PORTAL_WEB_ROOT: z.string().min(1).default('apps/portal-web/dist'),
    PUBLIC_BASE_URL: z.url().default('http://localhost:8080'),
    PUBLIC_HOSTNAME: z.string().min(1).optional(),
    SESSION_STORE: z.enum(['memory', 'dynamodb']).default('memory'),
    SESSION_TABLE_NAME: z.string().min(1).default('edutex-sessions'),
    TENANT_DATA_KEY_KMS_KEY_ID: z.string().min(1).default('alias/edutex-tenant-data'),
  })
  .superRefine(
    /** Performs the local `z .object({ AUTH_TRANSACTION_TABLE_NAME: z.string().min(1).d` operation inside `config` and returns control to the surrounding feature only after this body completes. It receives `value`, `context`. Direct links: `context.addIssue`. */ (
      value,
      context,
    ) => {
      if (value.NODE_ENV !== 'production') return;
      const publicBaseUrl = new URL(value.PUBLIC_BASE_URL);
      if (
        publicBaseUrl.protocol !== 'https:' ||
        publicBaseUrl.username ||
        publicBaseUrl.password ||
        publicBaseUrl.port ||
        publicBaseUrl.pathname !== '/' ||
        publicBaseUrl.search ||
        publicBaseUrl.hash
      ) {
        context.addIssue({
          code: 'custom',
          path: ['PUBLIC_BASE_URL'],
          message:
            'Production public URLs must be a credential-free HTTPS origin with no port, path, query or fragment.',
        });
      }
      if (value.PUBLIC_HOSTNAME !== publicBaseUrl.hostname) {
        context.addIssue({
          code: 'custom',
          path: ['PUBLIC_HOSTNAME'],
          message: 'Production PUBLIC_HOSTNAME must exactly match the PUBLIC_BASE_URL hostname.',
        });
      }
      if (value.SESSION_STORE !== 'dynamodb') {
        context.addIssue({
          code: 'custom',
          path: ['SESSION_STORE'],
          message: 'Production sessions must use the encrypted DynamoDB session store.',
        });
      }
    },
  );

export interface ApplicationConfiguration {
  readonly alertEmailFrom?: string;
  readonly alertSmsEnabled?: boolean;
  readonly authTransactionTableName: string;
  readonly authWebRoot: string;
  readonly awsRegion: string;
  readonly cookieSecure: boolean;
  readonly filesBucketName: string;
  readonly filesKmsKeyId: string;
  readonly logLevel: string;
  readonly nodeEnvironment: 'development' | 'test' | 'production';
  readonly port: number;
  readonly portalWebRoot: string;
  readonly publicBaseUrl: URL;
  readonly publicHostname: string;
  readonly sessionStore: 'memory' | 'dynamodb';
  readonly sessionTableName: string;
  readonly tenantDataKeyKmsKeyId: string;
}

/**
 * Rejects secret values embedded in production environment variables. Production ECS receives
 * identifiers and IAM roles only; the database password is reserved for isolated one-shot task
 * definitions, and static AWS/Cloudflare credentials must never enter the long-running API task.
 */
function assertNoProductionSecretEnvironment(environment: NodeJS.ProcessEnv): void {
  if (environment['NODE_ENV'] !== 'production') return;
  for (const name of [
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
    'AWS_SESSION_TOKEN',
    'CLOUDFLARE_API_TOKEN',
    'DB_PASSWORD',
  ]) {
    if (environment[name]) {
      throw new Error(
        `Production API configuration forbids ${name}; use the workload role or approved secret injection boundary.`,
      );
    }
  }
}

/** Parses environment configuration once and rejects insecure production combinations. */
export function loadConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
): ApplicationConfiguration {
  assertNoProductionSecretEnvironment(environment);
  const value = environmentSchema.parse(environment);
  const publicBaseUrl = new URL(value.PUBLIC_BASE_URL);
  return {
    alertEmailFrom: value.ALERT_EMAIL_FROM,
    alertSmsEnabled: value.ALERT_SMS_ENABLED === 'true',
    authTransactionTableName: value.AUTH_TRANSACTION_TABLE_NAME,
    authWebRoot: resolve(value.AUTH_WEB_ROOT),
    awsRegion: value.AWS_REGION,
    cookieSecure: value.NODE_ENV === 'production',
    filesBucketName: value.FILES_BUCKET_NAME,
    filesKmsKeyId: value.FILES_KMS_KEY_ID,
    logLevel: value.LOG_LEVEL,
    nodeEnvironment: value.NODE_ENV,
    port: value.PORT,
    portalWebRoot: resolve(value.PORTAL_WEB_ROOT),
    publicBaseUrl,
    publicHostname: value.PUBLIC_HOSTNAME ?? publicBaseUrl.hostname,
    sessionStore: value.SESSION_STORE,
    sessionTableName: value.SESSION_TABLE_NAME,
    tenantDataKeyKmsKeyId: value.TENANT_DATA_KEY_KMS_KEY_ID,
  };
}

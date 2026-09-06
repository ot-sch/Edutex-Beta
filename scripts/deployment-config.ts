/**
 * @fileoverview Defines the only non-secret configuration accepted by the RC6 production
 * deployment assistant. This module connects the beginner-facing configuration questions to the
 * Cloudflare Terraform variables, AWS CDK parameters and one-shot school bootstrap arguments. It
 * intentionally rejects credentials, placeholder values and cross-account/cross-region ARNs before
 * any deployment command can run.
 */

import { isIP } from 'node:net';

import { z } from 'zod';

import { readTextSecure } from './deployment-state.js';

export const releaseVersion = '1.0.0-rc.6';

const awsRegionSchema = z
  .string()
  .regex(/^[a-z]{2}(?:-[a-z]+)+-\d$/, 'Use a complete AWS region such as ap-southeast-2.');
const accountIdSchema = z.string().regex(/^\d{12}$/, 'Use the 12-digit AWS account ID.');
const hostnameSchema = z
  .string()
  .regex(
    /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/,
    'Use a complete lower-case hostname such as portal.school.example.',
  );
const cloudflareIdentifierSchema = z
  .string()
  .regex(/^[0-9a-f]{32}$/i, 'Use the 32-character identifier copied from Cloudflare.');
const cidrSchema = z.string().refine(
  /**
   * Confirms that the value contains an IPv4/IPv6 address and a possible prefix length. Terraform
   * performs the authoritative cidrhost validation again before a plan can be produced.
   */
  (value) => {
    const [address, prefix, extra] = value.split('/');
    if (!address || extra !== undefined || isIP(address) === 0) return false;
    if (prefix === undefined) return true;
    const bits = Number(prefix);
    const maximum = isIP(address) === 4 ? 32 : 128;
    return Number.isInteger(bits) && bits >= 0 && bits <= maximum;
  },
  'Use an IPv4 or IPv6 CIDR, for example 203.0.113.0/24.',
);

export const deploymentConfigurationSchema = z
  .object({
    schemaVersion: z.literal(1),
    release: z.literal(releaseVersion),
    deploymentPurpose: z.enum(['new-school-production', 'existing-school-upgrade']),
    change: z.object({
      id: z
        .string()
        .trim()
        .regex(/^[A-Za-z][A-Za-z0-9._-]{2,79}$/),
      releaseManager: z.string().trim().min(2).max(160),
      securityApprover: z.string().trim().min(2).max(160),
      windowStart: z.iso.datetime({ offset: true }),
      windowEnd: z.iso.datetime({ offset: true }),
    }),
    aws: z.object({
      profile: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{1,127}$/),
      accountId: accountIdSchema,
      region: awsRegionSchema,
      stackName: z.literal('Edutex-production'),
      cloudflareTunnelTokenSecretArn: z
        .string()
        .regex(/^arn:[a-z0-9-]+:secretsmanager:[a-z0-9-]+:\d{12}:secret:.+$/),
      terraformState: z.object({
        bucket: z.string().regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/),
        key: z.string().min(8).max(512),
        kmsKeyArn: z.string().regex(/^arn:[a-z0-9-]+:kms:[a-z0-9-]+:\d{12}:key\/.+$/),
      }),
    }),
    alerts: z
      .object({
        emailFrom: z.email().or(z.literal('')).default(''),
        smsEnabled: z.boolean().default(false),
      })
      .default({ emailFrom: '', smsEnabled: false }),
    cloudflare: z.object({
      accountId: cloudflareIdentifierSchema,
      zoneId: cloudflareIdentifierSchema,
      tunnelId: z.uuid(),
      hostname: hostnameSchema,
      allowedIpCidrs: z.array(cidrSchema).max(200).default([]),
      allowedCountryCodes: z
        .array(z.string().regex(/^[A-Z]{2}$/))
        .max(249)
        .default([]),
      adminIpCidrs: z.array(cidrSchema).max(200).default([]),
      enableBotManagement: z.boolean().default(false),
    }),
    school: z.object({
      slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,40}$/),
      legalName: z.string().trim().min(2).max(160),
      hostname: hostnameSchema,
      campusName: z.string().trim().min(2).max(160),
      academicYearName: z.string().trim().min(2).max(80),
      academicYearStart: z.iso.date(),
      academicYearEnd: z.iso.date(),
      timezone: z
        .string()
        .min(3)
        .max(80)
        .refine(
          /**
           * Verifies the IANA time-zone name with the same JavaScript runtime used by the school
           * bootstrap task, preventing a configuration that would fail only after AWS resources exist.
           */
          (value) => {
            try {
              new Intl.DateTimeFormat('en-GB', { timeZone: value }).format();
              return true;
            } catch {
              return false;
            }
          },
          'Use a recognised IANA time zone such as Australia/Melbourne.',
        ),
      country: z.string().regex(/^[A-Z]{2}$/),
      initialAdministrator: z.object({
        email: z.email(),
        displayName: z.string().trim().min(2).max(160),
      }),
      email: z.object({
        sesSourceArn: z.string().regex(/^arn:[a-z0-9-]+:ses:[a-z0-9-]+:\d{12}:identity\/.+$/),
        fromAddress: z.email(),
        configurationSet: z
          .string()
          .regex(/^[A-Za-z0-9_-]{1,64}$/)
          .optional(),
      }),
    }),
    application: z.object({
      desiredCount: z.number().int().min(3).max(30).default(3),
    }),
  })
  .superRefine(
    /**
     * Enforces relationships that individual field schemas cannot prove: one hostname, one AWS
     * account/region, a correctly scoped state key and a deployment window that ends after it starts.
     */
    (value, context) => {
      if (value.cloudflare.hostname !== value.school.hostname) {
        context.addIssue({
          code: 'custom',
          path: ['school', 'hostname'],
          message: 'The school and Cloudflare hostnames must be identical.',
        });
      }
      if (value.school.academicYearEnd < value.school.academicYearStart) {
        context.addIssue({
          code: 'custom',
          path: ['school', 'academicYearEnd'],
          message: 'The academic year end must be on or after its start.',
        });
      }
      if (Date.parse(value.change.windowEnd) <= Date.parse(value.change.windowStart)) {
        context.addIssue({
          code: 'custom',
          path: ['change', 'windowEnd'],
          message: 'The maintenance window end must be after its start.',
        });
      }
      const requiredStateKey = `edutex/${value.school.slug}/cloudflare.tfstate`;
      if (value.aws.terraformState.key !== requiredStateKey) {
        context.addIssue({
          code: 'custom',
          path: ['aws', 'terraformState', 'key'],
          message: `Use the tenant-scoped state key ${requiredStateKey}.`,
        });
      }
      for (const [path, arn] of [
        ['aws.cloudflareTunnelTokenSecretArn', value.aws.cloudflareTunnelTokenSecretArn],
        ['aws.terraformState.kmsKeyArn', value.aws.terraformState.kmsKeyArn],
        ['school.email.sesSourceArn', value.school.email.sesSourceArn],
      ] as const) {
        const arnParts = arn.split(':');
        if (arnParts[3] !== value.aws.region || arnParts[4] !== value.aws.accountId) {
          context.addIssue({
            code: 'custom',
            path: path.split('.'),
            message: 'The ARN must belong to the configured production account and region.',
          });
        }
      }
      const duplicateLists = [
        ['cloudflare.allowedIpCidrs', value.cloudflare.allowedIpCidrs],
        ['cloudflare.allowedCountryCodes', value.cloudflare.allowedCountryCodes],
        ['cloudflare.adminIpCidrs', value.cloudflare.adminIpCidrs],
      ] as const;
      for (const [path, values] of duplicateLists) {
        if (new Set(values).size !== values.length) {
          context.addIssue({
            code: 'custom',
            path: path.split('.'),
            message: 'Remove duplicate entries.',
          });
        }
      }
    },
  );

export type DeploymentConfiguration = z.infer<typeof deploymentConfigurationSchema>;

const forbiddenKey =
  /(?:password|private[_-]?key|client[_-]?secret|api[_-]?token|session[_-]?token|cookie|recovery[_-]?code)$/i;
const forbiddenValue =
  /-----BEGIN [A-Z ]*PRIVATE KEY-----|(?:^|\s)(?:password|token|secret)\s*[:=]\s*\S+/i;
const placeholderValue =
  /(?:example\.(?:com|org)|school\.example|111111111111|0123456789abcdef|fedcba9876543210|00000000-0000-4000-8000-000000000000|replace[-_ ]?me|placeholder)/i;

/**
 * Walks the parsed JSON before schema validation and rejects secret-bearing property names or
 * obvious credential material. The one permitted secret-related value is an AWS Secrets Manager
 * ARN, which is an identifier rather than the tunnel token stored behind it.
 */
function assertNoSecrets(value: unknown, path = '$'): void {
  if (Array.isArray(value)) {
    value.forEach(
      /** Checks each array item while preserving its exact JSON path for an actionable error. */
      (item, index) => {
        assertNoSecrets(item, `${path}[${index}]`);
      },
    );
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (key !== 'cloudflareTunnelTokenSecretArn' && forbiddenKey.test(key)) {
        throw new Error(`Secret-like property ${path}.${key} is forbidden in deployment JSON.`);
      }
      assertNoSecrets(child, `${path}.${key}`);
    }
    return;
  }
  if (typeof value === 'string' && forbiddenValue.test(value)) {
    throw new Error(`Secret-like value found at ${path}; move it to the approved secret store.`);
  }
}

/**
 * Rejects tutorial placeholders after schema parsing so a syntactically valid example file cannot
 * be mistaken for an approved production configuration.
 */
function assertNoPlaceholders(configuration: DeploymentConfiguration): void {
  const serialized = JSON.stringify(configuration);
  if (placeholderValue.test(serialized)) {
    throw new Error('The deployment configuration still contains an example or placeholder value.');
  }
}

/**
 * Reads, bounds, secret-scans and validates one deployment JSON file. Every deployment command uses
 * this function, so Terraform, CDK, ECS migration and school bootstrap all receive the same reviewed
 * tenant/account/hostname values.
 */
export async function loadDeploymentConfiguration(
  filePath: string,
): Promise<DeploymentConfiguration> {
  const source = await readTextSecure(filePath, 256 * 1024);
  const untrusted: unknown = JSON.parse(source);
  assertNoSecrets(untrusted);
  const configuration = deploymentConfigurationSchema.parse(untrusted);
  assertNoPlaceholders(configuration);
  return configuration;
}

/**
 * Produces the complete non-secret Terraform variable object consumed by `infra/cloudflare`. The
 * Cloudflare API token is deliberately absent and must arrive through `CLOUDFLARE_API_TOKEN`.
 */
export function terraformVariables(
  configuration: DeploymentConfiguration,
): Readonly<Record<string, unknown>> {
  return {
    account_id: configuration.cloudflare.accountId,
    zone_id: configuration.cloudflare.zoneId,
    hostname: configuration.cloudflare.hostname,
    tunnel_id: configuration.cloudflare.tunnelId,
    allowed_ip_cidrs: configuration.cloudflare.allowedIpCidrs,
    allowed_country_codes: configuration.cloudflare.allowedCountryCodes,
    admin_ip_cidrs: configuration.cloudflare.adminIpCidrs,
    enable_bot_management: configuration.cloudflare.enableBotManagement,
  };
}

/**
 * Produces the tenant-scoped S3 backend settings used by `terraform init`. The returned text contains
 * identifiers only; credentials remain in the selected AWS profile and short-lived Cloudflare token
 * environment variable.
 */
export function terraformBackend(configuration: DeploymentConfiguration): string {
  const state = configuration.aws.terraformState;
  return [
    `bucket = ${JSON.stringify(state.bucket)}`,
    `key = ${JSON.stringify(state.key)}`,
    `region = ${JSON.stringify(configuration.aws.region)}`,
    'encrypt = true',
    `kms_key_id = ${JSON.stringify(state.kmsKeyArn)}`,
    'use_lockfile = true',
    '',
  ].join('\n');
}

/**
 * Builds the command override consumed by the private ECS school-bootstrap task. It links the
 * reviewed configuration to `scripts/bootstrap-school.ts` without embedding any password or KMS
 * plaintext key in the task definition or local file.
 */
export function schoolBootstrapCommand(configuration: DeploymentConfiguration): readonly string[] {
  const school = configuration.school;
  const command = [
    'node',
    'scripts/dist/bootstrap-school.js',
    '--slug',
    school.slug,
    '--name',
    school.legalName,
    '--hostname',
    school.hostname,
    '--admin-email',
    school.initialAdministrator.email,
    '--admin-name',
    school.initialAdministrator.displayName,
    '--campus-name',
    school.campusName,
    '--academic-year-name',
    school.academicYearName,
    '--academic-year-start',
    school.academicYearStart,
    '--academic-year-end',
    school.academicYearEnd,
    '--timezone',
    school.timezone,
    '--country',
    school.country,
    '--region',
    configuration.aws.region,
    '--ses-source-arn',
    school.email.sesSourceArn,
    '--ses-from-address',
    school.email.fromAddress,
  ];
  if (school.email.configurationSet) {
    command.push('--ses-configuration-set', school.email.configurationSet);
  }
  return command;
}

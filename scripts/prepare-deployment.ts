/**
 * @fileoverview Implements the beginner-facing RC6 configuration interview. It asks for one
 * approved, non-secret value at a time, validates each answer immediately, performs the complete
 * cross-field deployment validation, and writes an owner-only JSON file consumed by the production
 * planner. It never asks for or stores passwords, API tokens, tunnel tokens or private keys.
 */

import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createInterface, type Interface } from 'node:readline/promises';

import { z, type ZodType } from 'zod';

import {
  deploymentConfigurationSchema,
  releaseVersion,
  type DeploymentConfiguration,
} from './deployment-config.js';
import { writeJsonSecure } from './deployment-state.js';

interface PrepareArguments {
  readonly outputPath: string;
  readonly replace: boolean;
}

/**
 * Parses only `--output <path>` and optional `--replace`. Unknown flags and missing values are
 * rejected so a typo cannot redirect the approved configuration to an unintended location.
 */
function parseArguments(arguments_: readonly string[]): PrepareArguments {
  let outputPath = '';
  let replace = false;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === '--replace') {
      replace = true;
      continue;
    }
    if (argument === '--output') {
      const value = arguments_[index + 1];
      if (!value) throw new Error('--output must be followed by a file path.');
      outputPath = resolve(value);
      index += 1;
      continue;
    }
    throw new Error(`Unknown preparation option: ${argument ?? '(missing)'}.`);
  }
  if (!outputPath) {
    throw new Error(
      'Choose an operator file with --output, for example --output ../edutex-operator/acme/production.json.',
    );
  }
  return { outputPath, replace };
}

/**
 * Determines whether a path already exists without treating a normal ENOENT result as an error.
 * Other filesystem errors still stop preparation because ownership/permission state is uncertain.
 */
async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

/**
 * Prints one question with its reason/example, repeats on validation failure and returns only the
 * schema-validated value. Defaults are applied only when the operator presses Enter on an empty line.
 */
async function ask<T>(
  terminal: Interface,
  label: string,
  explanation: string,
  schema: ZodType<T>,
  defaultValue?: string,
): Promise<T> {
  for (;;) {
    process.stdout.write(`\n${label}\n${explanation}\n`);
    const suffix = defaultValue === undefined ? ': ' : ` [${defaultValue}]: `;
    const typedAnswer = (await terminal.question(suffix)).trim();
    const answer = typedAnswer.length > 0 ? typedAnswer : (defaultValue ?? '');
    const parsed = schema.safeParse(answer);
    if (parsed.success) return parsed.data;
    process.stdout.write(`NOT ACCEPTED: ${parsed.error.issues[0]?.message ?? 'Invalid value.'}\n`);
  }
}

/**
 * Converts a comma-separated answer into trimmed, non-empty entries. An empty answer deliberately
 * becomes an empty list, which Terraform interprets as no restriction for that particular policy.
 */
function commaSeparated(answer: string): string[] {
  if (!answer.trim()) return [];
  return answer
    .split(',')
    .map(
      /** Removes operator spacing around each comma-delimited item before schema validation. */
      (value) => value.trim(),
    )
    .filter(
      /** Discards accidental empty items such as a trailing comma. */
      (value) => value.length > 0,
    );
}

/**
 * Runs the complete interactive interview and returns an object that still must pass the shared
 * cross-field schema. This function links human answers to the same validator used by plan/apply.
 */
async function interview(terminal: Interface): Promise<DeploymentConfiguration> {
  const text = z.string().trim().min(2).max(160);
  const region = await ask(
    terminal,
    'AWS region',
    'Type the approved region that will contain every Edutex AWS resource.',
    z.string().regex(/^[a-z]{2}(?:-[a-z]+)+-\d$/),
    'ap-southeast-2',
  );
  const accountId = await ask(
    terminal,
    'AWS account ID',
    'Type the 12-digit ID of the dedicated production AWS account.',
    z.string().regex(/^\d{12}$/),
  );
  const slug = await ask(
    terminal,
    'School slug',
    'Type the permanent short lower-case identifier, for example haileybury.',
    z.string().regex(/^[a-z0-9][a-z0-9-]{1,40}$/),
  );
  const hostname = await ask(
    terminal,
    'Edutex hostname',
    'Type only the complete lower-case hostname. Do not include https:// or a trailing slash.',
    z.string().regex(/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/),
  );
  const configurationSet = await ask(
    terminal,
    'SES configuration set',
    'Type the approved configuration-set name, or press Enter if the security/email owner confirmed none is required.',
    z.string().regex(/^[A-Za-z0-9_-]{0,64}$/),
    'edutex-transactional',
  );
  const answer: unknown = {
    schemaVersion: 1,
    release: releaseVersion,
    deploymentPurpose: 'new-school-production',
    change: {
      id: await ask(
        terminal,
        'Approved change ID',
        'Type the service-desk/change-management identifier authorising this deployment.',
        z.string().regex(/^[A-Za-z][A-Za-z0-9._-]{2,79}$/),
      ),
      releaseManager: await ask(
        terminal,
        'Release manager',
        'Type the full name of the person who approved the RC6 release.',
        text,
      ),
      securityApprover: await ask(
        terminal,
        'Security/cloud approver',
        'Type the full name of the person who approved the security and cloud plan.',
        text,
      ),
      windowStart: await ask(
        terminal,
        'Maintenance window start',
        'Type an ISO date/time with an offset, for example 2026-09-12T20:00:00+10:00.',
        z.iso.datetime({ offset: true }),
      ),
      windowEnd: await ask(
        terminal,
        'Maintenance window end',
        'Type the later ISO date/time at which deployment work must stop.',
        z.iso.datetime({ offset: true }),
      ),
    },
    aws: {
      profile: await ask(
        terminal,
        'AWS CLI profile',
        'Type the named SSO profile configured for the production deployment role.',
        z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{1,127}$/),
        'edutex-production-deployer',
      ),
      accountId,
      region,
      stackName: 'Edutex-production',
      cloudflareTunnelTokenSecretArn: await ask(
        terminal,
        'Cloudflare Tunnel token secret ARN',
        'Paste the ARN shown by AWS Secrets Manager. Do NOT paste the tunnel token itself.',
        z.string().regex(/^arn:[a-z0-9-]+:secretsmanager:[a-z0-9-]+:\d{12}:secret:.+$/),
      ),
      terraformState: {
        bucket: await ask(
          terminal,
          'Terraform state bucket',
          'Type the approved encrypted S3 bucket name used only for infrastructure state.',
          z.string().regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/),
        ),
        key: `edutex/${slug}/cloudflare.tfstate`,
        kmsKeyArn: await ask(
          terminal,
          'Terraform state KMS key ARN',
          'Paste the customer-managed KMS key ARN for the state bucket.',
          z.string().regex(/^arn:[a-z0-9-]+:kms:[a-z0-9-]+:\d{12}:key\/.+$/),
        ),
      },
    },
    cloudflare: {
      accountId: await ask(
        terminal,
        'Cloudflare account ID',
        'Paste the 32-character Account ID from the Cloudflare dashboard overview.',
        z.string().regex(/^[0-9a-f]{32}$/i),
      ),
      zoneId: await ask(
        terminal,
        'Cloudflare zone ID',
        'Paste the 32-character Zone ID for the school domain.',
        z.string().regex(/^[0-9a-f]{32}$/i),
      ),
      tunnelId: await ask(
        terminal,
        'Cloudflare Tunnel ID',
        'Paste the UUID shown on the named Tunnel page. Do not paste its token.',
        z.uuid(),
      ),
      hostname,
      allowedIpCidrs: commaSeparated(
        await ask(
          terminal,
          'Whole-site allowed IP ranges',
          'Type approved CIDRs separated by commas, or press Enter for no IP restriction.',
          z.string(),
          '',
        ),
      ),
      allowedCountryCodes: commaSeparated(
        await ask(
          terminal,
          'Whole-site allowed countries',
          'Type upper-case two-letter country codes separated by commas, or press Enter for none.',
          z.string(),
          'AU',
        ),
      ),
      adminIpCidrs: commaSeparated(
        await ask(
          terminal,
          'Administration IP ranges',
          'Type the approved administrator network CIDRs separated by commas. Empty means identity controls only and requires recorded risk acceptance.',
          z.string(),
          '',
        ),
      ),
      enableBotManagement:
        (await ask(
          terminal,
          'Enable Cloudflare Bot Management rule?',
          'Type yes only if the purchased plan exposes Bot Management scores; otherwise type no.',
          z.enum(['yes', 'no']),
          'no',
        )) === 'yes',
    },
    school: {
      slug,
      legalName: await ask(
        terminal,
        'School legal/display name',
        'Type the reviewed school name exactly as it should appear in Edutex.',
        text,
      ),
      hostname,
      campusName: await ask(
        terminal,
        'First campus name',
        'Type the first campus that should exist after provisioning.',
        text,
        'Main Campus',
      ),
      academicYearName: await ask(
        terminal,
        'Academic year name',
        'Type the label staff will see, for example 2027 School Year.',
        z.string().trim().min(2).max(80),
      ),
      academicYearStart: await ask(
        terminal,
        'Academic year start',
        'Type the first date as YYYY-MM-DD.',
        z.iso.date(),
      ),
      academicYearEnd: await ask(
        terminal,
        'Academic year end',
        'Type the last date as YYYY-MM-DD.',
        z.iso.date(),
      ),
      timezone: await ask(
        terminal,
        'School time zone',
        'Type the IANA name used by calendars and attendance.',
        z.string().min(3).max(80),
        'Australia/Melbourne',
      ),
      country: await ask(
        terminal,
        'School country code',
        'Type the upper-case two-letter ISO country code.',
        z.string().regex(/^[A-Z]{2}$/),
        'AU',
      ),
      initialAdministrator: {
        email: await ask(
          terminal,
          'Initial administrator email',
          "Type the named person's individual school address. Cognito sends the one-time invitation here.",
          z.email(),
        ),
        displayName: await ask(
          terminal,
          'Initial administrator name',
          'Type the full display name for the seeded setup administrator.',
          text,
        ),
      },
      email: {
        sesSourceArn: await ask(
          terminal,
          'Verified SES identity ARN',
          'Paste the verified domain/address identity ARN from the same AWS account and region.',
          z.string().regex(/^arn:[a-z0-9-]+:ses:[a-z0-9-]+:\d{12}:identity\/.+$/),
        ),
        fromAddress: await ask(
          terminal,
          'Invitation From address',
          'Type the verified sender used for Cognito invitations.',
          z.email(),
        ),
        ...(configurationSet ? { configurationSet } : {}),
      },
    },
    application: {
      desiredCount: Number(
        await ask(
          terminal,
          'Production application task count',
          'Type 3 unless the reviewed capacity plan requires a higher value (maximum 30).',
          z.string().regex(/^(?:[3-9]|[12]\d|30)$/),
          '3',
        ),
      ),
    },
  };
  return deploymentConfigurationSchema.parse({
    ...deploymentConfigurationSchema.parse(answer),
    alerts: {
      emailFrom: await ask(
        terminal,
        'Alert email sender (or none)',
        'Use a verified SES sender in the same AWS region; none leaves email dispatch disabled.',
        z.email().or(z.literal('none')),
        'none',
      ).then(
        /** Applies the completed prepare deployment result to the next step or current view state. */
        (value) => (value === 'none' ? '' : value),
      ),
      smsEnabled: await ask(
        terminal,
        'Enable SMS alert dispatch? (yes/no)',
        'Only choose yes after approving SNS SMS destinations, production access, registration and spending limits.',
        z.enum(['yes', 'no']),
        'no',
      ).then(
        /** Applies the completed prepare deployment result to the next step or current view state. */
        (value) => value === 'yes',
      ),
    },
  });
}

/**
 * Coordinates argument validation, overwrite protection, the interactive interview and the final
 * owner-only write. It prints the exact next command without embedding the chosen path in any shell
 * script or cloud resource.
 */
async function main(): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('Configuration preparation requires an interactive terminal.');
  }
  const options = parseArguments(process.argv.slice(2));
  if (!options.replace && (await pathExists(options.outputPath))) {
    throw new Error('The output file already exists. Review it; use --replace only with approval.');
  }
  process.stdout.write(
    `\nEdutex ${releaseVersion} production configuration interview\n` +
      'This interview asks for identifiers only. Stop if anyone asks you to paste a password, token or private key.\n',
  );
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const configuration = await interview(terminal);
    await writeJsonSecure(options.outputPath, configuration);
  } finally {
    terminal.close();
  }
  process.stdout.write(
    `\nCREATED: ${options.outputPath}\n` +
      `NEXT: npm run deploy:check -- --config ${JSON.stringify(options.outputPath)}\n`,
  );
}

await main();

/**
 * @fileoverview Implements the RC6 staged production deployment assistant. `check` proves local
 * tools, AWS identity and prerequisite resources; `plan` runs the quality gate and produces bound
 * Cloudflare/CDK evidence; `apply` requires an exact approval ID and hostname before it can mutate
 * infrastructure, migrate PostgreSQL, seed the school and activate the private service. Every cloud
 * command is shell-free, credentials stay in approved profiles/environment stores, and resumable
 * progress files prevent duplicate one-shot ECS tasks after an interrupted terminal session.
 */

import { createHash, randomUUID } from 'node:crypto';
import { rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { findRepositoryRoot } from './repository-root.js';

import { z } from 'zod';

import {
  loadDeploymentConfiguration,
  releaseVersion,
  schoolBootstrapCommand,
  terraformBackend,
  terraformVariables,
  type DeploymentConfiguration,
} from './deployment-config.js';
import { parseVersion, runCommand, versionAtLeast } from './deployment-command.js';
import { assertStateBucketTlsPolicy } from './deployment-policy.js';
import {
  appendFailedTaskArn,
  assertRetryRequestMatchesProgress,
  type DeploymentRetryRequest,
  type RetryableTaskKind,
} from './deployment-retry.js';
import {
  ensurePrivateDirectory,
  loadPlanRecord,
  readTextSecure,
  sha256DirectoryTree,
  sha256File,
  sha256SourceTree,
  writeJsonSecure,
  writeTextSecure,
  type DeploymentReceipt,
  type PlanRecord,
} from './deployment-state.js';

type DeploymentStage = 'check' | 'plan' | 'apply' | 'status';

interface DeploymentArguments {
  readonly stage: DeploymentStage;
  readonly configurationPath: string;
  readonly workDirectory?: string;
  readonly execute: boolean;
  readonly approvalId?: string;
  readonly confirmedHostname?: string;
  readonly confirmedRecordSha256?: string;
  readonly retry?: DeploymentRetryRequest;
}

const progressSchema = z.object({
  schemaVersion: z.literal(1),
  release: z.literal(releaseVersion),
  configurationSha256: z.string().regex(/^[0-9a-f]{64}$/),
  sourceSha256: z.string().regex(/^[0-9a-f]{64}$/),
  completed: z.array(
    z.enum(['cloudflare', 'foundation', 'migration', 'bootstrap', 'activation', 'stable']),
  ),
  migrationTaskArn: z.string().optional(),
  bootstrapTaskArn: z.string().optional(),
  failedTaskArns: z.array(z.string().min(20).max(2048)).max(10).default([]),
});
type DeploymentProgress = z.infer<typeof progressSchema>;

const cloudFormationOutputsSchema = z.record(
  z.string(),
  z.object({
    ApplicationClusterName: z.string().min(1),
    ApplicationServiceName: z.string().min(1),
    ApplicationSubnetIds: z.string().min(1),
    DatabaseMigrationSecurityGroupId: z.string().min(1),
    DatabaseMigrationTaskDefinitionArn: z.string().min(1),
    SchoolBootstrapTaskDefinitionArn: z.string().min(1),
  }),
);

const ecsRunTaskSchema = z.object({
  failures: z
    .array(z.looseObject({ arn: z.string().optional(), reason: z.string().optional() }))
    .default([]),
  tasks: z.array(z.looseObject({ taskArn: z.string().min(1) })).min(1),
});

const ecsTaskDescriptionSchema = z.object({
  failures: z.array(z.unknown()).default([]),
  tasks: z
    .array(
      z.object({
        taskArn: z.string(),
        stopCode: z.string().optional(),
        stoppedReason: z.string().optional(),
        containers: z.array(
          z.object({
            name: z.string(),
            exitCode: z.number().int().optional(),
            reason: z.string().optional(),
          }),
        ),
      }),
    )
    .min(1),
});

/**
 * Parses a required stage and named options. Apply-only confirmations remain optional here so the
 * parser can provide a single precise error later, immediately before mutation is considered.
 */
function parseArguments(arguments_: readonly string[]): DeploymentArguments {
  const stage = arguments_[0];
  if (!stage || !['check', 'plan', 'apply', 'status'].includes(stage)) {
    throw new Error('First choose one stage: check, plan, apply or status.');
  }
  let configurationPath = '';
  let workDirectory: string | undefined;
  let execute = false;
  let approvalId: string | undefined;
  let confirmedHostname: string | undefined;
  let confirmedRecordSha256: string | undefined;
  let retryFailedTask: RetryableTaskKind | undefined;
  let confirmedFailedTaskArn: string | undefined;
  for (let index = 1; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === '--execute') {
      execute = true;
      continue;
    }
    const value = arguments_[index + 1];
    if (!value) throw new Error(`${argument ?? 'The final option'} requires a value.`);
    if (argument === '--config') configurationPath = resolve(value);
    else if (argument === '--work-dir') workDirectory = resolve(value);
    else if (argument === '--approval-id') approvalId = value;
    else if (argument === '--confirm-hostname') confirmedHostname = value;
    else if (argument === '--confirm-record-sha256') confirmedRecordSha256 = value;
    else if (argument === '--retry-failed-task') {
      if (value !== 'migration' && value !== 'bootstrap') {
        throw new Error('--retry-failed-task must be exactly migration or bootstrap.');
      }
      retryFailedTask = value;
    } else if (argument === '--confirm-failed-task-arn') confirmedFailedTaskArn = value;
    else throw new Error(`Unknown deployment option: ${argument ?? '(missing)'}.`);
    index += 1;
  }
  if (!configurationPath) throw new Error('--config must point to the reviewed production JSON.');
  if ((retryFailedTask === undefined) !== (confirmedFailedTaskArn === undefined)) {
    throw new Error('--retry-failed-task and --confirm-failed-task-arn must be supplied together.');
  }
  if (retryFailedTask && stage !== 'apply') {
    throw new Error('A failed one-shot task can be retried only during the apply stage.');
  }
  if (
    confirmedFailedTaskArn &&
    !/^arn:[^\s:]+:ecs:[^\s:]+:\d{12}:task\/.+/.test(confirmedFailedTaskArn)
  ) {
    throw new Error('--confirm-failed-task-arn must be a complete ECS task ARN.');
  }
  return {
    stage: stage as DeploymentStage,
    configurationPath,
    ...(workDirectory ? { workDirectory } : {}),
    execute,
    ...(approvalId ? { approvalId } : {}),
    ...(confirmedHostname ? { confirmedHostname } : {}),
    ...(confirmedRecordSha256 ? { confirmedRecordSha256 } : {}),
    ...(retryFailedTask && confirmedFailedTaskArn
      ? { retry: { taskKind: retryFailedTask, confirmedTaskArn: confirmedFailedTaskArn } }
      : {}),
  };
}

/**
 * Creates the environment inherited by AWS CLI and CDK so both tools are pinned to the same named
 * SSO profile, account and region that passed configuration validation.
 */
function awsEnvironment(configuration: DeploymentConfiguration): NodeJS.ProcessEnv {
  return {
    AWS_PROFILE: configuration.aws.profile,
    AWS_REGION: configuration.aws.region,
    AWS_DEFAULT_REGION: configuration.aws.region,
    CDK_DEFAULT_ACCOUNT: configuration.aws.accountId,
    CDK_DEFAULT_REGION: configuration.aws.region,
  };
}

/**
 * Writes a bounded text evidence artifact with owner-only permissions. The caller supplies only
 * already-redacted plan/diff/version output; secret-returning AWS commands are never captured here.
 */
async function writeEvidence(filePath: string, contents: string): Promise<void> {
  if (Buffer.byteLength(contents, 'utf8') > 16 * 1024 * 1024) {
    throw new Error(`Evidence output for ${filePath} exceeded the 16 MiB safety limit.`);
  }
  await writeTextSecure(filePath, contents);
}

/**
 * Validates one installed tool against a minimum stable version. It combines stdout/stderr because
 * AWS CLI writes its version to stderr on some platforms.
 */
function requireToolVersion(
  repositoryRoot: string,
  program: string,
  arguments_: readonly string[],
  minimum: readonly [number, number, number],
  toolName: string,
): void {
  const result = runCommand(program, arguments_, {
    cwd: repositoryRoot,
    capture: true,
    label: `${toolName} version check`,
  });
  const actual = parseVersion(`${result.stdout}\n${result.stderr}`, toolName);
  if (!versionAtLeast(actual, minimum)) {
    throw new Error(`${toolName} ${actual.join('.')} is below required ${minimum.join('.')}.`);
  }
}

/**
 * Parses captured JSON into an unknown value while replacing low-level syntax errors with the name
 * of the vendor command whose contract was violated.
 */
function parseJsonOutput(output: string, label: string): unknown {
  try {
    return JSON.parse(output) as unknown;
  } catch (error) {
    throw new Error(`${label} returned invalid JSON.`, { cause: error });
  }
}

/**
 * Verifies local toolchain versions, the selected AWS principal/account, tunnel-token secret stage,
 * Terraform state controls, KMS key and SES identity. All AWS operations are read-only and never
 * retrieve a secret value.
 */
function runPreflight(
  repositoryRoot: string,
  configuration: DeploymentConfiguration,
  requireCloudflareToken: boolean,
): void {
  requireToolVersion(repositoryRoot, 'node', ['--version'], [24, 0, 0], 'Node.js');
  requireToolVersion(repositoryRoot, 'npm', ['--version'], [11, 0, 0], 'npm');
  requireToolVersion(repositoryRoot, 'aws', ['--version'], [2, 0, 0], 'AWS CLI');
  requireToolVersion(repositoryRoot, 'terraform', ['version', '-json'], [1, 10, 0], 'Terraform');
  requireToolVersion(
    repositoryRoot,
    'docker',
    ['version', '--format', '{{.Server.Version}}'],
    [24, 0, 0],
    'Docker Engine',
  );
  for (const key of [
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
    'AWS_SESSION_TOKEN',
    'AWS_SECURITY_TOKEN',
    'AWS_WEB_IDENTITY_TOKEN_FILE',
    'AWS_ROLE_ARN',
    'TF_VAR_cloudflare_api_token',
  ]) {
    if (process.env[key]) {
      throw new Error(
        `${key} is present. RC6 requires the named AWS SSO profile and only provider-native CLOUDFLARE_API_TOKEN for the short-lived Cloudflare token.`,
      );
    }
  }
  runCommand('docker', ['buildx', 'version'], {
    cwd: repositoryRoot,
    capture: true,
    label: 'Docker buildx availability',
  });
  const environment = awsEnvironment(configuration);
  const caller = z.object({ Account: z.string(), Arn: z.string(), UserId: z.string() }).parse(
    parseJsonOutput(
      runCommand('aws', ['sts', 'get-caller-identity', '--output', 'json'], {
        cwd: repositoryRoot,
        env: environment,
        capture: true,
        label: 'AWS caller identity',
      }).stdout,
      'AWS STS',
    ),
  );
  if (caller.Account !== configuration.aws.accountId) {
    throw new Error(
      `AWS profile resolved account ${caller.Account}, not approved ${configuration.aws.accountId}.`,
    );
  }
  z.object({
    Stacks: z
      .array(
        z.object({
          StackName: z.literal('CDKToolkit'),
          StackStatus: z.enum(['CREATE_COMPLETE', 'UPDATE_COMPLETE', 'UPDATE_ROLLBACK_COMPLETE']),
        }),
      )
      .min(1),
  }).parse(
    parseJsonOutput(
      runCommand(
        'aws',
        ['cloudformation', 'describe-stacks', '--stack-name', 'CDKToolkit', '--output', 'json'],
        {
          cwd: repositoryRoot,
          env: environment,
          capture: true,
          label: 'CDK bootstrap stack readiness',
        },
      ).stdout,
      'CDK bootstrap stack check',
    ),
  );
  const secret = z.object({ ARN: z.string(), Name: z.string() }).parse(
    parseJsonOutput(
      runCommand(
        'aws',
        [
          'secretsmanager',
          'describe-secret',
          '--secret-id',
          configuration.aws.cloudflareTunnelTokenSecretArn,
          '--output',
          'json',
        ],
        {
          cwd: repositoryRoot,
          env: environment,
          capture: true,
          label: 'Tunnel-token secret metadata',
        },
      ).stdout,
      'AWS Secrets Manager',
    ),
  );
  if (secret.ARN !== configuration.aws.cloudflareTunnelTokenSecretArn) {
    throw new Error('Secrets Manager returned a different tunnel-token secret ARN.');
  }
  const currentVersion = runCommand(
    'aws',
    [
      'secretsmanager',
      'list-secret-version-ids',
      '--secret-id',
      secret.ARN,
      '--query',
      "Versions[?contains(VersionStages, 'AWSCURRENT')].VersionId | [0]",
      '--output',
      'text',
    ],
    {
      cwd: repositoryRoot,
      env: environment,
      capture: true,
      label: 'Tunnel-token AWSCURRENT stage',
    },
  ).stdout.trim();
  if (!currentVersion || currentVersion === 'None') {
    throw new Error('The tunnel-token secret has no AWSCURRENT version.');
  }
  const bucketLocation = z.object({ LocationConstraint: z.string().nullable().optional() }).parse(
    parseJsonOutput(
      runCommand(
        'aws',
        ['s3api', 'get-bucket-location', '--bucket', configuration.aws.terraformState.bucket],
        {
          cwd: repositoryRoot,
          env: environment,
          capture: true,
          label: 'Terraform state bucket region',
        },
      ).stdout,
      'S3 location check',
    ),
  );
  const actualBucketRegion = bucketLocation.LocationConstraint ?? 'us-east-1';
  if (actualBucketRegion !== configuration.aws.region) {
    throw new Error(
      `Terraform state bucket is in ${actualBucketRegion}, not ${configuration.aws.region}.`,
    );
  }
  const encryption = z
    .object({
      ServerSideEncryptionConfiguration: z.object({
        Rules: z
          .array(
            z.object({
              ApplyServerSideEncryptionByDefault: z.object({
                SSEAlgorithm: z.literal('aws:kms'),
                KMSMasterKeyID: z.string(),
              }),
              BucketKeyEnabled: z.literal(true),
            }),
          )
          .min(1),
      }),
    })
    .parse(
      parseJsonOutput(
        runCommand(
          'aws',
          ['s3api', 'get-bucket-encryption', '--bucket', configuration.aws.terraformState.bucket],
          {
            cwd: repositoryRoot,
            env: environment,
            capture: true,
            label: 'Terraform state bucket encryption',
          },
        ).stdout,
        'S3 encryption check',
      ),
    );
  if (
    encryption.ServerSideEncryptionConfiguration.Rules[0]?.ApplyServerSideEncryptionByDefault
      .KMSMasterKeyID !== configuration.aws.terraformState.kmsKeyArn
  ) {
    throw new Error('Terraform state bucket does not use the approved customer-managed KMS key.');
  }
  z.object({
    PublicAccessBlockConfiguration: z.object({
      BlockPublicAcls: z.literal(true),
      IgnorePublicAcls: z.literal(true),
      BlockPublicPolicy: z.literal(true),
      RestrictPublicBuckets: z.literal(true),
    }),
  }).parse(
    parseJsonOutput(
      runCommand(
        'aws',
        ['s3api', 'get-public-access-block', '--bucket', configuration.aws.terraformState.bucket],
        {
          cwd: repositoryRoot,
          env: environment,
          capture: true,
          label: 'Terraform state public-access block',
        },
      ).stdout,
      'S3 public-access check',
    ),
  );
  z.object({
    OwnershipControls: z.object({
      Rules: z.array(z.object({ ObjectOwnership: z.literal('BucketOwnerEnforced') })).min(1),
    }),
  }).parse(
    parseJsonOutput(
      runCommand(
        'aws',
        [
          's3api',
          'get-bucket-ownership-controls',
          '--bucket',
          configuration.aws.terraformState.bucket,
        ],
        {
          cwd: repositoryRoot,
          env: environment,
          capture: true,
          label: 'Terraform state bucket ownership enforcement',
        },
      ).stdout,
      'S3 ownership check',
    ),
  );
  const versioning = z.object({ Status: z.literal('Enabled') }).parse(
    parseJsonOutput(
      runCommand(
        'aws',
        ['s3api', 'get-bucket-versioning', '--bucket', configuration.aws.terraformState.bucket],
        {
          cwd: repositoryRoot,
          env: environment,
          capture: true,
          label: 'Terraform state bucket versioning',
        },
      ).stdout,
      'S3 versioning check',
    ),
  );
  void versioning;
  const bucketPolicy = z
    .object({
      Policy: z
        .string()
        .min(2)
        .max(128 * 1024),
    })
    .parse(
      parseJsonOutput(
        runCommand(
          'aws',
          ['s3api', 'get-bucket-policy', '--bucket', configuration.aws.terraformState.bucket],
          {
            cwd: repositoryRoot,
            env: environment,
            capture: true,
            label: 'Terraform state TLS-only bucket policy',
          },
        ).stdout,
        'S3 bucket-policy check',
      ),
    );
  assertStateBucketTlsPolicy(bucketPolicy.Policy, configuration.aws.terraformState.bucket);
  const key = z
    .object({
      KeyMetadata: z.object({
        Arn: z.string(),
        Enabled: z.literal(true),
        KeyManager: z.literal('CUSTOMER'),
        KeySpec: z.literal('SYMMETRIC_DEFAULT'),
        Origin: z.literal('AWS_KMS'),
      }),
    })
    .parse(
      parseJsonOutput(
        runCommand(
          'aws',
          ['kms', 'describe-key', '--key-id', configuration.aws.terraformState.kmsKeyArn],
          {
            cwd: repositoryRoot,
            env: environment,
            capture: true,
            label: 'Terraform state KMS key',
          },
        ).stdout,
        'KMS key check',
      ),
    );
  if (key.KeyMetadata.Arn !== configuration.aws.terraformState.kmsKeyArn) {
    throw new Error('KMS returned a different key than the approved Terraform state key.');
  }
  z.object({ KeyRotationEnabled: z.literal(true) }).parse(
    parseJsonOutput(
      runCommand(
        'aws',
        ['kms', 'get-key-rotation-status', '--key-id', configuration.aws.terraformState.kmsKeyArn],
        {
          cwd: repositoryRoot,
          env: environment,
          capture: true,
          label: 'Terraform state KMS rotation',
        },
      ).stdout,
      'KMS rotation check',
    ),
  );
  const sesIdentity = configuration.school.email.sesSourceArn.split('identity/')[1];
  if (!sesIdentity) throw new Error('The SES source ARN does not contain an identity name.');
  z.object({ VerificationStatus: z.literal('SUCCESS') }).parse(
    parseJsonOutput(
      runCommand('aws', ['sesv2', 'get-email-identity', '--email-identity', sesIdentity], {
        cwd: repositoryRoot,
        env: environment,
        capture: true,
        label: 'SES identity verification',
      }).stdout,
      'SES identity check',
    ),
  );
  z.object({ ProductionAccessEnabled: z.literal(true), SendingEnabled: z.literal(true) }).parse(
    parseJsonOutput(
      runCommand('aws', ['sesv2', 'get-account'], {
        cwd: repositoryRoot,
        env: environment,
        capture: true,
        label: 'SES production sending readiness',
      }).stdout,
      'SES account readiness check',
    ),
  );
  if (configuration.school.email.configurationSet) {
    const configurationSet = z.object({ ConfigurationSetName: z.string() }).parse(
      parseJsonOutput(
        runCommand(
          'aws',
          [
            'sesv2',
            'get-configuration-set',
            '--configuration-set-name',
            configuration.school.email.configurationSet,
          ],
          {
            cwd: repositoryRoot,
            env: environment,
            capture: true,
            label: 'SES configuration-set readiness',
          },
        ).stdout,
        'SES configuration-set check',
      ),
    );
    if (configurationSet.ConfigurationSetName !== configuration.school.email.configurationSet) {
      throw new Error('SES returned a different configuration set than the approved value.');
    }
  }
  if (requireCloudflareToken && !process.env.CLOUDFLARE_API_TOKEN) {
    throw new Error(
      'CLOUDFLARE_API_TOKEN is not present. Obtain a short-lived scoped token through the approved secret-injection method.',
    );
  }
}

/**
 * Runs the deterministic source quality gate and refreshes the runtime SBOM. This function links
 * plan approval to type checking, tests, lint, formatting, builds, source-documentation coverage and
 * the high-severity production dependency audit.
 */
async function runQualityGate(repositoryRoot: string): Promise<void> {
  runCommand('npm', ['run', 'quality'], {
    cwd: repositoryRoot,
    label: 'Edutex quality gate',
  });
  runCommand('npm', ['audit', '--omit=dev', '--audit-level=high'], {
    cwd: repositoryRoot,
    label: 'Production dependency audit',
  });
  const sbom = runCommand('npm', ['sbom', '--omit=dev', '--sbom-format=cyclonedx'], {
    cwd: repositoryRoot,
    capture: true,
    label: 'CycloneDX production SBOM',
  }).stdout;
  await writeEvidence(join(repositoryRoot, 'quality', 'sbom.cdx.json'), sbom);
}

/**
 * Returns the non-secret CDK parameter list shared by synth/diff/deploy. Desired count zero creates
 * the private foundation without starting the application before PostgreSQL migrations finish.
 */
function cdkParameters(
  configuration: DeploymentConfiguration,
  desiredCount: number,
): readonly string[] {
  return [
    '--parameters',
    `PublicHostname=${configuration.school.hostname}`,
    '--parameters',
    `CloudflareTunnelTokenSecretArn=${configuration.aws.cloudflareTunnelTokenSecretArn}`,
    '--parameters',
    `ApplicationDesiredCount=${desiredCount}`,
    '--parameters',
    `AlertEmailFrom=${configuration.alerts.emailFrom}`,
    '--parameters',
    `AlertSmsEnabled=${configuration.alerts.smsEnabled}`,
  ];
}

/**
 * Produces Cloudflare Terraform and AWS CDK plans, saves human-readable evidence and records exact
 * SHA-256 bindings. No production mutation occurs in this stage.
 */
async function createPlan(
  repositoryRoot: string,
  configurationPath: string,
  configuration: DeploymentConfiguration,
  workDirectory: string,
): Promise<void> {
  await ensurePrivateDirectory(workDirectory);
  runPreflight(repositoryRoot, configuration, true);
  await runQualityGate(repositoryRoot);
  const sourceSha256 = await sha256SourceTree(repositoryRoot);
  const configurationSha256 = await sha256File(configurationPath);
  const terraformDirectory = join(repositoryRoot, 'infra', 'cloudflare');
  const terraformProviderLockPath = join(terraformDirectory, '.terraform.lock.hcl');
  const backendPath = join(workDirectory, 'terraform-backend.hcl');
  const variablesPath = join(workDirectory, 'cloudflare.auto.tfvars.json');
  const planPath = join(workDirectory, 'cloudflare.tfplan');
  await rm(planPath, { force: true });
  await writeEvidence(backendPath, terraformBackend(configuration));
  await writeJsonSecure(variablesPath, terraformVariables(configuration));
  const terraformEnvironment = awsEnvironment(configuration);
  runCommand(
    'terraform',
    ['init', '-input=false', '-reconfigure', `-backend-config=${backendPath}`],
    {
      cwd: terraformDirectory,
      env: terraformEnvironment,
      label: 'Cloudflare Terraform initialization',
    },
  );
  runCommand('terraform', ['fmt', '-check', '-recursive'], {
    cwd: terraformDirectory,
    env: terraformEnvironment,
    label: 'Cloudflare Terraform format check',
  });
  runCommand('terraform', ['validate'], {
    cwd: terraformDirectory,
    env: terraformEnvironment,
    label: 'Cloudflare Terraform validation',
  });
  runCommand(
    'terraform',
    ['plan', '-input=false', '-lock-timeout=5m', `-out=${planPath}`, `-var-file=${variablesPath}`],
    {
      cwd: terraformDirectory,
      env: terraformEnvironment,
      allowSensitiveEnvironment: ['CLOUDFLARE_API_TOKEN'],
      label: 'Cloudflare Terraform plan',
    },
  );
  const terraformPlanText = runCommand('terraform', ['show', '-no-color', planPath], {
    cwd: terraformDirectory,
    env: terraformEnvironment,
    capture: true,
    label: 'Cloudflare plan evidence export',
  }).stdout;
  const terraformPlanTextPath = join(workDirectory, 'cloudflare-plan.txt');
  await writeEvidence(terraformPlanTextPath, terraformPlanText);
  const cdkOutput = join(workDirectory, 'cdk.out');
  await rm(cdkOutput, { recursive: true, force: true });
  runCommand(
    'npm',
    [
      'exec',
      '--workspace',
      '@edutex/infra-aws',
      '--',
      'cdk',
      'synth',
      configuration.aws.stackName,
      '-c',
      'environment=production',
      '--no-version-reporting',
      '--output',
      cdkOutput,
    ],
    {
      cwd: repositoryRoot,
      env: awsEnvironment(configuration),
      label: 'AWS CloudFormation synthesis',
    },
  );
  const templatePath = join(cdkOutput, `${configuration.aws.stackName}.template.json`);
  await stat(templatePath);
  const diff = runCommand(
    'npm',
    [
      'exec',
      '--workspace',
      '@edutex/infra-aws',
      '--',
      'cdk',
      'diff',
      configuration.aws.stackName,
      '--app',
      cdkOutput,
      '-c',
      'environment=production',
      '--no-version-reporting',
    ],
    {
      cwd: repositoryRoot,
      env: awsEnvironment(configuration),
      capture: true,
      allowExitCodes: [0, 1],
      label: 'AWS CDK change diff',
    },
  );
  const diffPath = join(workDirectory, 'aws-cdk-diff.txt');
  await writeEvidence(diffPath, `${diff.stdout}\n${diff.stderr}`);
  const record: PlanRecord = {
    schemaVersion: 1,
    release: releaseVersion,
    changeId: configuration.change.id,
    hostname: configuration.school.hostname,
    createdAt: new Date().toISOString(),
    configurationSha256,
    sourceSha256,
    terraformPlanSha256: await sha256File(planPath),
    terraformProviderLockSha256: await sha256File(terraformProviderLockPath),
    terraformPlanTextSha256: await sha256File(terraformPlanTextPath),
    cloudFormationTemplateSha256: await sha256File(templatePath),
    cloudFormationAssemblySha256: await sha256DirectoryTree(cdkOutput),
    cloudFormationDiffSha256: await sha256File(diffPath),
    terraformWorkingDirectory: terraformDirectory,
    terraformPlanPath: planPath,
    terraformProviderLockPath,
    terraformPlanTextPath,
    cloudFormationTemplatePath: templatePath,
    cloudFormationAssemblyPath: cdkOutput,
    cloudFormationDiffPath: diffPath,
  };
  await writeJsonSecure(join(workDirectory, 'plan-record.json'), record);
  const planRecordSha256 = await sha256File(join(workDirectory, 'plan-record.json'));
  process.stdout.write(
    `\nPLAN READY: ${join(workDirectory, 'plan-record.json')}\n` +
      `PLAN RECORD SHA-256: ${planRecordSha256}\n` +
      'STOP HERE. A release manager and security/cloud approver must review both plan text files before apply.\n',
  );
}

/**
 * Confirms the apply request is inside the approved time window and repeats the exact change ID and
 * hostname. These checks are deliberately independent of the configuration file contents.
 */
function assertApplyConfirmation(
  options: DeploymentArguments,
  configuration: DeploymentConfiguration,
): void {
  if (!options.execute) throw new Error('Apply requires the explicit --execute flag.');
  if (options.approvalId !== configuration.change.id) {
    throw new Error('Apply --approval-id must exactly match the approved change ID.');
  }
  if (options.confirmedHostname !== configuration.school.hostname) {
    throw new Error('Apply --confirm-hostname must exactly match the school hostname.');
  }
  if (!options.confirmedRecordSha256?.match(/^[0-9a-f]{64}$/)) {
    throw new Error(
      'Apply --confirm-record-sha256 must be the 64-character hash copied from the approved change record.',
    );
  }
  const now = Date.now();
  if (
    now < Date.parse(configuration.change.windowStart) ||
    now > Date.parse(configuration.change.windowEnd)
  ) {
    throw new Error('The current time is outside the approved maintenance window.');
  }
}

/**
 * Loads an existing progress file or creates the empty bound state for a first apply. A progress file
 * from another configuration/source is rejected so completed stages cannot be borrowed across schools.
 */
async function loadProgress(
  filePath: string,
  configurationSha256: string,
  sourceSha256: string,
): Promise<DeploymentProgress> {
  try {
    const parsed = progressSchema.parse(
      JSON.parse(await readTextSecure(filePath, 256 * 1024)) as unknown,
    );
    if (
      parsed.configurationSha256 !== configurationSha256 ||
      parsed.sourceSha256 !== sourceSha256
    ) {
      throw new Error('Existing deployment progress belongs to different approved inputs.');
    }
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return {
      schemaVersion: 1,
      release: releaseVersion,
      configurationSha256,
      sourceSha256,
      completed: [],
      failedTaskArns: [],
    };
  }
}

/**
 * Adds one completed stage exactly once and writes the progress atomically. Callers update this only
 * after the vendor operation and its explicit success check have both completed.
 */
async function completeStage(
  filePath: string,
  progress: DeploymentProgress,
  stage: DeploymentProgress['completed'][number],
): Promise<DeploymentProgress> {
  const completed = progress.completed.includes(stage)
    ? progress.completed
    : [...progress.completed, stage];
  const next = { ...progress, completed };
  await writeJsonSecure(filePath, next);
  return next;
}

/**
 * Extracts the named stack output object from the CDK outputs file and validates every value required
 * by private ECS migration/bootstrap networking and final service stabilization.
 */
async function loadStackOutputs(
  filePath: string,
  stackName: string,
): Promise<z.infer<typeof cloudFormationOutputsSchema>[string]> {
  const outputs = cloudFormationOutputsSchema.parse(
    JSON.parse(await readTextSecure(filePath, 1024 * 1024)) as unknown,
  );
  const stack = outputs[stackName];
  if (!stack) throw new Error(`CDK outputs did not include ${stackName}.`);
  return stack;
}

/**
 * Creates the private awsvpc network document shared by migration and school-bootstrap tasks. It
 * explicitly disables public IP assignment and uses only stack-emitted private subnets/security group.
 */
function ecsNetworkConfiguration(
  outputs: z.infer<typeof cloudFormationOutputsSchema>[string],
): Readonly<Record<string, unknown>> {
  return {
    awsvpcConfiguration: {
      subnets: outputs.ApplicationSubnetIds.split(',').filter(
        /** Removes any empty output segment while preserving the emitted private subnet IDs. */
        (value) => value.length > 0,
      ),
      securityGroups: [outputs.DatabaseMigrationSecurityGroupId],
      assignPublicIp: 'DISABLED',
    },
  };
}

/**
 * Waits for one exact private ECS task, describes its named container and returns either success or
 * a bounded failure reason. Description failures throw because retry is unsafe unless AWS proves the
 * exact recorded task stopped and the expected container did not exit successfully.
 */
function inspectOneShotTask(
  repositoryRoot: string,
  configuration: DeploymentConfiguration,
  outputs: z.infer<typeof cloudFormationOutputsSchema>[string],
  containerName: string,
  taskArn: string,
): string | undefined {
  runCommand(
    'aws',
    [
      'ecs',
      'wait',
      'tasks-stopped',
      '--cluster',
      outputs.ApplicationClusterName,
      '--tasks',
      taskArn,
    ],
    {
      cwd: repositoryRoot,
      env: awsEnvironment(configuration),
      label: `${containerName} ECS task completion`,
    },
  );
  const description = ecsTaskDescriptionSchema.parse(
    parseJsonOutput(
      runCommand(
        'aws',
        [
          'ecs',
          'describe-tasks',
          '--cluster',
          outputs.ApplicationClusterName,
          '--tasks',
          taskArn,
          '--output',
          'json',
        ],
        {
          cwd: repositoryRoot,
          env: awsEnvironment(configuration),
          capture: true,
          label: `${containerName} ECS task result`,
        },
      ).stdout,
      'ECS describe-tasks',
    ),
  );
  if (description.failures.length > 0) {
    throw new Error(
      `ECS could not describe ${containerName}: ${JSON.stringify(description.failures)}`,
    );
  }
  const task = description.tasks[0];
  const container = task?.containers.find(
    /** Selects the exact expected container instead of trusting the first item returned by ECS. */
    (candidate) => candidate.name === containerName,
  );
  if (container?.exitCode !== 0) {
    return container?.reason ?? task?.stoppedReason ?? 'no exit code zero';
  }
  return undefined;
}

/**
 * Starts or resumes one private one-shot ECS task, waits for STOPPED and requires exit code zero for
 * the named container. Normal resumes reuse the persisted ARN. A failed task is replaced only when
 * the operator repeats that exact ARN with the matching retry kind; its predecessor remains in a
 * bounded audit history and changes the idempotency token for the single replacement attempt.
 */
async function runOneShotTask(
  repositoryRoot: string,
  configuration: DeploymentConfiguration,
  outputs: z.infer<typeof cloudFormationOutputsSchema>[string],
  networkPath: string,
  taskDefinition: string,
  taskKind: RetryableTaskKind,
  containerName: string,
  startedBy: string,
  overridePath: string | undefined,
  progressPath: string,
  progress: DeploymentProgress,
  progressProperty: 'migrationTaskArn' | 'bootstrapTaskArn',
  retry: DeploymentRetryRequest | undefined,
): Promise<{ readonly taskArn: string; readonly progress: DeploymentProgress }> {
  let taskArn = progress[progressProperty];
  let currentProgress = progress;
  let retryPredecessorArn: string | undefined;
  if (taskArn) {
    const retryMatchesCurrent = retry?.taskKind === taskKind && retry.confirmedTaskArn === taskArn;
    const retryMatchesPredecessor =
      retry?.taskKind === taskKind &&
      currentProgress.failedTaskArns.includes(retry.confirmedTaskArn);
    const failureReason = inspectOneShotTask(
      repositoryRoot,
      configuration,
      outputs,
      containerName,
      taskArn,
    );
    if (!failureReason) {
      if (retryMatchesCurrent) {
        throw new Error(
          `${containerName} actually succeeded; rerun apply without failed-task retry options.`,
        );
      }
      return { taskArn, progress: currentProgress };
    }
    if (retryMatchesPredecessor) {
      throw new Error(
        `${containerName} replacement failed: ${failureReason}. Approve a new retry using its current ARN ${taskArn}.`,
      );
    }
    if (!retryMatchesCurrent) {
      throw new Error(
        `${containerName} failed: ${failureReason}. A replacement requires both ` +
          `--retry-failed-task ${taskKind} and --confirm-failed-task-arn ${taskArn}.`,
      );
    }
    retryPredecessorArn = taskArn;
    currentProgress = {
      ...currentProgress,
      failedTaskArns: appendFailedTaskArn(currentProgress.failedTaskArns, taskArn),
    };
  }
  const clientToken = createHash('sha256')
    .update(
      `${configuration.aws.accountId}:${outputs.ApplicationClusterName}:${startedBy}:` +
        (retryPredecessorArn ?? 'first-attempt'),
    )
    .digest('hex');
  const arguments_ = [
    'ecs',
    'run-task',
    '--cluster',
    outputs.ApplicationClusterName,
    '--task-definition',
    taskDefinition,
    '--launch-type',
    'FARGATE',
    '--count',
    '1',
    '--started-by',
    startedBy,
    '--client-token',
    clientToken,
    '--network-configuration',
    `file://${networkPath}`,
    ...(overridePath ? ['--overrides', `file://${overridePath}`] : []),
    '--output',
    'json',
  ];
  const runResult = ecsRunTaskSchema.parse(
    parseJsonOutput(
      runCommand('aws', arguments_, {
        cwd: repositoryRoot,
        env: awsEnvironment(configuration),
        capture: true,
        label: `${containerName} ECS task start`,
      }).stdout,
      'ECS run-task',
    ),
  );
  if (runResult.failures.length > 0) {
    throw new Error(`ECS refused the ${containerName} task: ${JSON.stringify(runResult.failures)}`);
  }
  taskArn = runResult.tasks[0]?.taskArn;
  if (!taskArn) throw new Error(`ECS did not return an ARN for ${containerName}.`);
  currentProgress = { ...currentProgress, [progressProperty]: taskArn };
  await writeJsonSecure(progressPath, currentProgress);
  const failureReason = inspectOneShotTask(
    repositoryRoot,
    configuration,
    outputs,
    containerName,
    taskArn,
  );
  if (failureReason) throw new Error(`${containerName} failed: ${failureReason}.`);
  return { taskArn, progress: currentProgress };
}

/**
 * Deploys the CDK stack with an explicit desired count and writes outputs to the bound work folder.
 * Apply uses `--require-approval never` only because the source/config hashes and reviewed diff were
 * already revalidated immediately before this function is called.
 */
async function deployCdk(
  repositoryRoot: string,
  configuration: DeploymentConfiguration,
  desiredCount: number,
  outputsPath: string,
  cloudAssemblyPath: string,
): Promise<void> {
  const temporaryOutputsPath = `${outputsPath}.${randomUUID()}.tmp`;
  try {
    runCommand(
      'npm',
      [
        'exec',
        '--workspace',
        '@edutex/infra-aws',
        '--',
        'cdk',
        'deploy',
        configuration.aws.stackName,
        '--app',
        cloudAssemblyPath,
        '-c',
        'environment=production',
        ...cdkParameters(configuration, desiredCount),
        '--require-approval',
        'never',
        '--no-previous-parameters',
        '--method',
        'change-set',
        '--rollback',
        '--exclusively',
        '--no-version-reporting',
        '--outputs-file',
        temporaryOutputsPath,
      ],
      {
        cwd: repositoryRoot,
        env: awsEnvironment(configuration),
        label:
          desiredCount === 0
            ? 'AWS private foundation deployment (application stopped)'
            : 'AWS application activation',
      },
    );
    await writeTextSecure(outputsPath, await readTextSecure(temporaryOutputsPath, 1024 * 1024));
  } finally {
    await rm(temporaryOutputsPath, { force: true });
  }
}

/**
 * Revalidates every approved hash and performs the resumable production mutation sequence. The app
 * remains at desired count zero until Cloudflare, infrastructure, migrations and tenant bootstrap pass.
 */
async function applyPlan(
  repositoryRoot: string,
  options: DeploymentArguments,
  configurationPath: string,
  configuration: DeploymentConfiguration,
  workDirectory: string,
): Promise<void> {
  assertApplyConfirmation(options, configuration);
  runPreflight(repositoryRoot, configuration, true);
  const planRecordPath = join(workDirectory, 'plan-record.json');
  const planRecordSha256 = await sha256File(planRecordPath);
  if (options.confirmedRecordSha256 !== planRecordSha256) {
    throw new Error('The local plan record does not match the externally approved SHA-256.');
  }
  const record = await loadPlanRecord(planRecordPath);
  const configurationSha256 = await sha256File(configurationPath);
  const sourceSha256 = await sha256SourceTree(repositoryRoot);
  const expectedTerraformDirectory = join(repositoryRoot, 'infra', 'cloudflare');
  const expectedTerraformPlanPath = join(workDirectory, 'cloudflare.tfplan');
  const expectedTerraformProviderLockPath = join(expectedTerraformDirectory, '.terraform.lock.hcl');
  const expectedTerraformPlanTextPath = join(workDirectory, 'cloudflare-plan.txt');
  const expectedCloudFormationTemplatePath = join(
    workDirectory,
    'cdk.out',
    `${configuration.aws.stackName}.template.json`,
  );
  const expectedCloudFormationAssemblyPath = join(workDirectory, 'cdk.out');
  const expectedCloudFormationDiffPath = join(workDirectory, 'aws-cdk-diff.txt');
  if (
    record.terraformWorkingDirectory !== expectedTerraformDirectory ||
    record.terraformPlanPath !== expectedTerraformPlanPath ||
    record.terraformProviderLockPath !== expectedTerraformProviderLockPath ||
    record.terraformPlanTextPath !== expectedTerraformPlanTextPath ||
    record.cloudFormationTemplatePath !== expectedCloudFormationTemplatePath ||
    record.cloudFormationAssemblyPath !== expectedCloudFormationAssemblyPath ||
    record.cloudFormationDiffPath !== expectedCloudFormationDiffPath
  ) {
    throw new Error(
      'The approved plan contains an artifact path outside the expected RC6 locations.',
    );
  }
  const planSha256 = await sha256File(record.terraformPlanPath);
  const providerLockSha256 = await sha256File(record.terraformProviderLockPath);
  const planTextSha256 = await sha256File(record.terraformPlanTextPath);
  const templateSha256 = await sha256File(record.cloudFormationTemplatePath);
  const assemblySha256 = await sha256DirectoryTree(record.cloudFormationAssemblyPath);
  const diffSha256 = await sha256File(record.cloudFormationDiffPath);
  if (
    record.changeId !== configuration.change.id ||
    record.hostname !== configuration.school.hostname ||
    record.configurationSha256 !== configurationSha256 ||
    record.sourceSha256 !== sourceSha256 ||
    record.terraformPlanSha256 !== planSha256 ||
    record.terraformProviderLockSha256 !== providerLockSha256 ||
    record.terraformPlanTextSha256 !== planTextSha256 ||
    record.cloudFormationTemplateSha256 !== templateSha256 ||
    record.cloudFormationAssemblySha256 !== assemblySha256 ||
    record.cloudFormationDiffSha256 !== diffSha256
  ) {
    throw new Error(
      'The approved plan no longer matches the release, source, configuration or plan bytes.',
    );
  }
  const progressPath = join(workDirectory, 'deployment-progress.json');
  let progress = await loadProgress(progressPath, configurationSha256, sourceSha256);
  assertRetryRequestMatchesProgress(options.retry, progress);
  const terraformDirectory = record.terraformWorkingDirectory;
  if (!progress.completed.includes('cloudflare')) {
    runCommand(
      'terraform',
      ['apply', '-input=false', '-lock-timeout=5m', record.terraformPlanPath],
      {
        cwd: terraformDirectory,
        env: awsEnvironment(configuration),
        allowSensitiveEnvironment: ['CLOUDFLARE_API_TOKEN'],
        label: 'Approved Cloudflare plan apply',
      },
    );
    progress = await completeStage(progressPath, progress, 'cloudflare');
  }
  const outputsPath = join(workDirectory, 'aws-stack-outputs.json');
  if (!progress.completed.includes('foundation')) {
    await deployCdk(
      repositoryRoot,
      configuration,
      0,
      outputsPath,
      record.cloudFormationAssemblyPath,
    );
    progress = await completeStage(progressPath, progress, 'foundation');
  }
  const outputs = await loadStackOutputs(outputsPath, configuration.aws.stackName);
  const networkPath = join(workDirectory, 'ecs-private-network.json');
  await writeJsonSecure(networkPath, ecsNetworkConfiguration(outputs));
  const markerBase = `rc5-${configuration.change.id}`
    .replaceAll(/[^A-Za-z0-9_-]/g, '-')
    .slice(0, 24);
  let migrationTaskArn = progress.migrationTaskArn;
  if (!progress.completed.includes('migration')) {
    const result = await runOneShotTask(
      repositoryRoot,
      configuration,
      outputs,
      networkPath,
      outputs.DatabaseMigrationTaskDefinitionArn,
      'migration',
      'migration',
      `${markerBase}-migration`,
      undefined,
      progressPath,
      progress,
      'migrationTaskArn',
      options.retry,
    );
    migrationTaskArn = result.taskArn;
    progress = await completeStage(progressPath, result.progress, 'migration');
  }
  const overridePath = join(workDirectory, 'school-bootstrap-overrides.json');
  await writeJsonSecure(overridePath, {
    containerOverrides: [
      { name: 'school-bootstrap', command: schoolBootstrapCommand(configuration) },
    ],
  });
  let bootstrapTaskArn = progress.bootstrapTaskArn;
  if (
    configuration.deploymentPurpose === 'existing-school-upgrade' &&
    !progress.completed.includes('bootstrap')
  ) {
    process.stdout.write(
      'Existing-school upgrade: retaining the current tenant, identity pool, keys and administrator.\n',
    );
    bootstrapTaskArn = 'not-required-for-upgrade';
    progress = await completeStage(progressPath, progress, 'bootstrap');
  }
  if (!progress.completed.includes('bootstrap')) {
    const result = await runOneShotTask(
      repositoryRoot,
      configuration,
      outputs,
      networkPath,
      outputs.SchoolBootstrapTaskDefinitionArn,
      'bootstrap',
      'school-bootstrap',
      `${markerBase}-bootstrap`,
      overridePath,
      progressPath,
      progress,
      'bootstrapTaskArn',
      options.retry,
    );
    bootstrapTaskArn = result.taskArn;
    progress = await completeStage(progressPath, result.progress, 'bootstrap');
  }
  if (!progress.completed.includes('activation')) {
    await deployCdk(
      repositoryRoot,
      configuration,
      configuration.application.desiredCount,
      outputsPath,
      record.cloudFormationAssemblyPath,
    );
    progress = await completeStage(progressPath, progress, 'activation');
  }
  const finalOutputs = await loadStackOutputs(outputsPath, configuration.aws.stackName);
  if (!progress.completed.includes('stable')) {
    runCommand(
      'aws',
      [
        'ecs',
        'wait',
        'services-stable',
        '--cluster',
        finalOutputs.ApplicationClusterName,
        '--services',
        finalOutputs.ApplicationServiceName,
      ],
      {
        cwd: repositoryRoot,
        env: awsEnvironment(configuration),
        label: 'Edutex service stabilization',
      },
    );
    progress = await completeStage(progressPath, progress, 'stable');
  }
  const stack = z.object({ Stacks: z.array(z.object({ StackId: z.string() })).min(1) }).parse(
    parseJsonOutput(
      runCommand(
        'aws',
        [
          'cloudformation',
          'describe-stacks',
          '--stack-name',
          configuration.aws.stackName,
          '--output',
          'json',
        ],
        {
          cwd: repositoryRoot,
          env: awsEnvironment(configuration),
          capture: true,
          label: 'Final CloudFormation stack status',
        },
      ).stdout,
      'CloudFormation describe-stacks',
    ),
  );
  const receipt: DeploymentReceipt = {
    schemaVersion: 1,
    release: releaseVersion,
    changeId: configuration.change.id,
    hostname: configuration.school.hostname,
    completedAt: new Date().toISOString(),
    configurationSha256,
    sourceSha256,
    terraformPlanSha256: planSha256,
    terraformProviderLockSha256: providerLockSha256,
    terraformPlanTextSha256: planTextSha256,
    cloudFormationTemplateSha256: templateSha256,
    cloudFormationAssemblySha256: assemblySha256,
    cloudFormationDiffSha256: diffSha256,
    planRecordSha256,
    migrationTaskArn: migrationTaskArn ?? progress.migrationTaskArn ?? 'recorded-in-progress',
    bootstrapTaskArn: bootstrapTaskArn ?? progress.bootstrapTaskArn ?? 'recorded-in-progress',
    cloudFormationStackId: stack.Stacks[0]?.StackId ?? 'unavailable',
    applicationClusterName: finalOutputs.ApplicationClusterName,
    applicationServiceName: finalOutputs.ApplicationServiceName,
    failedTaskArns: progress.failedTaskArns,
  };
  await writeJsonSecure(join(workDirectory, 'deployment-receipt.json'), receipt);
  process.stdout.write(
    `\nDEPLOYMENT COMPLETE: ${configuration.school.hostname}\n` +
      'Next: complete the independent go-live, tenant-isolation, MFA/SSO, restore and penetration-test checklist.\n',
  );
}

/**
 * Prints bounded local deployment state without querying cloud services. Operators can use this after
 * reopening a terminal to identify the last safely recorded stage before deciding whether to resume.
 */
async function showStatus(workDirectory: string): Promise<void> {
  for (const fileName of [
    'plan-record.json',
    'deployment-progress.json',
    'deployment-receipt.json',
  ]) {
    const filePath = join(workDirectory, fileName);
    try {
      const metadata = await stat(filePath);
      process.stdout.write(`${fileName}: present (${metadata.size} bytes)\n`);
      if (fileName === 'deployment-progress.json') {
        const progress = progressSchema.parse(
          JSON.parse(await readTextSecure(filePath, 256 * 1024)) as unknown,
        );
        process.stdout.write(`completed stages: ${progress.completed.join(', ') || 'none'}\n`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        process.stdout.write(`${fileName}: not present\n`);
      } else throw error;
    }
  }
}

/**
 * Resolves repository/work paths, validates the shared configuration and dispatches exactly one
 * stage. No stage can fall through into a mutation command.
 */
async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  const repositoryRoot = findRepositoryRoot(import.meta.dirname);
  const configuration = await loadDeploymentConfiguration(options.configurationPath);
  const workDirectory =
    options.workDirectory ?? join(repositoryRoot, 'tmp', 'deployments', configuration.school.slug);
  await ensurePrivateDirectory(workDirectory);
  if (options.stage === 'status') {
    await showStatus(workDirectory);
    return;
  }
  if (options.stage === 'check') {
    runPreflight(repositoryRoot, configuration, false);
    process.stdout.write(
      `\nCHECK PASSED for ${configuration.school.hostname}.\n` +
        `NEXT: npm run deploy:plan -- --config ${JSON.stringify(options.configurationPath)}\n`,
    );
    return;
  }
  if (options.stage === 'plan') {
    await createPlan(repositoryRoot, options.configurationPath, configuration, workDirectory);
    return;
  }
  await applyPlan(repositoryRoot, options, options.configurationPath, configuration, workDirectory);
}

await main();

/**
 * @fileoverview Provides regression evidence for the RC5 deployment assistant's pure security
 * boundaries: cross-account rejection, credential rejection, non-secret Terraform/bootstrap output,
 * command redaction, version gating and source/plan hash behavior. It never contacts AWS or Cloudflare.
 */

import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  deploymentConfigurationSchema,
  loadDeploymentConfiguration,
  schoolBootstrapCommand,
  terraformBackend,
  terraformVariables,
} from './deployment-config.js';
import {
  childEnvironment,
  displayCommand,
  parseVersion,
  versionAtLeast,
} from './deployment-command.js';
import { assertStateBucketTlsPolicy } from './deployment-policy.js';
import { appendFailedTaskArn, assertRetryRequestMatchesProgress } from './deployment-retry.js';
import {
  ensurePrivateDirectory,
  readTextSecure,
  sha256DirectoryTree,
  sha256File,
  sha256SourceTree,
  writeJsonSecure,
  writeTextSecure,
} from './deployment-state.js';

const validConfiguration = {
  schemaVersion: 1,
  release: '1.0.0-rc.6',
  deploymentPurpose: 'new-school-production',
  change: {
    id: 'CHG-2026-8451',
    releaseManager: 'Release Manager',
    securityApprover: 'Security Approver',
    windowStart: '2026-09-12T20:00:00+10:00',
    windowEnd: '2026-09-12T23:00:00+10:00',
  },
  aws: {
    profile: 'edutex-production-deployer',
    accountId: '123456789012',
    region: 'ap-southeast-2',
    stackName: 'Edutex-production',
    cloudflareTunnelTokenSecretArn:
      'arn:aws:secretsmanager:ap-southeast-2:123456789012:secret:edutex/production/cloudflare/tunnel-token-AbCdEf',
    terraformState: {
      bucket: 'edutex-state-123456789012',
      key: 'edutex/acme-school/cloudflare.tfstate',
      kmsKeyArn: 'arn:aws:kms:ap-southeast-2:123456789012:key/12345678-abcd-4abc-8abc-123456789abc',
    },
  },
  cloudflare: {
    accountId: 'aabbccddeeff00112233445566778899',
    zoneId: '99887766554433221100ffeeddccbbaa',
    tunnelId: '12345678-abcd-4abc-8abc-123456789abc',
    hostname: 'portal.acme.edu.au',
    allowedIpCidrs: ['203.0.113.0/24'],
    allowedCountryCodes: ['AU'],
    adminIpCidrs: ['203.0.113.0/25'],
    enableBotManagement: false,
  },
  school: {
    slug: 'acme-school',
    legalName: 'Acme School',
    hostname: 'portal.acme.edu.au',
    campusName: 'Main Campus',
    academicYearName: '2027 School Year',
    academicYearStart: '2027-01-27',
    academicYearEnd: '2027-12-17',
    timezone: 'Australia/Melbourne',
    country: 'AU',
    initialAdministrator: { email: 'admin@acme.edu.au', displayName: 'Initial Administrator' },
    email: {
      sesSourceArn: 'arn:aws:ses:ap-southeast-2:123456789012:identity/acme.edu.au',
      fromAddress: 'no-reply@acme.edu.au',
      configurationSet: 'edutex-transactional',
    },
  },
  application: { desiredCount: 3 },
} as const;

describe('deployment configuration boundary', /** Defines the `deployment configuration boundary` regression-test suite and groups evidence for the adjacent production module. Direct links: `it`. */ () => {
  it('accepts one complete production configuration and emits no secret Terraform value', /** Verifies the `accepts one complete production configuration and emits no secret Terraform value` case and fails the quality gate when the expected security/functional invariant changes. Direct links: `deploymentConfigurationSchema.parse`, `expect(terraformVariables(configuration)).not`, `expect`, `terraformVariables`, `expect(terraformBackend(configuration)).toCon`. */ () => {
    const configuration = deploymentConfigurationSchema.parse(validConfiguration);
    expect(terraformVariables(configuration)).not.toHaveProperty('cloudflare_api_token');
    expect(terraformBackend(configuration)).toContain('use_lockfile = true');
    expect(schoolBootstrapCommand(configuration)).not.toContain('password');
  });

  it('rejects a resource ARN from a different AWS account', /** Verifies the `rejects a resource ARN from a different AWS account` case and fails the quality gate when the expected security/functional invariant changes. Direct links: `structuredClone`, `expect(() => deploymentConfigurationSchema.pa`, `expect`. */ () => {
    const invalid = {
      ...validConfiguration,
      school: {
        ...validConfiguration.school,
        email: {
          ...validConfiguration.school.email,
          sesSourceArn: 'arn:aws:ses:ap-southeast-2:999999999999:identity/acme.edu.au',
        },
      },
    };
    expect(
      /** Performs the local `expect` operation inside `deployment.test` and returns control to the surrounding feature only after this body completes. Direct links: `deploymentConfigurationSchema.parse`. */ () =>
        deploymentConfigurationSchema.parse(invalid),
    ).toThrow(/configured production account/);
  });

  it('rejects a secret-like property before schema validation', /** Verifies the `rejects a secret-like property before schema validation` case and fails the quality gate when the expected security/functional invariant changes. Direct links: `mkdtemp`, `join`, `tmpdir`, `writeFile`, `JSON.stringify`. */ async () => {
    const directory = await mkdtemp(join(tmpdir(), 'edutex-deployment-test-'));
    const path = join(directory, 'production.json');
    await writeFile(path, JSON.stringify({ ...validConfiguration, apiToken: 'must-not-be-here' }));
    await expect(loadDeploymentConfiguration(path)).rejects.toThrow(/Secret-like property/);
  });
});

describe('shell-free command evidence helpers', /** Defines the `shell-free command evidence helpers` regression-test suite and groups evidence for the adjacent production module. Direct links: `it`. */ () => {
  it('redacts a client token while retaining ordinary arguments', /** Verifies the `redacts a client token while retaining ordinary arguments` case and fails the quality gate when the expected security/functional invariant changes. Direct links: `expect( displayCommand('aws', ['ecs', 'run-ta`, `expect`, `displayCommand`. */ () => {
    expect(
      displayCommand('aws', [
        'ecs',
        'run-task',
        '--client-token',
        'sensitive-value',
        '--count',
        '1',
      ]),
    ).toBe('aws ecs run-task --client-token [REDACTED] --count 1');
  });

  it('parses and compares stable vendor versions', /** Verifies the `parses and compares stable vendor versions` case and fails the quality gate when the expected security/functional invariant changes. Direct links: `expect(parseVersion('Terraform v1.10.5', 'Ter`, `expect`, `parseVersion`, `expect(versionAtLeast([1, 10, 5], [1, 10, 0])`, `versionAtLeast`. */ () => {
    expect(parseVersion('Terraform v1.10.5', 'Terraform')).toEqual([1, 10, 5]);
    expect(versionAtLeast([1, 10, 5], [1, 10, 0])).toBe(true);
    expect(versionAtLeast([1, 9, 9], [1, 10, 0])).toBe(false);
  });

  it('removes ambient credentials and grants a named token only to its consuming command', /** Verifies that child processes receive no ambient static AWS or Cloudflare credential and that the one reviewed Terraform command can receive only the explicitly allowed token variable. Direct links: `childEnvironment`, `expect`. */ () => {
    const originalCloudflare = process.env.CLOUDFLARE_API_TOKEN;
    const originalAwsKey = process.env.AWS_ACCESS_KEY_ID;
    process.env.CLOUDFLARE_API_TOKEN = 'temporary-test-token';
    process.env.AWS_ACCESS_KEY_ID = 'temporary-test-key';
    try {
      expect(childEnvironment({ cwd: '.' })).not.toHaveProperty('CLOUDFLARE_API_TOKEN');
      expect(childEnvironment({ cwd: '.' })).not.toHaveProperty('AWS_ACCESS_KEY_ID');
      expect(
        childEnvironment({ cwd: '.', allowSensitiveEnvironment: ['CLOUDFLARE_API_TOKEN'] })
          .CLOUDFLARE_API_TOKEN,
      ).toBe('temporary-test-token');
    } finally {
      if (originalCloudflare === undefined) delete process.env.CLOUDFLARE_API_TOKEN;
      else process.env.CLOUDFLARE_API_TOKEN = originalCloudflare;
      if (originalAwsKey === undefined) delete process.env.AWS_ACCESS_KEY_ID;
      else process.env.AWS_ACCESS_KEY_ID = originalAwsKey;
    }
  });
});

describe('deployment evidence hashes', /** Defines the `deployment evidence hashes` regression-test suite and groups evidence for the adjacent production module. Direct links: `it`. */ () => {
  it('changes the source digest when a controlled file changes', /** Verifies the `changes the source digest when a controlled file changes` case and fails the quality gate when the expected security/functional invariant changes. Direct links: `mkdtemp`, `join`, `tmpdir`, `mkdir`, `writeFile`. */ async () => {
    const directory = await mkdtemp(join(tmpdir(), 'edutex-source-hash-'));
    await mkdir(join(directory, 'src'));
    const path = join(directory, 'src', 'feature.ts');
    await writeFile(path, 'export const value = 1;\n');
    const first = await sha256SourceTree(directory);
    await writeFile(path, 'export const value = 2;\n');
    expect(await sha256SourceTree(directory)).not.toBe(first);
  });

  it('binds Terraform provider selection separately from the controlled source digest', /** Verifies Terraform init can create its provider lock without invalidating the source approval, while a separate SHA-256 still binds the exact provider selection. Direct links: `sha256SourceTree`, `sha256File`, `expect`. */ async () => {
    const directory = await mkdtemp(join(tmpdir(), 'edutex-provider-lock-'));
    await writeFile(join(directory, 'main.tf'), 'terraform {}\n');
    const sourceBeforeInit = await sha256SourceTree(directory);
    const lockPath = join(directory, '.terraform.lock.hcl');
    await writeFile(lockPath, 'provider "registry.terraform.io/cloudflare/cloudflare" {}\n');
    expect(await sha256SourceTree(directory)).toBe(sourceBeforeInit);
    expect(await sha256File(lockPath)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('writes owner-readable JSON whose byte hash can be verified', /** Verifies the `writes owner-readable JSON whose byte hash can be verified` case and fails the quality gate when the expected security/functional invariant changes. Direct links: `mkdtemp`, `join`, `tmpdir`, `writeJsonSecure`, `expect(JSON.parse(await readFile(path, 'utf8'`. */ async () => {
    const directory = await mkdtemp(join(tmpdir(), 'edutex-plan-state-'));
    const path = join(directory, 'nested', 'record.json');
    await writeJsonSecure(path, { release: '1.0.0-rc.6' });
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ release: '1.0.0-rc.6' });
    expect(await sha256File(path)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes the generated-directory digest when an asset manifest changes', /** Proves CDK approval binds the complete generated cloud assembly rather than only its primary stack template. Direct links: `sha256DirectoryTree`, `expect`. */ async () => {
    const directory = await mkdtemp(join(tmpdir(), 'edutex-assembly-hash-'));
    await mkdir(join(directory, 'assets'));
    await writeFile(join(directory, 'manifest.json'), '{"version":"1"}');
    await writeFile(join(directory, 'assets', 'asset.txt'), 'first');
    const first = await sha256DirectoryTree(directory);
    await writeFile(join(directory, 'assets', 'asset.txt'), 'second');
    expect(await sha256DirectoryTree(directory)).not.toBe(first);
  });

  it('atomically replaces an evidence-path symbolic link instead of following it', /** Proves the evidence writer cannot overwrite the link target when an owner-only work directory contains a stale or hostile symlink. Direct links: `writeTextSecure`, `readFile`, `expect`. */ async () => {
    const directory = await mkdtemp(join(tmpdir(), 'edutex-evidence-link-'));
    const target = join(directory, 'target.txt');
    const evidence = join(directory, 'evidence.txt');
    await writeFile(target, 'do not replace');
    const { symlink } = await import('node:fs/promises');
    await symlink(target, evidence);
    await writeTextSecure(evidence, 'approved evidence');
    expect(await readFile(target, 'utf8')).toBe('do not replace');
    expect(await readFile(evidence, 'utf8')).toBe('approved evidence');
  });

  it('rejects a symbolic link when reading bounded deployment state', /** Proves an attacker cannot swap progress, outputs or configuration reads through a filesystem link. Direct links: `readTextSecure`, `expect`. */ async () => {
    const directory = await mkdtemp(join(tmpdir(), 'edutex-state-link-'));
    const target = join(directory, 'target.json');
    const link = join(directory, 'progress.json');
    await writeFile(target, '{}');
    const { symlink } = await import('node:fs/promises');
    await symlink(target, link);
    await expect(readTextSecure(link, 1024)).rejects.toThrow();
  });

  it('rejects a symbolic-link deployment work directory', /** Proves privileged deployment artifacts cannot be redirected through a final work-directory link. Direct links: `ensurePrivateDirectory`, `expect`. */ async () => {
    const directory = await mkdtemp(join(tmpdir(), 'edutex-work-link-'));
    const target = join(directory, 'target');
    const link = join(directory, 'work');
    await mkdir(target);
    const { symlink } = await import('node:fs/promises');
    await symlink(target, link);
    await expect(ensurePrivateDirectory(link)).rejects.toThrow(/real directory/);
  });
});

describe('one-shot task retry authorization', /** Groups regression evidence for exact-ARN retry binding and the bounded failed-task audit history. Direct links: `it`, `assertRetryRequestMatchesProgress`, `appendFailedTaskArn`. */ () => {
  const failedMigrationArn =
    'arn:aws:ecs:ap-southeast-2:123456789012:task/cluster/1234567890abcdef';
  const progress = {
    completed: ['cloudflare', 'foundation'],
    migrationTaskArn: failedMigrationArn,
  };

  it('accepts only the matching incomplete stage and exact recorded ARN', /** Proves an operator cannot use a stale or unrelated ECS ARN to replace a security-sensitive one-shot task. Direct links: `assertRetryRequestMatchesProgress`, `expect`. */ () => {
    expect(
      /** Evaluates the exact migration retry approval against the recorded failed-task state. */ () => {
        assertRetryRequestMatchesProgress(
          { taskKind: 'migration', confirmedTaskArn: failedMigrationArn },
          progress,
        );
      },
    ).not.toThrow();
    expect(
      /** Evaluates a different ARN and requires the fail-closed mismatch result. */ () => {
        assertRetryRequestMatchesProgress(
          {
            taskKind: 'migration',
            confirmedTaskArn: 'arn:aws:ecs:ap-southeast-2:123456789012:task/cluster/different',
          },
          progress,
        );
      },
    ).toThrow(/does not exactly match/);
  });

  it('rejects retry of a completed stage and caps failure history', /** Proves completed work cannot be repeated and repeated failures stop at the documented incident threshold. Direct links: `assertRetryRequestMatchesProgress`, `appendFailedTaskArn`, `expect`. */ () => {
    expect(
      /** Evaluates an otherwise exact retry after the migration stage was marked complete. */ () => {
        assertRetryRequestMatchesProgress(
          { taskKind: 'migration', confirmedTaskArn: failedMigrationArn },
          { ...progress, completed: ['cloudflare', 'foundation', 'migration'] },
        );
      },
    ).toThrow(/already complete/);
    expect(
      /** Attempts to add an eleventh unique failure to the bounded incident history. */ () => {
        appendFailedTaskArn(
          Array.from(
            { length: 10 },
            /** Produces a distinct prior ECS task ARN for the audit-history limit. */
            (_, index) => `${failedMigrationArn}-${index}`,
          ),
          `${failedMigrationArn}-eleven`,
        );
      },
    ).toThrow(/deployment incident/);
  });

  it('resumes an already-recorded replacement but rejects a predecessor with no replacement', /** Proves a terminal interruption after replacement launch can resume that exact operation without letting an old failed ARN authorize an unrelated fresh launch. Direct links: `assertRetryRequestMatchesProgress`, `expect`. */ () => {
    const replacementArn = `${failedMigrationArn}-replacement`;
    expect(
      /** Validates the predecessor confirmation only because progress also contains its replacement. */ () => {
        assertRetryRequestMatchesProgress(
          { taskKind: 'migration', confirmedTaskArn: failedMigrationArn },
          {
            ...progress,
            migrationTaskArn: replacementArn,
            failedTaskArns: [failedMigrationArn],
          },
        );
      },
    ).not.toThrow();
    expect(
      /** Rejects predecessor history when no current replacement task is recorded. */ () => {
        assertRetryRequestMatchesProgress(
          { taskKind: 'migration', confirmedTaskArn: failedMigrationArn },
          {
            completed: ['cloudflare', 'foundation'],
            failedTaskArns: [failedMigrationArn],
          },
        );
      },
    ).toThrow(/does not exactly match/);
  });
});

describe('AWS prerequisite policy validation', /** Groups fail-closed checks for prerequisite AWS policies that are owned outside the application CDK stack. Direct links: `it`, `assertStateBucketTlsPolicy`. */ () => {
  it('accepts a bucket-wide TLS denial and rejects partial principal coverage', /** Proves preflight recognises the standard secure-transport denial while rejecting a statement that protects only one role. Direct links: `assertStateBucketTlsPolicy`, `expect`. */ () => {
    const bucket = 'edutex-state-123456789012';
    const securePolicy = JSON.stringify({
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Deny',
          Principal: '*',
          Action: 's3:*',
          Resource: [`arn:aws:s3:::${bucket}`, `arn:aws:s3:::${bucket}/*`],
          Condition: { Bool: { 'aws:SecureTransport': 'false' } },
        },
      ],
    });
    expect(
      /** Runs the validator against a complete bucket/object, all-principal TLS denial. */
      () => {
        assertStateBucketTlsPolicy(securePolicy, bucket);
      },
    ).not.toThrow();
    expect(
      /** Runs the validator against a principal-scoped denial that must fail closed. */
      () => {
        assertStateBucketTlsPolicy(
          JSON.stringify({
            Statement: {
              Effect: 'Deny',
              Principal: { AWS: 'arn:aws:iam::123456789012:role/one-role' },
              Action: 's3:*',
              Resource: [`arn:aws:s3:::${bucket}`, `arn:aws:s3:::${bucket}/*`],
              Condition: { Bool: { 'aws:SecureTransport': 'false' } },
            },
          }),
          bucket,
        );
      },
    ).toThrow(/every principal/);
  });
});

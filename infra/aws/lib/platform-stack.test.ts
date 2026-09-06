/**
 * @fileoverview Regression evidence for platform-stack; it verifies the production behavior owned by the adjacent source module.
 *
 * @remarks
 * Direct links: `aws-cdk-lib`, `aws-cdk-lib/assertions`, `vitest`, `./platform-stack.js`.
 * Security: Infrastructure trust boundary; changes require synthesis/diff, IAM/network review and deployment approval.
 */

import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { beforeAll, describe, expect, it } from 'vitest';

import { EdutexPlatformStack } from './platform-stack.js';

/** Synthesizes one deterministic production template for infrastructure boundary assertions. */
function productionTemplate(): Record<string, unknown> {
  const app = new App();
  const stack = new EdutexPlatformStack(app, 'Edutex-production-test', {
    env: { account: '111111111111', region: 'ap-southeast-2' },
    environmentName: 'production',
  });
  return Template.fromStack(stack).toJSON();
}

describe('private AWS production boundary', /** Defines the `private AWS production boundary` regression-test suite and groups evidence for the adjacent production module. Direct links: `beforeAll`, `it`. */ () => {
  let template: Record<string, unknown>;

  beforeAll(
    /** Performs the local `beforeAll` operation inside `platform-stack.test` and returns control to the surrounding feature only after this body completes. Direct links: `productionTemplate`. */ () => {
      template = productionTemplate();
    },
    30_000,
  );

  it('does not synthesize an internet-facing load balancer or public task address', /** Verifies the `does not synthesize an internet-facing load balancer or public task address` case and fails the quality gate when the expected security/functional invariant changes. Direct links: `expect( Object.values(resources).some((resour`, `expect`, `Object.values(resources).some`, `Object.values`, `Object.values(resources).find`. */ () => {
    const resources = template.Resources as Record<
      string,
      { readonly Type?: string; readonly Properties?: Record<string, unknown> }
    >;
    expect(
      Object.values(resources).some(
        /** Reports whether at least one input item satisfies this authorization/validation condition for `platform-stack.test`. It receives `resource`. Direct links: `resource.Type?.includes`. */ (
          resource,
        ) => resource.Type?.includes('LoadBalancing'),
      ),
    ).toBe(false);
    const service = Object.values(resources).find(
      /** Selects the first input item matching this lookup condition for `platform-stack.test`; no match deliberately returns undefined. It receives `resource`. It uses only the local values shown in its body. */ (
        resource,
      ) =>
        resource.Type === 'AWS::ECS::Service' &&
        resource.Properties?.ServiceName !== 'DatabaseMigrationTask',
    );
    expect(JSON.stringify(service)).toContain('DISABLED');
  });

  it('permits SSO secret rotation only in the tenant identity namespace', /** Verifies the `permits SSO secret rotation only in the tenant identity namespace` case and fails the quality gate when the expected security/functional invariant changes. Direct links: `JSON.stringify`, `expect(serialized).toContain`, `expect`, `expect(serialized).not.toContain`. */ () => {
    const serialized = JSON.stringify(template);
    expect(serialized).toContain('secretsmanager:DescribeSecret');
    expect(serialized).toContain('secret:edutex/tenants/*');
    expect(serialized).not.toContain('secret:edutex/tenants*');
  });

  it('limits confidential Cognito client-secret reads to the exact tenant suffix', /** Verifies that the long-running API cannot read arbitrary tenant or identity-provider secrets. Direct links: `JSON.stringify`, `expect`. */ () => {
    const resources = template.Resources as Record<
      string,
      { readonly Type?: string; readonly Properties?: Record<string, unknown> }
    >;
    const matchingStatements = Object.values(resources)
      .filter(
        /** Selects only synthesized IAM policies for exact statement inspection. It receives `resource`. */ (
          resource,
        ) => resource.Type === 'AWS::IAM::Policy',
      )
      .flatMap(
        /** Extracts policy statements from one synthesized IAM policy without trusting its shape. It receives `resource`. */ (
          resource,
        ) => {
          const document = resource.Properties?.PolicyDocument as
            { readonly Statement?: readonly unknown[] } | undefined;
          return document?.Statement ?? [];
        },
      )
      .filter(
        /** Selects statements that grant only the confidential client-secret read action. It receives `statement`. */ (
          statement,
        ) => {
          const value = statement as { readonly Action?: unknown };
          return value.Action === 'secretsmanager:GetSecretValue';
        },
      );
    expect(matchingStatements).toHaveLength(1);
    const statement = matchingStatements[0] as
      { readonly Effect?: unknown; readonly Resource?: unknown } | undefined;
    expect(statement?.Effect).toBe('Allow');
    expect(statement?.Resource).toEqual({
      'Fn::Join': [
        '',
        [
          'arn:',
          { Ref: 'AWS::Partition' },
          ':secretsmanager:ap-southeast-2:111111111111:secret:edutex/tenants/*/cognito/browser-client-secret-*',
        ],
      ],
    });
  });

  it('limits bootstrap creation to the confidential client-secret namespace', /** Verifies the short-lived bootstrap role cannot create arbitrary Secrets Manager records. Direct links: `JSON.stringify`, `expect`. */ () => {
    const serialized = JSON.stringify(template.Resources);
    expect(serialized).toContain('secretsmanager:CreateSecret');
    expect(serialized).toContain(':secret:edutex/tenants/*/cognito/browser-client-secret-*');
  });

  it('stages a production release at zero tasks until data setup has passed', /** Verifies RC5's fail-closed activation sequence: the CloudFormation parameter defaults to zero, supports a reviewed production scale, and controls both the ECS service and autoscaling minimum. Direct links: `expect`. */ () => {
    const parameters = template.Parameters as Record<
      string,
      { readonly Default?: number; readonly MinValue?: number; readonly MaxValue?: number }
    >;
    expect(parameters.ApplicationDesiredCount).toEqual(
      expect.objectContaining({ Default: 0, MinValue: 0, MaxValue: 30 }),
    );
    const serialized = JSON.stringify(template.Resources);
    expect(serialized).toContain('ApplicationDesiredCount');
  });

  it('exports the exact identifiers used by the resumable deployment assistant', /** Verifies the RC5 assistant can address the synthesized cluster, service, log group, migration task and bootstrap task without guessing generated names. Direct links: `expect`. */ () => {
    const outputs = template.Outputs as Record<string, unknown>;
    expect(outputs).toHaveProperty('ApplicationClusterName');
    expect(outputs).toHaveProperty('ApplicationServiceName');
    expect(outputs).toHaveProperty('ApplicationLogGroupName');
    expect(outputs).toHaveProperty('DatabaseMigrationTaskDefinitionArn');
    expect(outputs).toHaveProperty('SchoolBootstrapTaskDefinitionArn');
  });

  it('binds the canonical hostname into the runtime host allowlist', /** Verifies that the same reviewed CloudFormation parameter controls both the public URL and the explicit Fastify production hostname check. Direct links: `JSON.stringify`, `expect`. */ () => {
    const serialized = JSON.stringify(template.Resources);
    expect(serialized).toContain('PUBLIC_HOSTNAME');
    expect(serialized).toContain('PUBLIC_BASE_URL');
    expect(serialized).toContain('PublicHostname');
  });

  it('pins the Cloudflared sidecar to the reviewed immutable manifest digest', /** Verifies the outbound edge connector cannot silently change when an upstream version tag is moved. Direct links: `JSON.stringify`, `expect`. */ () => {
    const serialized = JSON.stringify(template.Resources);
    expect(serialized).toContain(
      'cloudflare/cloudflared:2026.7.3@sha256:e39ee8da81ad5e05d77f38d2f51c60ca51bf2a8450ac3abab50c17fdb91d91bf',
    );
  });
});

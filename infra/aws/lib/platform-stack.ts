/**
 * @fileoverview Defines or verifies the AWS CDK application plane, including private networking, IAM, storage, database, task and recovery resources.
 *
 * @remarks
 * Direct links: `node:fs`, `node:path`, `aws-cdk-lib`, `constructs`, `/app/certificates/rds-global-bundle.pem`.
 * Security: Infrastructure trust boundary; changes require synthesis/diff, IAM/network review and deployment approval.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import {
  CfnOutput,
  CfnCondition,
  Fn,
  CfnParameter,
  Duration,
  RemovalPolicy,
  Stack,
  type StackProps,
  aws_backup as backup,
  aws_dynamodb as dynamodb,
  aws_ec2 as ec2,
  aws_ecr_assets as ecrAssets,
  aws_ecs as ecs,
  aws_events as events,
  aws_iam as iam,
  aws_kms as kms,
  aws_logs as logs,
  aws_rds as rds,
  aws_s3 as s3,
  aws_secretsmanager as secretsmanager,
} from 'aws-cdk-lib';
import type { Construct } from 'constructs';

export interface EdutexPlatformStackProperties extends StackProps {
  readonly environmentName: string;
}

/** Resolves the Docker build context from both TypeScript source tests and compiled CDK output. */
function repositoryRoot(): string {
  const candidates = [
    join(import.meta.dirname, '../../..'),
    join(import.meta.dirname, '../../../..'),
  ];
  const root = candidates.find(
    /** Selects the first input item matching this lookup condition for `repositoryRoot`; no match deliberately returns undefined. It receives `candidate`. Direct links: `existsSync`, `join`. */ (
      candidate,
    ) => existsSync(join(candidate, 'Dockerfile')),
  );
  if (!root) throw new Error('The Edutex repository Dockerfile could not be located.');
  return root;
}

/**
 * Defines the private AWS application plane. The service has no load balancer,
 * public IP or inbound security-group rule; cloudflared reaches it over loopback
 * inside the same Fargate task and initiates all external connections outbound.
 */
export class EdutexPlatformStack extends Stack {
  /** Constructs `platform-stack` and assembles the AWS/resource relationships defined in this class without exposing a public origin or broader credentials. It receives `scope`, `id`, `properties`. Direct links: `super`, `ec2.FlowLogDestination.toCloudWatchLogs`, `Duration.days`, `proxySecurityGroup.addIngressRule`, `ec2.Port.tcp`. */ public constructor(
    scope: Construct,
    id: string,
    properties: EdutexPlatformStackProperties,
  ) {
    super(scope, id, properties);
    const alertEmailFrom = new CfnParameter(this, 'AlertEmailFrom', {
      type: 'String',
      default: '',
      description: 'Optional SES-verified sender email; blank disables email alerts.',
    });
    const alertSmsEnabled = new CfnParameter(this, 'AlertSmsEnabled', {
      type: 'String',
      default: 'false',
      allowedValues: ['true', 'false'],
      description: 'Enable only after SNS SMS registration and spending limits are approved.',
    });
    const production = properties.environmentName === 'production';
    const retain = production ? RemovalPolicy.RETAIN : RemovalPolicy.SNAPSHOT;
    const publicHostname = new CfnParameter(this, 'PublicHostname', {
      type: 'String',
      description: 'Exact lower-case hostname also configured in Cloudflare, without a scheme.',
      allowedPattern: '^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z]{2,63}$',
      constraintDescription: 'Use a valid lower-case fully-qualified DNS hostname.',
    });
    const cloudflareTunnelTokenSecretArn = new CfnParameter(
      this,
      'CloudflareTunnelTokenSecretArn',
      {
        type: 'String',
        noEcho: true,
        description:
          'ARN of a pre-created Secrets Manager secret whose AWSCURRENT value is the Cloudflare Tunnel token.',
        allowedPattern: '^arn:[a-z0-9-]+:secretsmanager:[a-z0-9-]+:[0-9]{12}:secret:.+$',
      },
    );
    const applicationDesiredCount = new CfnParameter(this, 'ApplicationDesiredCount', {
      type: 'Number',
      default: production ? 0 : 1,
      minValue: 0,
      maxValue: production ? 30 : 3,
      description:
        'Application tasks to run. RC5 deploys zero until migrations/bootstrap pass, then activates at three or more.',
    });

    const vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 3,
      natGateways: production ? 2 : 1,
      subnetConfiguration: [
        { name: 'application', subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 24 },
        { name: 'database', subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
        { name: 'edge-egress', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
      ],
      restrictDefaultSecurityGroup: true,
      flowLogs: { cloudwatch: { destination: ec2.FlowLogDestination.toCloudWatchLogs() } },
    });

    const dataKey = new kms.Key(this, 'TenantDataKey', {
      alias: `alias/edutex-${properties.environmentName}-tenant-data`,
      description: 'Envelope encryption key for tenant-specific browser-encrypted fields.',
      enableKeyRotation: true,
      pendingWindow: Duration.days(30),
      removalPolicy: retain,
    });
    const filesKey = new kms.Key(this, 'FilesKey', {
      alias: `alias/edutex-${properties.environmentName}-files`,
      description: 'S3 file encryption key.',
      enableKeyRotation: true,
      pendingWindow: Duration.days(30),
      removalPolicy: retain,
    });
    const sessionsKey = new kms.Key(this, 'SessionsKey', {
      alias: `alias/edutex-${properties.environmentName}-sessions`,
      description: 'DynamoDB session and authentication transaction encryption key.',
      enableKeyRotation: true,
      pendingWindow: Duration.days(30),
      removalPolicy: retain,
    });

    const filesBucket = new s3.Bucket(this, 'FilesBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      bucketKeyEnabled: true,
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: filesKey,
      enforceSSL: true,
      versioned: true,
      removalPolicy: retain,
      lifecycleRules: [
        { id: 'incomplete-multipart', abortIncompleteMultipartUploadAfter: Duration.days(1) },
        { id: 'noncurrent-versions', noncurrentVersionExpiration: Duration.days(90) },
        { id: 'expired-exports', prefix: 'exports/', expiration: Duration.days(8) },
        {
          id: 'legacy-migration-staging',
          prefix: 'migration-input/',
          expiration: Duration.days(8),
          noncurrentVersionExpiration: Duration.days(8),
        },
      ],
    });

    const sessionsTable = new dynamodb.Table(this, 'SessionsTable', {
      partitionKey: { name: 'sessionHash', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: sessionsKey,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
        recoveryPeriodInDays: production ? 35 : 7,
      },
      timeToLiveAttribute: 'expiresAtEpoch',
      removalPolicy: retain,
    });
    const transactionsTable = new dynamodb.Table(this, 'AuthTransactionsTable', {
      partitionKey: { name: 'stateHash', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: sessionsKey,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
        recoveryPeriodInDays: production ? 35 : 7,
      },
      timeToLiveAttribute: 'expiresAtEpoch',
      removalPolicy: retain,
    });

    const databaseSecurityGroup = new ec2.SecurityGroup(this, 'DatabaseSecurityGroup', {
      vpc,
      allowAllOutbound: false,
      description: 'Accepts PostgreSQL only from the RDS Proxy.',
    });
    const proxySecurityGroup = new ec2.SecurityGroup(this, 'ProxySecurityGroup', {
      vpc,
      allowAllOutbound: true,
      description: 'RDS Proxy reached only from the Edutex service.',
    });
    const serviceSecurityGroup = new ec2.SecurityGroup(this, 'ServiceSecurityGroup', {
      vpc,
      allowAllOutbound: true,
      description: 'Outbound-only Edutex task; no origin ingress.',
    });
    const migrationSecurityGroup = new ec2.SecurityGroup(this, 'MigrationSecurityGroup', {
      vpc,
      allowAllOutbound: true,
      description: 'Outbound-only one-shot schema migration tasks.',
    });
    proxySecurityGroup.addIngressRule(serviceSecurityGroup, ec2.Port.tcp(5432), 'Edutex API');
    databaseSecurityGroup.addIngressRule(proxySecurityGroup, ec2.Port.tcp(5432), 'RDS Proxy');
    databaseSecurityGroup.addIngressRule(
      migrationSecurityGroup,
      ec2.Port.tcp(5432),
      'Controlled schema migrations',
    );

    const database = new rds.DatabaseCluster(this, 'Database', {
      engine: rds.DatabaseClusterEngine.auroraPostgres({
        version: rds.AuroraPostgresEngineVersion.VER_16_6,
      }),
      credentials: rds.Credentials.fromGeneratedSecret('edutex_migrator', {
        secretName: `edutex/${properties.environmentName}/database/migrator`,
        excludeCharacters: '"@/\\',
      }),
      defaultDatabaseName: 'edutex',
      iamAuthentication: true,
      storageEncrypted: true,
      vpc,
      vpcSubnets: { subnetGroupName: 'database' },
      securityGroups: [databaseSecurityGroup],
      writer: rds.ClusterInstance.serverlessV2('writer', { publiclyAccessible: false }),
      readers: production
        ? [rds.ClusterInstance.serverlessV2('reader', { scaleWithWriter: true })]
        : [],
      serverlessV2MinCapacity: production ? 1 : 0.5,
      serverlessV2MaxCapacity: production ? 32 : 4,
      backup: { retention: Duration.days(production ? 35 : 7), preferredWindow: '16:00-17:00' },
      cloudwatchLogsExports: ['postgresql'],
      cloudwatchLogsRetention: logs.RetentionDays.ONE_YEAR,
      deletionProtection: production,
      removalPolicy: retain,
      parameterGroup: new rds.ParameterGroup(this, 'DatabaseParameters', {
        engine: rds.DatabaseClusterEngine.auroraPostgres({
          version: rds.AuroraPostgresEngineVersion.VER_16_6,
        }),
        parameters: {
          'rds.force_ssl': '1',
          log_connections: '1',
          log_disconnections: '1',
          log_lock_waits: '1',
          log_min_duration_statement: '1000',
          pgaudit_log: 'ddl,role,write',
          shared_preload_libraries: 'pgaudit',
        },
      }),
    });
    const databaseSecret = database.secret;
    if (!databaseSecret) throw new Error('The generated database credential secret is required.');
    const proxy = database.addProxy('DatabaseProxy', {
      borrowTimeout: Duration.seconds(30),
      debugLogging: false,
      defaultAuthScheme: rds.DefaultAuthScheme.IAM_AUTH,
      iamAuth: true,
      requireTLS: true,
      securityGroups: [proxySecurityGroup],
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      maxConnectionsPercent: 80,
      maxIdleConnectionsPercent: 40,
    });

    const cloudflareTunnelToken = secretsmanager.Secret.fromSecretCompleteArn(
      this,
      'CloudflareTunnelToken',
      cloudflareTunnelTokenSecretArn.valueAsString,
    );
    const cluster = new ecs.Cluster(this, 'ApplicationCluster', {
      vpc,
      containerInsightsV2: ecs.ContainerInsights.ENABLED,
      enableFargateCapacityProviders: true,
    });
    const task = new ecs.FargateTaskDefinition(this, 'ApplicationTask', {
      cpu: 1024,
      memoryLimitMiB: 2048,
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.ARM64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
      ephemeralStorageGiB: 30,
    });
    const logGroup = new logs.LogGroup(this, 'ApplicationLogs', {
      logGroupName: `/edutex/${properties.environmentName}/application`,
      retention: logs.RetentionDays.ONE_YEAR,
      encryptionKey: sessionsKey,
      removalPolicy: retain,
    });
    const applicationImage = ecs.ContainerImage.fromAsset(repositoryRoot(), {
      platform: ecrAssets.Platform.LINUX_ARM64,
    });
    const appContainer = task.addContainer('application', {
      image: applicationImage,
      readonlyRootFilesystem: true,
      logging: ecs.LogDrivers.awsLogs({ logGroup, streamPrefix: 'api' }),
      healthCheck: {
        command: ['CMD-SHELL', 'curl --fail --silent http://127.0.0.1:8080/health/live || exit 1'],
        interval: Duration.seconds(30),
        timeout: Duration.seconds(5),
        retries: 3,
        startPeriod: Duration.seconds(30),
      },
      environment: {
        AWS_REGION: this.region,
        AUTH_TRANSACTION_TABLE_NAME: transactionsTable.tableName,
        DB_AUTH_MODE: 'iam',
        DB_CA_BUNDLE_PATH: '/app/certificates/rds-global-bundle.pem',
        DB_CONNECTION_PURPOSE: 'runtime',
        DB_HOST: proxy.endpoint,
        DB_NAME: 'edutex',
        DB_PORT: '5432',
        DB_SSL_MODE: 'verify-full',
        DB_USER: 'edutex_app',
        FILES_BUCKET_NAME: filesBucket.bucketName,
        FILES_KMS_KEY_ID: filesKey.keyArn,
        NODE_ENV: 'production',
        PUBLIC_BASE_URL: `https://${publicHostname.valueAsString}`,
        PUBLIC_HOSTNAME: publicHostname.valueAsString,
        ALERT_EMAIL_FROM: alertEmailFrom.valueAsString,
        ALERT_SMS_ENABLED: alertSmsEnabled.valueAsString,
        SESSION_STORE: 'dynamodb',
        SESSION_TABLE_NAME: sessionsTable.tableName,
        TENANT_DATA_KEY_KMS_KEY_ID: dataKey.keyArn,
      },
      portMappings: [{ containerPort: 8080, protocol: ecs.Protocol.TCP }],
      user: '10001:10001',
    });
    const tunnelContainer = task.addContainer('cloudflared', {
      // Pin the readable Cloudflared release and its complete multi-platform manifest. The ARM64
      // Fargate task resolves the reviewed ARM64 child digest without trusting a mutable tag.
      image: ecs.ContainerImage.fromRegistry(
        'cloudflare/cloudflared:2026.7.3@sha256:e39ee8da81ad5e05d77f38d2f51c60ca51bf2a8450ac3abab50c17fdb91d91bf',
      ),
      command: ['tunnel', '--no-autoupdate', 'run'],
      secrets: { TUNNEL_TOKEN: ecs.Secret.fromSecretsManager(cloudflareTunnelToken) },
      readonlyRootFilesystem: true,
      essential: true,
      logging: ecs.LogDrivers.awsLogs({ logGroup, streamPrefix: 'cloudflared' }),
      user: '65532:65532',
    });
    tunnelContainer.addContainerDependencies({
      container: appContainer,
      condition: ecs.ContainerDependencyCondition.HEALTHY,
    });

    const service = new ecs.FargateService(this, 'ApplicationService', {
      cluster,
      taskDefinition: task,
      desiredCount: applicationDesiredCount.valueAsNumber,
      assignPublicIp: false,
      securityGroups: [serviceSecurityGroup],
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
      circuitBreaker: { enable: true, rollback: true },
      enableECSManagedTags: true,
      propagateTags: ecs.PropagatedTagSource.SERVICE,
    });
    service
      .autoScaleTaskCount({
        minCapacity: applicationDesiredCount.valueAsNumber,
        maxCapacity: production ? 30 : 3,
      })
      .scaleOnCpuUtilization('CpuScaling', {
        targetUtilizationPercent: 55,
        scaleInCooldown: Duration.minutes(3),
        scaleOutCooldown: Duration.seconds(45),
      });

    // Deployment automation runs this task once before each application rollout.
    // Only this task receives the cluster bootstrap credential, and it reaches the
    // writer directly through a dedicated security group. The long-running API has
    // neither access to the secret nor a network path that bypasses RDS Proxy.
    const migrationTask = new ecs.FargateTaskDefinition(this, 'DatabaseMigrationTask', {
      cpu: 512,
      memoryLimitMiB: 1024,
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.ARM64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
    });
    migrationTask.addContainer('migration', {
      image: applicationImage,
      command: ['node', 'packages/database/dist/migrate.js'],
      environment: {
        AWS_REGION: this.region,
        DB_AUTH_MODE: 'password',
        DB_CA_BUNDLE_PATH: '/app/certificates/rds-global-bundle.pem',
        DB_CONNECTION_PURPOSE: 'migration',
        DB_HOST: database.clusterEndpoint.hostname,
        DB_NAME: 'edutex',
        DB_PORT: database.clusterEndpoint.port.toString(),
        DB_SSL_MODE: 'verify-full',
        DB_USER: 'edutex_migrator',
        NODE_ENV: 'production',
      },
      secrets: {
        DB_PASSWORD: ecs.Secret.fromSecretsManager(databaseSecret, 'password'),
      },
      readonlyRootFilesystem: true,
      logging: ecs.LogDrivers.awsLogs({ logGroup, streamPrefix: 'migration' }),
      user: '10001:10001',
    });
    databaseSecret.grantRead(migrationTask.obtainExecutionRole());

    // A school is provisioned by an explicitly invoked, auditable one-shot task.
    // School-specific values are supplied as container command overrides so that
    // no tenant identifiers or email addresses are embedded in the task definition.
    const schoolBootstrapTask = new ecs.FargateTaskDefinition(this, 'SchoolBootstrapTask', {
      cpu: 512,
      memoryLimitMiB: 1024,
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.ARM64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
    });
    schoolBootstrapTask.addContainer('school-bootstrap', {
      image: applicationImage,
      command: ['node', 'scripts/dist/bootstrap-school.js'],
      environment: {
        AWS_REGION: this.region,
        DB_AUTH_MODE: 'password',
        DB_CA_BUNDLE_PATH: '/app/certificates/rds-global-bundle.pem',
        DB_CONNECTION_PURPOSE: 'migration',
        DB_HOST: database.clusterEndpoint.hostname,
        DB_NAME: 'edutex',
        DB_PORT: database.clusterEndpoint.port.toString(),
        DB_SSL_MODE: 'verify-full',
        DB_USER: 'edutex_migrator',
        NODE_ENV: 'production',
        TENANT_DATA_KEY_KMS_KEY_ID: dataKey.keyArn,
      },
      secrets: {
        DB_PASSWORD: ecs.Secret.fromSecretsManager(databaseSecret, 'password'),
      },
      readonlyRootFilesystem: true,
      logging: ecs.LogDrivers.awsLogs({ logGroup, streamPrefix: 'school-bootstrap' }),
      user: '10001:10001',
    });
    databaseSecret.grantRead(schoolBootstrapTask.obtainExecutionRole());
    dataKey.grantEncryptDecrypt(schoolBootstrapTask.taskRole);
    schoolBootstrapTask.taskRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: [
          'cognito-idp:AdminCreateUser',
          'cognito-idp:CreateUserPool',
          'cognito-idp:CreateUserPoolClient',
          'cognito-idp:CreateUserPoolDomain',
          'cognito-idp:DeleteUserPool',
          'cognito-idp:SetUserPoolMfaConfig',
          'cognito-idp:UpdateUserPool',
        ],
        resources: ['*'],
      }),
    );
    schoolBootstrapTask.taskRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ['secretsmanager:CreateSecret', 'secretsmanager:TagResource'],
        resources: [
          `arn:${this.partition}:secretsmanager:${this.region}:${this.account}:secret:edutex/tenants/*/cognito/browser-client-secret-*`,
        ],
      }),
    );

    // The legacy importer reads only an encrypted, short-lived S3 staging object. It has the same
    // private writer path as schema migrations and no access to the long-running application role.
    const legacyMigrationTask = new ecs.FargateTaskDefinition(this, 'LegacyMigrationTask', {
      cpu: 512,
      memoryLimitMiB: 2048,
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.ARM64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
      ephemeralStorageGiB: 30,
    });
    legacyMigrationTask.addContainer('legacy-migration', {
      image: applicationImage,
      command: ['node', 'scripts/dist/migrate-legacy.js'],
      environment: {
        AWS_REGION: this.region,
        DB_AUTH_MODE: 'password',
        DB_CA_BUNDLE_PATH: '/app/certificates/rds-global-bundle.pem',
        DB_CONNECTION_PURPOSE: 'migration',
        DB_HOST: database.clusterEndpoint.hostname,
        DB_NAME: 'edutex',
        DB_PORT: database.clusterEndpoint.port.toString(),
        DB_SSL_MODE: 'verify-full',
        DB_USER: 'edutex_migrator',
        NODE_ENV: 'production',
      },
      secrets: {
        DB_PASSWORD: ecs.Secret.fromSecretsManager(databaseSecret, 'password'),
      },
      readonlyRootFilesystem: true,
      logging: ecs.LogDrivers.awsLogs({ logGroup, streamPrefix: 'legacy-migration' }),
      user: '10001:10001',
    });
    databaseSecret.grantRead(legacyMigrationTask.obtainExecutionRole());
    filesBucket.grantRead(legacyMigrationTask.taskRole, 'migration-input/*');

    task.taskRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ['ses:SendEmail'],
        resources: [this.formatArn({ service: 'ses', resource: 'identity', resourceName: '*' })],
        conditions: { StringEquals: { 'ses:FromAddress': alertEmailFrom.valueAsString } },
      }),
    );
    // Direct transactional SMS addresses are not IAM resources; publication is bounded by SNS spend settings and explicit deployment opt-in.
    const smsCondition = new CfnCondition(this, 'SmsExplicitlyEnabled', {
      expression: Fn.conditionEquals(alertSmsEnabled.valueAsString, 'true'),
    });
    const smsPolicy = new iam.Policy(this, 'DirectSmsPolicy', {
      statements: [
        new iam.PolicyStatement({
          actions: ['sns:Publish'],
          resources: ['*'],
          conditions: { StringEquals: { 'aws:RequestedRegion': this.region } },
        }),
      ],
    });
    (smsPolicy.node.defaultChild as iam.CfnPolicy).cfnOptions.condition = smsCondition;
    smsPolicy.attachToRole(task.taskRole);
    sessionsTable.grantReadWriteData(task.taskRole);
    transactionsTable.grantReadWriteData(task.taskRole);
    filesBucket.grantReadWrite(task.taskRole);
    filesKey.grantEncryptDecrypt(task.taskRole);
    dataKey.grantEncryptDecrypt(task.taskRole);
    cloudflareTunnelToken.grantRead(task.executionRole ?? task.taskRole);
    database.grantConnect(task.taskRole, 'edutex_app');
    proxy.grantConnect(task.taskRole, 'edutex_app');
    task.taskRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: [
          'cognito-idp:CreateIdentityProvider',
          'cognito-idp:UpdateIdentityProvider',
          'cognito-idp:DescribeUserPoolClient',
          'cognito-idp:GetUserPoolMfaConfig',
          'cognito-idp:SetUserPoolMfaConfig',
          'cognito-idp:DescribeUserPool',
          'cognito-idp:UpdateUserPool',
          'cognito-idp:UpdateUserPoolClient',
        ],
        resources: [`arn:${this.partition}:cognito-idp:${this.region}:${this.account}:userpool/*`],
      }),
    );
    // Deliberately omit kms:Decrypt for the default AWS-managed Secrets Manager key: the service
    // performs that decrypt after IAM authorizes this exact secret ARN. A future customer-managed
    // secret key must add an equally narrow encryption-context-bound KMS grant.
    task.taskRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ['secretsmanager:GetSecretValue'],
        resources: [
          `arn:${this.partition}:secretsmanager:${this.region}:${this.account}:secret:edutex/tenants/*/cognito/browser-client-secret-*`,
        ],
      }),
    );
    task.taskRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: [
          'secretsmanager:CreateSecret',
          'secretsmanager:DescribeSecret',
          'secretsmanager:PutSecretValue',
          'secretsmanager:TagResource',
        ],
        resources: [
          `arn:${this.partition}:secretsmanager:${this.region}:${this.account}:secret:edutex/tenants/*`,
        ],
      }),
    );

    const backupVault = new backup.BackupVault(this, 'BackupVault', {
      backupVaultName: `edutex-${properties.environmentName}`,
      encryptionKey: filesKey,
      lockConfiguration: production
        ? {
            minRetention: Duration.days(35),
            maxRetention: Duration.days(2555),
            changeableFor: Duration.days(3),
          }
        : undefined,
      removalPolicy: RemovalPolicy.RETAIN,
    });
    const backupPlan = new backup.BackupPlan(this, 'BackupPlan', { backupVault });
    backupPlan.addRule(
      new backup.BackupPlanRule({
        ruleName: 'daily-continuous',
        scheduleExpression: events.Schedule.cron({ minute: '0', hour: '15' }),
        deleteAfter: Duration.days(production ? 35 : 7),
        enableContinuousBackup: true,
      }),
    );
    if (production) {
      backupPlan.addRule(
        new backup.BackupPlanRule({
          ruleName: 'monthly-archive',
          scheduleExpression: events.Schedule.cron({ minute: '0', hour: '14', day: '1' }),
          moveToColdStorageAfter: Duration.days(90),
          deleteAfter: Duration.days(2555),
        }),
      );
    }
    backupPlan.addSelection('ProtectedResources', {
      resources: [
        backup.BackupResource.fromRdsDatabaseCluster(database),
        backup.BackupResource.fromDynamoDbTable(sessionsTable),
        backup.BackupResource.fromDynamoDbTable(transactionsTable),
      ],
    });

    new CfnOutput(this, 'RdsProxyEndpoint', { value: proxy.endpoint });
    new CfnOutput(this, 'FilesBucketName', { value: filesBucket.bucketName });
    new CfnOutput(this, 'ApplicationClusterName', { value: cluster.clusterName });
    new CfnOutput(this, 'ApplicationServiceName', { value: service.serviceName });
    new CfnOutput(this, 'ApplicationLogGroupName', { value: logGroup.logGroupName });
    new CfnOutput(this, 'DatabaseMigrationTaskDefinitionArn', {
      value: migrationTask.taskDefinitionArn,
    });
    new CfnOutput(this, 'SchoolBootstrapTaskDefinitionArn', {
      value: schoolBootstrapTask.taskDefinitionArn,
    });
    new CfnOutput(this, 'LegacyMigrationTaskDefinitionArn', {
      value: legacyMigrationTask.taskDefinitionArn,
    });
    new CfnOutput(this, 'DatabaseMigrationSecurityGroupId', {
      value: migrationSecurityGroup.securityGroupId,
    });
    new CfnOutput(this, 'ApplicationSubnetIds', {
      value: vpc.privateSubnets
        .map(
          /** Transforms each input item for `platform-stack` into the derived value or React element consumed by the surrounding collection. It receives `subnet`. It uses only the local values shown in its body. */ (
            subnet,
          ) => subnet.subnetId,
        )
        .join(','),
    });
  }
}

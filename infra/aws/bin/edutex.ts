#!/usr/bin/env node
/**
 * @fileoverview Defines or verifies the AWS CDK application plane, including private networking, IAM, storage, database, task and recovery resources.
 *
 * @remarks
 * Direct links: `source-map-support/register.js`, `aws-cdk-lib`, `../lib/platform-stack.js`.
 * Security: Infrastructure trust boundary; changes require synthesis/diff, IAM/network review and deployment approval.
 */

import 'source-map-support/register.js';

import { App } from 'aws-cdk-lib';

import { EdutexPlatformStack } from '../lib/platform-stack.js';

const app = new App();
const environmentName =
  (app.node.tryGetContext('environment') as string | undefined) ?? 'production';
const account = process.env['CDK_DEFAULT_ACCOUNT'];
const region = process.env['CDK_DEFAULT_REGION'] ?? 'ap-southeast-2';
new EdutexPlatformStack(app, `Edutex-${environmentName}`, {
  description: 'Edutex private AWS application plane reached only by Cloudflare Tunnel.',
  env: { ...(account ? { account } : {}), region },
  environmentName,
});

/** @fileoverview Creates a separate RC6 upgrade configuration from approved existing school values, with fresh change information and no repeated tenant bootstrap. */
import { parseArgs } from 'node:util';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { z } from 'zod';
import { deploymentConfigurationSchema, releaseVersion } from './deployment-config.js';
import { readTextSecure, writeJsonSecure, ensurePrivateDirectory } from './deployment-state.js';
/** Copies non-secret infrastructure identity only after validation and collects a new reviewed maintenance window. */
async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { from: { type: 'string' }, output: { type: 'string' } },
    strict: true,
  });
  if (!values.from || !values.output)
    throw new Error(
      'Use --from OLD_CONFIG --output NEW_CONFIG. The output must be a different, new file.',
    );
  const input = resolve(values.from),
    output = resolve(values.output);
  if (input === output || existsSync(output))
    throw new Error('Choose a new output file. The existing configuration is retained.');
  const old = z
    .looseObject({ release: z.enum(['1.0.0-rc.5', releaseVersion]) })
    .parse(JSON.parse(await readTextSecure(input, 262144)) as unknown);
  const base = deploymentConfigurationSchema.parse({
    ...old,
    release: releaseVersion,
    deploymentPurpose: 'existing-school-upgrade',
  });
  if (!process.stdin.isTTY)
    throw new Error('Run the upgrade configuration interview in an interactive terminal.');
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  try {
    process.stdout.write(
      `Preparing an upgrade for ${base.school.legalName}. Confirm this matches the existing live school. This command does not deploy resources.\n`,
    );
    const change = {
      id: await terminal.question('New approved change ID: '),
      releaseManager: await terminal.question('Release manager: '),
      securityApprover: await terminal.question('Security/cloud approver: '),
      windowStart: await terminal.question(
        'Approved maintenance start (ISO date/time with offset): ',
      ),
      windowEnd: await terminal.question('Approved maintenance end (ISO date/time with offset): '),
    };
    const configuration = deploymentConfigurationSchema.parse({ ...base, change });
    await ensurePrivateDirectory(dirname(output));
    await writeJsonSecure(output, configuration);
    process.stdout.write(
      `Upgrade configuration prepared: ${output}\nRun setup check-cloud and plan with this file. Existing school records, identity pool and keys are retained.\n`,
    );
  } finally {
    terminal.close();
  }
}
await main().catch(
  /** Surfaces prepare upgrade failures through the existing error handler without silently succeeding. */
  (reason: unknown) => {
    process.stderr.write(
      `Upgrade setup stopped: ${reason instanceof Error ? reason.message : 'Invalid configuration.'}\n`,
    );
    process.exitCode = 1;
  },
);

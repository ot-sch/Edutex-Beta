/** @fileoverview Dependency-free setup entry point makes existing reviewed deployment steps easier to follow. */
import { toolCommand } from './tool-command.ts';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/** Runs a fixed program and argument list without shell interpolation or credential capture. */
function run(program: string, args: readonly string[]): void {
  const command = toolCommand(program, args);
  const result = spawnSync(command.program, command.args, {
    cwd: root,
    stdio: 'inherit',
    shell: false,
    env: process.env,
  });
  if (result.error)
    throw new Error(`${program} could not start. Install it and reopen the terminal.`);
  if (result.status !== 0)
    throw new Error(
      `${program} stopped with exit code ${result.status ?? 'unknown'}. Review the message above before continuing.`,
    );
}
/** Checks local prerequisites without authenticating, deploying, installing or changing cloud resources. */
function check(): number {
  let missing = 0;
  const major = Number(process.versions.node.split('.')[0]);
  process.stdout.write(
    `Node ${process.versions.node}: ${major >= 24 ? 'OK' : 'Node 24 or newer required'}\n`,
  );
  if (major < 24) missing++;
  for (const [program, args, help] of [
    ['npm', ['--version'], 'Install npm 11 or newer with Node.'],
    ['aws', ['--version'], 'Install AWS CLI v2.'],
    [
      'terraform',
      ['version'],
      'Install Terraform using the version in infra/cloudflare/versions.tf.',
    ],
    [
      'docker',
      ['info', '--format', '{{.ServerVersion}}'],
      'Install and start Docker Engine or Docker Desktop.',
    ],
  ] as const) {
    const command = toolCommand(program, args);
    const result = spawnSync(command.program, command.args, {
      cwd: root,
      encoding: 'utf8',
      shell: false,
      timeout: 15000,
    });
    if (result.error || result.status !== 0) {
      missing++;
      process.stdout.write(`${program}: NEEDS ATTENTION. ${help}\n`);
    } else {
      const first = (result.stdout || result.stderr).split('\n')[0];
      process.stdout.write(`${program}: OK · ${first}\n`);
    }
  }
  process.stdout.write(
    `Source: ${existsSync(resolve(root, 'package-lock.json')) ? 'locked dependency file present' : 'lockfile missing'}\n`,
  );
  process.stdout.write(
    'This check does not verify cloud permissions. The deployment check performs that step after AWS SSO sign-in.\n',
  );
  return missing;
}
/** Maps friendly setup steps to the existing strict deployment assistant without bypassing its plan approvals. */
async function main(): Promise<void> {
  let step = process.argv[2];
  const args = process.argv.slice(3);
  if (!step) {
    if (!process.stdin.isTTY) {
      process.stdout.write(
        'Use: npm run setup -- check | install | configure --output PATH | upgrade --from OLD --output NEW | check-cloud --config PATH | plan --config PATH | status --config PATH\n',
      );
      return;
    }
    const terminal = createInterface({ input: process.stdin, output: process.stdout });
    try {
      process.stdout.write(
        '\nEdutex setup\n1. Check this computer\n2. Install pinned project dependencies\n3. Show cloud setup steps\n',
      );
      step = new Map([
        ['1', 'check'],
        ['2', 'install'],
        ['3', 'help'],
      ]).get((await terminal.question('Choose a step: ')).trim());
    } finally {
      terminal.close();
    }
  }
  if (step === 'check') {
    process.exitCode = check() ? 1 : 0;
    return;
  }
  if (step === 'install') {
    if (args.length) throw new Error('The install step accepts no extra arguments.');
    run('npm', ['ci', '--ignore-scripts']);
    run('npm', ['rebuild', 'sharp']);
    process.stdout.write(
      'Dependencies are ready. Run npm run setup -- check, then follow the RC6 Setup Guide.\n',
    );
    return;
  }
  const commands: Readonly<Record<string, string>> = {
    configure: 'deploy:new',
    upgrade: 'deploy:upgrade',
    'check-cloud': 'deploy:check',
    plan: 'deploy:plan',
    status: 'deploy:status',
  };
  const command = step ? commands[step] : undefined;
  if (command) {
    run('npm', ['run', command, '--', ...args]);
    return;
  }
  if (step === 'help') {
    process.stdout.write(
      '1. Ask ICT for approved AWS and Cloudflare values.\n2. Sign in using aws sso login --profile YOUR_PROFILE.\n3. Run npm run setup -- configure --output ../edutex-operator/school/production.json.\n4. Run npm run setup -- check-cloud --config ../edutex-operator/school/production.json.\n5. Follow the technical guide for a reviewed plan and deployment.\nExisting schools must use the RC6 upgrade procedure; do not run new-school bootstrap again.\n',
    );
    return;
  }
  throw new Error('Unknown setup step. Run npm run setup -- help.');
}
await main().catch(
  /** Surfaces setup failures through the existing error handler without silently succeeding. */
  (error: unknown) => {
    process.stderr.write(
      `Setup stopped: ${error instanceof Error ? error.message : 'Unexpected setup error.'}\n`,
    );
    process.exitCode = 1;
  },
);

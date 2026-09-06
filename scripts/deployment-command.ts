/**
 * @fileoverview Provides the shell-free process boundary used by the RC6 deployment assistant.
 * Commands are executed as a program plus an argument array, so school names and identifiers never
 * become shell syntax. The same boundary also redacts token/secret-shaped arguments from operator
 * output and turns every non-zero exit into a fail-closed deployment error.
 */

import { toolCommand } from './tool-command.js';
import { spawnSync, type SpawnSyncOptionsWithStringEncoding } from 'node:child_process';

export interface CommandOptions {
  readonly cwd: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly allowSensitiveEnvironment?: readonly string[];
  readonly capture?: boolean;
  readonly label?: string;
  readonly allowExitCodes?: readonly number[];
}

export interface CommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

const sensitiveArgument = /(?:token|password|secret-value|client-secret|private-key)/i;
const sensitiveEnvironmentKeys = new Set([
  'TF_VAR_cloudflare_api_token',
  'CLOUDFLARE_API_TOKEN',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'AWS_SECURITY_TOKEN',
  'AWS_WEB_IDENTITY_TOKEN_FILE',
  'AWS_ROLE_ARN',
]);

/**
 * Quotes one argument for human display only. Execution never uses this representation; `spawnSync`
 * receives the original argument array directly and therefore does not invoke Bash or PowerShell.
 */
function displayArgument(argument: string): string {
  if (/^[A-Za-z0-9_./:=,@+-]+$/.test(argument)) return argument;
  return `'${argument.replaceAll("'", "'\\''")}'`;
}

/**
 * Creates a copy-and-paste-friendly command preview while hiding any value whose preceding flag or
 * own text is credential-shaped. This preview is evidence for the operator, not the execution path.
 */
export function displayCommand(program: string, arguments_: readonly string[]): string {
  const rendered: string[] = [displayArgument(program)];
  let redactNext = false;
  for (const argument of arguments_) {
    if (redactNext) {
      rendered.push('[REDACTED]');
      redactNext = false;
      continue;
    }
    if (sensitiveArgument.test(argument)) {
      const equals = argument.indexOf('=');
      if (equals >= 0) rendered.push(`${displayArgument(argument.slice(0, equals + 1))}[REDACTED]`);
      else {
        rendered.push(displayArgument(argument));
        redactNext = argument.startsWith('-');
      }
      continue;
    }
    rendered.push(displayArgument(argument));
  }
  return rendered.join(' ');
}

/**
 * Builds the exact child-process environment and removes credential-bearing variables unless the
 * caller explicitly allows a named variable for the one vendor command that consumes it. This
 * prevents a Cloudflare plan token or ambient static AWS key from reaching tests, npm lifecycle
 * scripts, CDK, JSON parsers or unrelated diagnostics.
 */
export function childEnvironment(options: CommandOptions): NodeJS.ProcessEnv {
  const allowed = new Set(options.allowSensitiveEnvironment ?? []);
  const environment: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries({ ...process.env, ...options.env })) {
    if (!sensitiveEnvironmentKeys.has(key) || allowed.has(key)) environment[key] = value;
  }
  return environment;
}

/**
 * Runs one external tool without a shell, streams ordinary deployment output by default and throws
 * on launch errors, signals or unapproved exit codes. Callers use capture mode only for bounded JSON
 * or version output that must be validated before the next security decision.
 */
export function runCommand(
  program: string,
  arguments_: readonly string[],
  options: CommandOptions,
): CommandResult {
  const label = options.label ?? program;
  process.stdout.write(`\n[RC6] ${label}\n[RC6] ${displayCommand(program, arguments_)}\n`);
  const spawnOptions: SpawnSyncOptionsWithStringEncoding = {
    cwd: options.cwd,
    env: childEnvironment(options),
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
  };
  const command = toolCommand(program, arguments_);
  const result = spawnSync(command.program, command.args, spawnOptions);
  if (result.error) throw new Error(`${label} could not start: ${result.error.message}`);
  if (result.signal) throw new Error(`${label} was stopped by signal ${result.signal}.`);
  const exitCode = result.status ?? 1;
  const allowed = options.allowExitCodes ?? [0];
  if (!allowed.includes(exitCode)) {
    const detail = options.capture && result.stderr ? `\n${result.stderr.trim()}` : '';
    throw new Error(`${label} failed with exit code ${exitCode}.${detail}`);
  }
  return {
    exitCode,
    stdout: options.capture ? result.stdout : '',
    stderr: options.capture ? result.stderr : '',
  };
}

/**
 * Extracts a three-part semantic version from vendor output such as `v24.14.0` or
 * `Terraform v1.10.5`. It fails rather than guessing when the output is unrecognised.
 */
export function parseVersion(output: string, toolName: string): readonly [number, number, number] {
  const match = /v?(\d+)\.(\d+)\.(\d+)/i.exec(output);
  if (!match) throw new Error(`${toolName} returned an unrecognised version: ${output.trim()}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/**
 * Compares a parsed semantic version with a minimum version. Pre-release labels are intentionally
 * ignored because the deployment prerequisites require stable major/minor/patch capabilities only.
 */
export function versionAtLeast(
  actual: readonly [number, number, number],
  minimum: readonly [number, number, number],
): boolean {
  for (let index = 0; index < 3; index += 1) {
    const actualPart = actual[index] ?? 0;
    const minimumPart = minimum[index] ?? 0;
    if (actualPart > minimumPart) return true;
    if (actualPart < minimumPart) return false;
  }
  return true;
}

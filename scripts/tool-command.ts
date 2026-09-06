/** @fileoverview Resolves npm through its JavaScript entry point on Windows so setup never needs shell interpolation or command wrappers. */
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
/** Uses fixed executable arguments and the installed npm CLI on Windows; other tools retain normal executable lookup. */
export function toolCommand(
  program: string,
  args: readonly string[],
): { program: string; args: string[] } {
  if (process.platform !== 'win32' || !['npm', 'npm.cmd'].includes(program))
    return { program, args: [...args] };
  const candidates = [
    process.env.npm_execpath,
    resolve(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'),
  ];
  const cli = candidates.find(
    /** Selects candidates entries using the explicit value .ends With npm cli.js exists Sync value condition. */
    (value) => value?.endsWith('npm-cli.js') && existsSync(value),
  );
  if (!cli)
    throw new Error(
      'The npm CLI is unavailable. Install Node with npm and run this step through npm run setup.',
    );
  return { program: process.execPath, args: [cli, ...args] };
}

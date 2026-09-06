/**
 * @fileoverview Removes only the enumerated compiler output directories before a production build.
 * Keeping the allowlist here and rejecting links avoids a broad/globbed deletion while guaranteeing
 * stale JavaScript or source-map files cannot survive from an earlier compiler configuration.
 */

import { lstat, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dirname, '..');
const outputDirectories = [
  'apps/api/dist',
  'apps/auth-web/dist',
  'apps/portal-web/dist',
  'apps/technician-web/dist',
  'packages/contracts/dist',
  'packages/database/dist',
  'scripts/dist',
  'infra/aws/dist',
] as const;

/** Deletes exact generated directories after proving each existing target is a real directory. */
export async function cleanBuildOutput(root = repositoryRoot): Promise<number> {
  let removed = 0;
  for (const relativeDirectory of outputDirectories) {
    const directory = join(root, relativeDirectory);
    try {
      const metadata = await lstat(directory);
      if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
        throw new Error(`Refusing to clean non-directory build target: ${relativeDirectory}`);
      }
      await rm(directory, { recursive: true });
      removed += 1;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return removed;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const removed = await cleanBuildOutput();
  process.stdout.write(`Clean build boundary removed ${removed} generated directories.\n`);
}

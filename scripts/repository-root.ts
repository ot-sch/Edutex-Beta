/** @fileoverview Resolves the release root consistently from source and compiled deployment tools. */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/** Walks upward to the Edutex workspace manifest; never assumes compiled files live in scripts/. */
export function findRepositoryRoot(start: string): string {
  let directory = resolve(start);
  for (;;) {
    const manifest = join(directory, 'package.json');
    if (existsSync(manifest)) {
      const value = JSON.parse(readFileSync(manifest, 'utf8')) as { name?: string };
      if (value.name === 'edutex-production' && existsSync(join(directory, 'infra', 'aws')))
        return directory;
    }
    const parent = dirname(directory);
    if (parent === directory)
      throw new Error('Open the extracted Edutex-production folder and run the command again.');
    directory = parent;
  }
}

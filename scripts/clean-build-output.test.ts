/**
 * @fileoverview Regression evidence for the allowlisted build-output cleaner. It proves exact dist
 * directories are removed while a symbolic-link target is refused and left untouched.
 */

import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { cleanBuildOutput } from './clean-build-output.js';

describe('clean production build boundary', /** Groups safe deletion evidence for exact generated output paths. Direct links: `it`, `cleanBuildOutput`. */ () => {
  it('removes an enumerated real dist directory', /** Proves stale generated output is deleted before compiler work begins. Direct links: `mkdtemp`, `mkdir`, `writeFile`, `cleanBuildOutput`, `expect`. */ async () => {
    const root = await mkdtemp(join(tmpdir(), 'edutex-clean-build-'));
    await mkdir(join(root, 'apps/api/dist'), { recursive: true });
    await writeFile(join(root, 'apps/api/dist/stale.js.map'), '{}');
    await expect(cleanBuildOutput(root)).resolves.toBe(1);
  });

  it('refuses a symbolic-link output and preserves its target', /** Proves cleanup cannot be redirected outside the intended generated path. Direct links: `mkdtemp`, `mkdir`, `writeFile`, `symlink`, `cleanBuildOutput`, `readFile`, `expect`. */ async () => {
    const root = await mkdtemp(join(tmpdir(), 'edutex-clean-build-link-'));
    const target = join(root, 'protected');
    await mkdir(target, { recursive: true });
    await writeFile(join(target, 'keep.txt'), 'keep');
    await mkdir(join(root, 'apps/api'), { recursive: true });
    await symlink(target, join(root, 'apps/api/dist'));
    await expect(cleanBuildOutput(root)).rejects.toThrow(/Refusing to clean/);
    await expect(readFile(join(target, 'keep.txt'), 'utf8')).resolves.toBe('keep');
  });
});

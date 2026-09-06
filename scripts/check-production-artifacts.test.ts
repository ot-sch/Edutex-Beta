/**
 * @fileoverview Regression evidence for the production-artifact publication gate. Temporary build
 * roots prove ordinary JavaScript passes while source maps and recognizable cloud-key signatures
 * fail before an image or release archive can be approved.
 */

import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { checkProductionArtifacts } from './check-production-artifacts.js';

/** Creates every artifact-root directory expected by the production publication gate. */
async function emptyArtifactTree(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'edutex-artifact-gate-'));
  for (const path of [
    'apps/api/dist',
    'apps/auth-web/dist',
    'apps/portal-web/dist',
    'apps/technician-web/dist',
    'packages/contracts/dist',
    'packages/database/dist',
    'scripts/dist',
  ]) {
    await mkdir(join(root, path), { recursive: true });
  }
  return root;
}

describe('production artifact publication', /** Groups fail-closed source-map and credential-signature checks for exact packaged build roots. Direct links: `it`, `checkProductionArtifacts`. */ () => {
  it('accepts ordinary compiled output', /** Proves normal runtime JavaScript can pass the publication boundary. Direct links: `emptyArtifactTree`, `writeFile`, `checkProductionArtifacts`, `expect`. */ async () => {
    const root = await emptyArtifactTree();
    await writeFile(join(root, 'apps/api/dist/server.js'), "console.log('ready');\n");
    await expect(checkProductionArtifacts(root)).resolves.toBe(1);
  });

  it('rejects a source-map file', /** Proves stale compiler maps cannot enter a production artifact tree. Direct links: `emptyArtifactTree`, `writeFile`, `checkProductionArtifacts`, `expect`. */ async () => {
    const root = await emptyArtifactTree();
    await writeFile(join(root, 'apps/api/dist/server.js.map'), '{}');
    await expect(checkProductionArtifacts(root)).rejects.toThrow(/forbidden source map/);
  });

  it('rejects an embedded AWS access-key identifier', /** Proves an unambiguous static AWS key signature blocks publication. Direct links: `emptyArtifactTree`, `writeFile`, `checkProductionArtifacts`, `expect`. */ async () => {
    const root = await emptyArtifactTree();
    await writeFile(
      join(root, 'apps/api/dist/server.js'),
      "const accidental = 'AKIAABCDEFGHIJKLMNOP';\n",
    );
    await expect(checkProductionArtifacts(root)).rejects.toThrow(/AWS access-key identifier/);
  });
});

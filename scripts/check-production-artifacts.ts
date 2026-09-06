/**
 * @fileoverview Verifies that browser/runtime build output cannot accidentally publish source maps,
 * test code or embedded high-risk credential patterns. The deployment planner runs this after every
 * clean logical build; container packaging separately deletes stale dist trees before compiling.
 */

import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative, resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dirname, '..');
const artifactRoots = [
  'apps/api/dist',
  'apps/auth-web/dist',
  'apps/portal-web/dist',
  'apps/technician-web/dist',
  'packages/contracts/dist',
  'packages/database/dist',
  'scripts/dist',
];
const inspectableExtensions = new Set(['.html', '.js', '.json', '.css']);
const forbiddenPatterns = [
  { name: 'AWS access-key identifier', pattern: new RegExp('AKIA' + '[0-9A-Z]{16}') },
  {
    name: 'PEM private-key header',
    pattern: new RegExp('-----BEGIN ' + '[A-Z ]*PRIVATE KEY-----'),
  },
  {
    name: 'Cloudflare token assignment',
    pattern: new RegExp('CLOUDFLARE_API_TOKEN' + String.raw`\s*[:=]\s*['"][^'"]+`),
  },
] as const;

/** Recursively returns regular build artifacts and rejects links or special filesystem entries. */
async function filesBelow(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await filesBelow(path)));
    else if (entry.isFile()) files.push(path);
    else throw new Error(`Production artifact tree contains a link or special entry: ${path}`);
  }
  return files;
}

/**
 * Scans exact runtime/package roots after build, rejects source maps and test files by path, then
 * performs bounded textual checks for map directives and unambiguous credential signatures.
 */
export async function checkProductionArtifacts(root = repositoryRoot): Promise<number> {
  let inspected = 0;
  for (const relativeRoot of artifactRoots) {
    for (const filePath of await filesBelow(join(root, relativeRoot))) {
      const relativePath = relative(root, filePath).replaceAll('\\', '/');
      if (filePath.endsWith('.map')) {
        throw new Error(`Production artifact contains a forbidden source map: ${relativePath}`);
      }
      if (/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(filePath)) {
        throw new Error(`Production artifact contains a test module: ${relativePath}`);
      }
      if (!inspectableExtensions.has(extname(filePath))) continue;
      const contents = await readFile(filePath, 'utf8');
      inspected += 1;
      if (contents.includes('source' + 'MappingURL=')) {
        throw new Error(`Production artifact contains source-map directive: ${relativePath}`);
      }
      for (const forbidden of forbiddenPatterns) {
        if (forbidden.pattern.test(contents)) {
          throw new Error(`Production artifact contains ${forbidden.name}: ${relativePath}`);
        }
      }
    }
  }
  return inspected;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const inspected = await checkProductionArtifacts();
  process.stdout.write(`Production artifact gate passed: ${inspected} text artifacts inspected.\n`);
}

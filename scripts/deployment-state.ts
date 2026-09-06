/**
 * @fileoverview Stores non-secret RC6 deployment evidence and binds an approved plan to the exact
 * configuration, source tree and Terraform plan bytes that produced it. The state files live only
 * under the ignored deployment work directory, are written atomically with owner-only permissions
 * and never contain credentials or secret values.
 */

import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { readdir, rename, writeFile, chmod, mkdir, open, lstat } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';

import { z } from 'zod';

const excludedDirectoryNames = new Set([
  '.git',
  '.terraform',
  'cdk.out',
  'coverage',
  'dist',
  'node_modules',
  'output',
  'tmp',
]);

// Terraform creates this file during `init`; RC6 binds it separately in the signed plan record.
const excludedFileNames = new Set(['.terraform.lock.hcl']);

export const planRecordSchema = z.object({
  schemaVersion: z.literal(1),
  release: z.literal('1.0.0-rc.6'),
  changeId: z.string(),
  hostname: z.string(),
  createdAt: z.iso.datetime({ offset: true }),
  configurationSha256: z.string().regex(/^[0-9a-f]{64}$/),
  sourceSha256: z.string().regex(/^[0-9a-f]{64}$/),
  terraformPlanSha256: z.string().regex(/^[0-9a-f]{64}$/),
  terraformProviderLockSha256: z.string().regex(/^[0-9a-f]{64}$/),
  terraformPlanTextSha256: z.string().regex(/^[0-9a-f]{64}$/),
  cloudFormationTemplateSha256: z.string().regex(/^[0-9a-f]{64}$/),
  cloudFormationAssemblySha256: z.string().regex(/^[0-9a-f]{64}$/),
  cloudFormationDiffSha256: z.string().regex(/^[0-9a-f]{64}$/),
  terraformWorkingDirectory: z.string(),
  terraformPlanPath: z.string(),
  terraformProviderLockPath: z.string(),
  terraformPlanTextPath: z.string(),
  cloudFormationTemplatePath: z.string(),
  cloudFormationAssemblyPath: z.string(),
  cloudFormationDiffPath: z.string(),
});

export type PlanRecord = z.infer<typeof planRecordSchema>;

export interface DeploymentReceipt {
  readonly schemaVersion: 1;
  readonly release: '1.0.0-rc.6';
  readonly changeId: string;
  readonly hostname: string;
  readonly completedAt: string;
  readonly configurationSha256: string;
  readonly sourceSha256: string;
  readonly terraformPlanSha256: string;
  readonly terraformProviderLockSha256: string;
  readonly terraformPlanTextSha256: string;
  readonly cloudFormationTemplateSha256: string;
  readonly cloudFormationAssemblySha256: string;
  readonly cloudFormationDiffSha256: string;
  readonly planRecordSha256: string;
  readonly migrationTaskArn: string;
  readonly bootstrapTaskArn: string;
  readonly cloudFormationStackId: string;
  readonly applicationClusterName: string;
  readonly applicationServiceName: string;
  readonly failedTaskArns: readonly string[];
}

/**
 * Creates or verifies the final deployment work directory, rejects a symbolic-link/non-directory
 * target and reduces its permissions to owner-only before any configuration or evidence is written.
 */
export async function ensurePrivateDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const metadata = await lstat(directory);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new Error('The deployment work path must be a real directory, not a link or file.');
  }
  if (typeof process.getuid === 'function' && metadata.uid !== process.getuid()) {
    throw new Error('The deployment work directory must be owned by the current operating user.');
  }
  await chmod(directory, 0o700);
}

/**
 * Hashes one file as raw bytes. Plan/application verification uses this for configuration and plan
 * artifacts, avoiding newline or character-encoding transformations.
 */
export async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  const handle = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile()) throw new Error(`${filePath} is not a regular file.`);
    hash.update(await handle.readFile());
  } finally {
    await handle.close();
  }
  return hash.digest('hex');
}

/**
 * Reads a regular file through an `O_NOFOLLOW` descriptor and enforces a byte limit before loading
 * it. Deployment configuration, progress and CDK outputs use this to close symlink/size races.
 */
export async function readBytesSecure(
  filePath: string,
  maximumBytes = 128 * 1024 * 1024,
): Promise<Buffer> {
  const handle = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.size > maximumBytes) {
      throw new Error(`${filePath} is not a regular file or exceeds ${maximumBytes} bytes.`);
    }
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

/** Decodes a securely opened bounded file as UTF-8 for JSON/text consumers. */
export async function readTextSecure(filePath: string, maximumBytes: number): Promise<string> {
  return (await readBytesSecure(filePath, maximumBytes)).toString('utf8');
}

/**
 * Recursively enumerates controlled source files while excluding dependencies, builds, output PDFs
 * and deployment work state. Sorting makes the aggregate digest stable across filesystems.
 */
async function controlledFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isSymbolicLink()) {
      throw new Error(
        `Controlled source must not contain a symbolic link: ${join(directory, entry.name)}`,
      );
    }
    if (excludedDirectoryNames.has(entry.name) || excludedFileNames.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await controlledFiles(path)));
    else if (entry.isFile()) files.push(path);
    else throw new Error(`Controlled source contains a non-regular entry: ${path}`);
  }
  return files.sort();
}

/**
 * Creates a path-aware digest for the complete controlled source tree. Both file names and contents
 * are hashed, so a rename, deletion or byte change invalidates a previously approved plan.
 */
export async function sha256SourceTree(repositoryRoot: string): Promise<string> {
  const hash = createHash('sha256');
  for (const filePath of await controlledFiles(repositoryRoot)) {
    hash.update(relative(repositoryRoot, filePath).replaceAll('\\', '/'));
    hash.update('\0');
    hash.update(await readBytesSecure(filePath));
    hash.update('\0');
  }
  return hash.digest('hex');
}

/**
 * Hashes every path and byte in a generated directory without exclusions. RC6 uses this for the CDK
 * cloud assembly so asset manifests and metadata are approved alongside the stack template.
 */
export async function sha256DirectoryTree(directory: string): Promise<string> {
  const hash = createHash('sha256');
  /** Enumerates every regular assembly file and rejects links or special filesystem entries. */
  async function filesBelow(current: string): Promise<string[]> {
    const files: string[] = [];
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) files.push(...(await filesBelow(path)));
      else if (entry.isFile()) files.push(path);
      else throw new Error(`Generated directory contains a non-regular entry: ${path}`);
    }
    return files.sort();
  }
  for (const filePath of await filesBelow(directory)) {
    hash.update(relative(directory, filePath).replaceAll('\\', '/'));
    hash.update('\0');
    hash.update(await readBytesSecure(filePath));
    hash.update('\0');
  }
  return hash.digest('hex');
}

/**
 * Writes text evidence by replacing an owner-only temporary file in one atomic rename. The rename
 * replaces rather than follows an existing symbolic link and prevents a crash leaving partial data.
 */
export async function writeTextSecure(filePath: string, contents: string): Promise<void> {
  const parent = dirname(filePath);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, contents, {
    encoding: 'utf8',
    mode: 0o600,
    flag: 'wx',
  });
  await chmod(temporaryPath, 0o600);
  await rename(temporaryPath, filePath);
}

/**
 * Serializes a non-secret evidence value and delegates to the atomic text writer. Keeping one write
 * primitive means plan records, progress files and command evidence share the same symlink-safe path.
 */
export async function writeJsonSecure(filePath: string, value: unknown): Promise<void> {
  await writeTextSecure(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

/**
 * Loads and validates the plan record used by the apply phase. A malformed or oversized record is
 * rejected before any Terraform, CloudFormation or ECS mutation can begin.
 */
export async function loadPlanRecord(filePath: string): Promise<PlanRecord> {
  const handle = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.size > 128 * 1024) {
      throw new Error('The deployment plan record is missing, not a file or unexpectedly large.');
    }
    const untrusted: unknown = JSON.parse(await handle.readFile({ encoding: 'utf8' }));
    return planRecordSchema.parse(untrusted);
  } finally {
    await handle.close();
  }
}

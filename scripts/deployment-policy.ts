/**
 * @fileoverview Contains pure, testable AWS resource-policy checks used by RC5 preflight. Keeping
 * policy interpretation separate from AWS CLI orchestration lets the quality gate prove that a
 * partial or principal-scoped S3 transport denial cannot be mistaken for a bucket-wide TLS rule.
 */

/** Returns true only for a non-null JSON object whose properties can be inspected safely. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Converts an IAM scalar-or-array field into strings and rejects mixed/non-string values. */
function stringList(value: unknown): readonly string[] {
  if (typeof value === 'string') return [value];
  if (
    Array.isArray(value) &&
    value.every(
      /** Rejects any non-string element before an IAM scalar-or-array value is trusted. */
      (item) => typeof item === 'string',
    )
  )
    return value;
  return [];
}

/**
 * Confirms an IAM Principal field applies to everyone. The standard representation is `"*"`, but
 * AWS also accepts `{ "AWS": "*" }`; restricted principals do not protect every bucket caller.
 */
function appliesToEveryPrincipal(value: unknown): boolean {
  if (value === '*') return true;
  if (!isRecord(value)) return false;
  return Object.values(value).some(
    /** Recognises a wildcard in any supported principal namespace such as `AWS`. */
    (principal) => stringList(principal).includes('*'),
  );
}

/** Detects the exact `aws:SecureTransport=false` Bool condition required for a TLS-only denial. */
function deniesInsecureTransport(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.Bool)) return false;
  const secureTransport = value.Bool['aws:SecureTransport'];
  return secureTransport === false || stringList(secureTransport).includes('false');
}

/** Returns whether an IAM S3 resource covers the bucket itself and/or every object below it. */
function resourceCoverage(
  resources: readonly string[],
  bucketName: string,
): { readonly bucket: boolean; readonly objects: boolean } {
  const bucketSuffix = `:s3:::${bucketName}`;
  const objectSuffix = `${bucketSuffix}/*`;
  return {
    bucket: resources.some(
      /** Matches the exact state bucket ARN or an all-resources wildcard. */
      (resource) => resource === '*' || resource.endsWith(bucketSuffix),
    ),
    objects: resources.some(
      /** Matches the exact state object wildcard ARN or an all-resources wildcard. */
      (resource) => resource === '*' || resource.endsWith(objectSuffix),
    ),
  };
}

/**
 * Requires the S3 state-bucket policy to deny every principal from every S3 action on both the
 * bucket and its objects when transport is not TLS. Split valid deny statements are supported;
 * malformed JSON and partial coverage fail closed with an operator-facing error.
 */
export function assertStateBucketTlsPolicy(policyText: string, bucketName: string): void {
  let untrusted: unknown;
  try {
    untrusted = JSON.parse(policyText) as unknown;
  } catch (error) {
    throw new Error('Terraform state bucket policy is not valid JSON.', { cause: error });
  }
  if (!isRecord(untrusted)) throw new Error('Terraform state bucket policy is not a JSON object.');
  const rawStatements = Array.isArray(untrusted.Statement)
    ? untrusted.Statement
    : [untrusted.Statement];
  let bucketProtected = false;
  let objectsProtected = false;
  for (const rawStatement of rawStatements) {
    if (!isRecord(rawStatement)) continue;
    const actions = stringList(rawStatement.Action).map(
      /** Normalizes IAM action names because evaluation is case-insensitive. */
      (action) => action.toLowerCase(),
    );
    if (
      rawStatement.Effect !== 'Deny' ||
      !appliesToEveryPrincipal(rawStatement.Principal) ||
      !actions.some(
        /** Requires coverage of every S3 operation, not a partial read/write subset. */
        (action) => action === '*' || action === 's3:*',
      ) ||
      !deniesInsecureTransport(rawStatement.Condition)
    ) {
      continue;
    }
    const coverage = resourceCoverage(stringList(rawStatement.Resource), bucketName);
    bucketProtected ||= coverage.bucket;
    objectsProtected ||= coverage.objects;
  }
  if (!bucketProtected || !objectsProtected) {
    throw new Error(
      'Terraform state bucket policy must deny non-TLS S3 access for every principal on the bucket and all objects.',
    );
  }
}

terraform {
  # RC5 writes no local production state. `deploy:plan` supplies the validated per-school S3 key,
  # region and customer KMS key at init time, after `deploy:check` proves versioning, four-way public
  # access blocking, TLS-only bucket policy, bucket-owner enforcement, KMS encryption/rotation and
  # the correct AWS account.
  backend "s3" {}
}

#!/usr/bin/env bash

# Edutex production deployment values - non-secret template
#
# COPY this file into the school-specific operator folder described in the
# beginner setup guide. Do not edit the copy inside the release. Replace every
# EXAMPLE or placeholder in the copied file. Leave only the controlled all-zero
# Tunnel UUID until Step 9 creates the Tunnel, then replace it immediately. This
# file must never contain a password, API token, secret key, cookie, recovery
# code or private record.

export EDUTEX_ENVIRONMENT='production'
export EDUTEX_AWS_PROFILE='edutex-production-deployer'
export EDUTEX_AWS_REGION='ap-southeast-2'
export EDUTEX_AWS_ACCOUNT_ID='111111111111'
export EDUTEX_STACK_NAME='Edutex-production'

export EDUTEX_SCHOOL_SLUG='example-school'
export EDUTEX_SCHOOL_NAME='Example School'
export EDUTEX_HOSTNAME='portal.school.example'
export EDUTEX_CAMPUS_NAME='Main Campus'
export EDUTEX_ACADEMIC_YEAR_NAME='2026 School Year'
export EDUTEX_ACADEMIC_YEAR_START='2026-01-27'
export EDUTEX_ACADEMIC_YEAR_END='2026-12-18'
export EDUTEX_TIMEZONE='Australia/Melbourne'
export EDUTEX_COUNTRY='AU'
export EDUTEX_ADMIN_EMAIL='initial.admin@school.example'
export EDUTEX_ADMIN_NAME='Initial Administrator'

export EDUTEX_SES_DOMAIN='school.example'
export EDUTEX_SES_FROM='no-reply@school.example'
export EDUTEX_SES_CONFIGURATION_SET='edutex-transactional'

export EDUTEX_CF_ACCOUNT_ID='0123456789abcdef0123456789abcdef'
export EDUTEX_CF_ZONE_ID='fedcba9876543210fedcba9876543210'
export EDUTEX_CF_TUNNEL_ID='00000000-0000-4000-8000-000000000000'

export EDUTEX_TF_STATE_BUCKET='approved-unique-terraform-state-bucket'
export EDUTEX_TF_STATE_KEY="edutex/${EDUTEX_SCHOOL_SLUG}/cloudflare.tfstate"
export EDUTEX_TF_STATE_KMS_ARN='arn:aws:kms:ap-southeast-2:111111111111:key/key-id'

# These aliases deliberately make AWS CLI and CDK use the same approved target.
export AWS_PROFILE="$EDUTEX_AWS_PROFILE"
export AWS_REGION="$EDUTEX_AWS_REGION"
export AWS_DEFAULT_REGION="$EDUTEX_AWS_REGION"
export CDK_DEFAULT_ACCOUNT="$EDUTEX_AWS_ACCOUNT_ID"
export CDK_DEFAULT_REGION="$EDUTEX_AWS_REGION"

# Cross-platform SHA-256 helper used by later guide steps. GNU/Linux provides
# sha256sum; managed macOS provides shasum. Both emit the same standard format.
edutex_sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$@"
  else
    shasum -a 256 "$@"
  fi
}

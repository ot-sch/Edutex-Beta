---
title: 'Edutex Production Deployment & Setup Guide'
subtitle: 'Exact AWS, Cloudflare, PostgreSQL, Cognito, SSO, migration and go-live procedure'
author: 'Edutex Engineering'
date: 'Release candidate 5 · 12 August 2026'
lang: en-GB
documentclass: report
classoption:
  - oneside
  - openany
papersize: a4
fontsize: 9.5pt
geometry:
  - top=23mm
  - bottom=24mm
  - left=19mm
  - right=19mm
colorlinks: true
linkcolor: EdutexBlue
urlcolor: EdutexTeal
toccolor: EdutexBlue
toc-depth: 3
secnumdepth: 3
---

# Document control, scope and safe-use rules

| Field                           | Controlled value                                                                                                                            |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Document                        | Edutex Production Deployment & Setup Guide                                                                                                  |
| Version                         | 1.0.0-rc.5                                                                                                                                  |
| Source baseline                 | `edutex-production` release candidate 5, 12 August 2026                                                                                     |
| Intended readers                | Platform engineers, security engineers, database engineers, identity engineers, release managers and authorised school administrators       |
| Supported topology              | One production AWS stack, Cloudflare hostname and school per client deployment                                                              |
| Primary region used in examples | `ap-southeast-2`; replace only after a documented residency/availability decision                                                           |
| Security baseline               | ISO/IEC 27001:2022 + Amd 1:2024; OWASP ASVS 5.0.0 Level 2 plus selected Level 3 controls; OWASP Top 10:2025; OWASP API Security Top 10:2023 |
| Quality baseline                | ISO 9001:2015 + Amd 1:2024                                                                                                                  |
| Required approvers              | Release Manager, Platform Owner, Security Owner, Data Owner and client-authorised change approver                                           |
| Review trigger                  | Every release, material service/provider change, major incident, failed restore or penetration-test finding                                 |

## What this guide does and does not promise

This is the detailed technical companion for this release candidate. For RC5, the authoritative
mutation sequence is the four-stage deployment assistant in `docs/operations/DEPLOYMENT_RUNBOOK.md`.
Run `deploy:new`, `deploy:check`, `deploy:plan` and `deploy:apply`; do not substitute the older
manual Terraform/CDK/ECS command sequences retained later in this document for explanation,
troubleshooting and independent evidence review. This guide expands every production gate and
records expected outcomes and stop conditions. It cannot guarantee that an account-specific
deployment will encounter no error: AWS quotas, Cloudflare plan entitlements, school identity
configuration, DNS delegation, organisational policy and future service changes are external
variables. The method for avoiding silent failure is to execute every preflight, inspect every plan,
compare every expected result and stop at the stated gates.

The application is not ISO certified merely because this procedure is followed. Certification
applies to the operating organisation's scoped management system. Likewise, OWASP conformance and
penetration-test readiness require retained live evidence, independent verification and closure or
formal acceptance of residual risks.

## Mandatory language

- **Must** means the release stops if the requirement is not met.
- **Should** means deviation requires a written justification and named risk owner.
- **May** means an optional choice within the stated boundary.
- Commands beginning with `$` are run by the deployment operator; do not type the `$`.
- Values such as `portal.school.example` are examples. Populate the deployment worksheet first and
  then use its environment variables consistently.

## Four-person production control

| Role                 | May perform                                             | Must not perform alone                               |
| -------------------- | ------------------------------------------------------- | ---------------------------------------------------- |
| Deployment operator  | Run approved commands and collect evidence              | Approve their own production plan                    |
| Technical reviewer   | Review source, IaC plans, IAM and expected replacements | Supply or copy long-lived secrets                    |
| Security approver    | Review WAF, identity, logging, risk and security gates  | Waive law, contract or absolute policy               |
| Data/client approver | Approve migration, reconciliation and go-live           | Approve unresolved cross-tenant or integrity defects |

Use short-lived federated identities. Do not use the AWS root user, static IAM user access keys,
personal Cloudflare global API keys, real student data in validation, or secrets in tickets, chat,
screenshots, command-line arguments, source files, `.tfvars`, Terraform state outputs or CI logs.

## Release-candidate corrections included in this guide

This guide assumes RC5 source. RC5 retains all RC2-RC4 corrections and adds these deployment and
maintainability controls:

1. A guided interview validates one non-secret deployment configuration shared by Cloudflare, AWS,
   PostgreSQL migration and school bootstrap.
2. A read-only check proves exact AWS identity, state-bucket/KMS protections, Tunnel-secret stage,
   SES verification and minimum local tool versions.
3. The plan stage runs the complete quality/security gate and binds configuration, source and binary
   Terraform plan SHA-256 values to the change ID and hostname.
4. Production starts at zero application tasks; migration and bootstrap must both exit zero before
   activation at a minimum of three tasks.
5. Deterministic ECS client tokens and owner-only atomic progress records make interrupted applies
   resumable without duplicating one-shot work.
6. Apply requires `--execute`, the exact approved change ID, exact hostname, unchanged bytes and the
   active approved maintenance window.
7. An AST quality gate requires a file overview and attached meaningful comment for every maintained
   function/callback.

Retained security corrections include:

1. CDK synthesis does **not** accept CloudFormation `--parameters`; parameters are supplied only to
   `cdk deploy`.
2. `--ses-from-address` accepts one plain email address, for example `no-reply@school.example`, not
   a display-name form such as `Edutex <...>`.
3. The seeded administrator is marked `email_verified=true` when Cognito sends the invitation, so
   the BFF's verified-email check permits the forced-change first sign-in.
4. Passkeys enable Cognito `ALLOW_USER_AUTH`, use the managed-login domain as the WebAuthn RP ID,
   and enrol through a CSRF-protected, state/nonce/PKCE-bound self-service action.
5. SSO client secrets are stored below `edutex/tenants/<tenant-id>/identity/...`, exactly matching
   the ECS task-role policy, and the role can describe the secret after rotation.
6. Only fingerprinted login assets receive immutable caching; replaceable logos refresh safely.
7. Module visibility uses row-version checks and rolls the complete change back on a conflict.
8. Legacy booleans, capacities, employment types and status aliases are validated before SQL.
9. Hostnames, IANA timezones, AWS regions, Cloudflare IDs/CIDRs and the production HTTPS origin fail
   closed before a deployment or bootstrap can use malformed values.
10. Every newly configured external identity provider is staged as disabled; an explicit,
    row-versioned Enable action fails closed until at least one provider-scoped role mapping exists.
11. PostgreSQL `bigint` row versions are normalised to JSON numbers at the administration API
    boundary so policy, module and provider optimistic-concurrency checks work reliably.

Stop if the source package does not contain these corrections.

\newpage

# Deployment overview and immutable order

## Supported production boundary

Deploy one school per production stack. Although PostgreSQL retains tenant IDs, composite
tenant-aware foreign keys and row-level security as defence in depth, this release has one global
`PUBLIC_BASE_URL` and one Cloudflare Tunnel hostname. Bootstrapping a second school into the same
stack is unsupported and can create incorrect callback URLs and routing. Repeat this entire guide
with a distinct AWS account or isolated client environment, hostname, Terraform state key and
approved evidence set for each school.

## Ordered execution

| Phase                 | Outcome                                                                     | Stop gate                                                            |
| --------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 0. Authorise          | Scope, data residency, owners, maintenance window and rollback approved     | Missing accountable owner or client approval                         |
| 1. Baseline           | AWS and Cloudflare administrative/security baselines effective              | Root/static credentials, absent audit trail or unsupported plan      |
| 2. Verify source      | Exact RC5 source, dependencies, tests, SBOM and scans approved              | High/critical runtime issue or unreviewed source                     |
| 3. Prepare email      | SES domain, DKIM, DMARC and production sending ready                        | SES sandbox or failed identity when invitations are required         |
| 4. Prepare edge       | Tunnel, DNS, WAF, rate limits and restrictions applied                      | Existing ruleset collision, weakened managed rules or wrong hostname |
| 5. Store token        | Tunnel token exists only in Secrets Manager and controlled input            | Token exposed or no `AWSCURRENT` version                             |
| 6. Deploy AWS         | Private CDK stack completes without an internet origin                      | Public IP/ALB/inbound origin, destructive replacement or rollback    |
| 7. Migrate schema     | Every immutable PostgreSQL migration exits 0                                | SQL/checksum error or task failure                                   |
| 8. Bootstrap school   | Cognito pool, initial admin, tenant defaults and key created                | Any partial/ambiguous provisioning result                            |
| 9. Configure identity | TOTP, passkey and each selected SSO provider pass positive/negative tests   | Default access, claim ambiguity or MFA bypass                        |
| 10. Migrate data      | Approved typed import reconciles completely                                 | Unknown fields, broken relationships or unsigned reconciliation      |
| 11. Verify release    | Security, tenancy, restore, accessibility and observability evidence passes | Any mandatory live gate fails                                        |
| 12. Go live           | DNS/access enabled under monitoring, handover accepted                      | On-call/SIEM/rollback unavailable                                    |

Do not reorder schema migration and school bootstrap. The service's liveness check can pass before
the schema exists, so an ECS service that appears stable is not evidence that the application is
ready.

# Phase 0 - authorisation and deployment worksheet

## Required decisions before touching an account

Create a change record containing:

- client legal name, school display name and unique lower-case slug;
- data controller/processor responsibilities, privacy impact assessment and safeguarding contacts;
- region and evidence supporting residency, availability and cross-border transfer decisions;
- exact portal hostname and DNS zone owner;
- Cloudflare plan and features contractually available;
- approved whole-site country/IP policy and separate administration CIDRs;
- AWS account ID, organisation/OU, support plan and escalation contacts;
- session policy, local-login policy, SSO providers and directory-role design;
- RPO, RTO, retention, legal hold and deletion requirements;
- maintenance window, communication plan, rollback decision authority and no-go deadline;
- source revision/package SHA-256, image/SBOM identifiers and named approvers;
- synthetic identities for student, teacher, corporate staff, IT staff, executive, unmapped and
  disabled-user tests;
- penetration-test scope, test source IPs, emergency stop contact and data handling agreement.

## Shell worksheet

Run in a clean, dedicated terminal. Values are non-secret unless explicitly stated. Use a separate
terminal/session for another client.

```bash
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

export EDUTEX_CF_ACCOUNT_ID='cloudflare-account-id'
export EDUTEX_CF_ZONE_ID='cloudflare-zone-id'
export EDUTEX_CF_TUNNEL_ID='00000000-0000-4000-8000-000000000000'

export EDUTEX_TF_STATE_BUCKET='approved-unique-terraform-state-bucket'
export EDUTEX_TF_STATE_KEY="edutex/${EDUTEX_SCHOOL_SLUG}/cloudflare.tfstate"
export EDUTEX_TF_STATE_KMS_ARN='arn:aws:kms:ap-southeast-2:111111111111:key/key-id'

export AWS_PROFILE="$EDUTEX_AWS_PROFILE"
export AWS_REGION="$EDUTEX_AWS_REGION"
export AWS_DEFAULT_REGION="$EDUTEX_AWS_REGION"
export CDK_DEFAULT_ACCOUNT="$EDUTEX_AWS_ACCOUNT_ID"
export CDK_DEFAULT_REGION="$EDUTEX_AWS_REGION"
```

Validate every value before continuing:

```bash
test "$EDUTEX_ENVIRONMENT" = 'production'
printf '%s' "$EDUTEX_HOSTNAME" | grep -Eq '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$'
printf '%s' "$EDUTEX_SCHOOL_SLUG" | grep -Eq '^[a-z0-9][a-z0-9-]{1,40}$'
printf '%s' "$EDUTEX_COUNTRY" | grep -Eq '^[A-Z]{2}$'
test "$EDUTEX_SES_FROM" = "${EDUTEX_SES_FROM#*<}"
test "$EDUTEX_AWS_ACCOUNT_ID" = "$(aws sts get-caller-identity --query Account --output text)"
aws configure get region | grep -Fx "$EDUTEX_AWS_REGION"
```

Expected: every command exits 0. The SES test intentionally rejects a display-name/address form. If
`aws configure get region` is blank because the environment variable supplies it, confirm with
`aws configure list`; do not change region silently.

## Evidence directory

Evidence must be written to an access-controlled release system, not a world-readable temporary
folder. The following local staging folder contains no secrets and is copied into that system at the
end of each phase:

```bash
umask 077
export EDUTEX_EVIDENCE_DIR="$(mktemp -d -t edutex-release-evidence.XXXXXX)"
printf 'Evidence staging: %s\n' "$EDUTEX_EVIDENCE_DIR"
date -u +'%Y-%m-%dT%H:%M:%SZ' > "$EDUTEX_EVIDENCE_DIR/started-at.txt"
aws sts get-caller-identity > "$EDUTEX_EVIDENCE_DIR/aws-caller-identity.json"
```

Never store Cloudflare tokens, tunnel tokens, Cognito client secrets, temporary passwords, database
secrets, OAuth codes, session cookies or raw production records in evidence.

# Phase 1 - workstation and toolchain

## Supported operator environment

Use a managed Linux workstation, macOS workstation or WSL2 environment with full-disk encryption,
EDR, current security patches, screen lock, no unapproved shell recording and access through the
organisation's managed identity/VPN. Do not deploy from a personal device or web-based shared shell.

Install from vendor-supported channels and pin versions in the deployment runner. The source
requires:

| Tool                 |                           Required/approved version | Used for                                                    |
| -------------------- | --------------------------------------------------: | ----------------------------------------------------------- |
| Node.js              |         24.14 or later within approved Node 24 line | builds, tests and scripts                                   |
| npm                  |                                         11 or later | lockfile install, audit, SBOM and workspaces                |
| Docker Engine/buildx | current approved release with `linux/arm64` support | immutable application image                                 |
| AWS CLI              |                                                  v2 | identity, SES, Secrets Manager, ECS and verification        |
| AWS CDK              |               repository lockfile/workspace version | CloudFormation synthesis/deployment                         |
| Terraform            |                                       1.10 or later | Cloudflare resources and S3 state locking                   |
| jq                   |                          1.7 or approved equivalent | exact JSON extraction and overrides                         |
| curl/OpenSSL         |                           current supported release | TLS, header and endpoint checks                             |
| Git                  |                           current supported release | source identity and review where repository metadata exists |

Verify, capture and review:

```bash
node --version
npm --version
docker version
docker buildx version
aws --version
terraform version
jq --version
curl --version
openssl version
```

Save non-secret versions:

```bash
{
  node --version
  npm --version
  docker buildx version
  aws --version
  terraform version
  jq --version
  openssl version
} > "$EDUTEX_EVIDENCE_DIR/tool-versions.txt" 2>&1
```

Stop if Node/npm/Terraform are below the stated minimum, Docker cannot build ARM64, or an unapproved
prerelease/binary source is present.

## ARM64 build preflight

```bash
docker buildx inspect --bootstrap
docker run --rm --platform linux/arm64 public.ecr.aws/docker/library/alpine:3.22 uname -m
```

Expected architecture: `aarch64`. If the host needs emulation, enable the organisation-approved
buildx builder. Do not switch the CDK task to x86 to bypass a builder problem without a reviewed
architecture change.

# Phase 2 - AWS organisation and account baseline

## Account placement

The client production account must be separate from development/test, enrolled in the approved AWS
Organisation/Control Tower landing zone and covered by central security/logging accounts. Apply
service-control policies that prevent disabling audit/security services, leaving the organisation,
public S3 access and use of unapproved regions, while preserving a tested break-glass path.

Minimum account gates:

| Control                   | Required evidence                                                                                         |
| ------------------------- | --------------------------------------------------------------------------------------------------------- |
| Root account              | Hardware MFA, no access keys, monitored use, secured recovery contacts                                    |
| Human access              | IAM Identity Center/approved federation, MFA, short-lived sessions, no shared accounts                    |
| Deployment role           | Least privilege, named trust policy, permission boundary where required, CloudTrail attribution           |
| CloudTrail                | Multi-region organisation trail, management events, S3/KMS protected destination, validation and alerting |
| GuardDuty                 | Enabled and delegated to security administrator; findings routed to on-call/SIEM                          |
| Security Hub              | Enabled with organisational standards/aggregation and finding workflow                                    |
| AWS Config                | Organisation recorder/aggregator and required conformance packs                                           |
| Inspector/ECR             | Container/dependency scan path enabled and findings reviewed                                              |
| Budgets/anomaly detection | Client thresholds and security/cost contacts tested                                                       |
| Support/escalation        | Appropriate support plan and incident contacts recorded                                                   |
| Region                    | Only approved workload region used; global services understood                                            |

These are management-system controls and are deliberately not created by the application stack. Stop
and have the platform/security team establish them before deployment.

## Authenticate with short-lived AWS access

Example IAM Identity Center flow:

```bash
aws sso login --profile "$EDUTEX_AWS_PROFILE"
aws sts get-caller-identity
```

Confirm the `Account` is exactly `$EDUTEX_AWS_ACCOUNT_ID`, the assumed-role ARN is the approved
deployment role and the session expiry covers the change window. Re-authenticate rather than
creating access keys if the session expires.

## Quotas and regional availability

In the target region confirm:

- Aurora PostgreSQL Serverless v2 and version 16.6 are available;
- Fargate Linux ARM64 is available in at least three selected availability zones;
- Cognito Plus, managed login v2, WebAuthn and advanced security features are available;
- NAT gateway, elastic IP, VPC, security group, ECS task, CloudWatch Logs, KMS and Secrets Manager
  quotas cover the stack plus headroom;
- SES can send from the required verified domain;
- Cloudflare can reach the public AWS service endpoints needed by `cloudflared` through NAT.

Request quota increases before the change window. A quota error is a stop condition, not a reason to
reduce production high availability.

# Phase 3 - Cloudflare account, zone and security baseline

## Administrative baseline

Cloudflare administrators must use individual SSO accounts with phishing-resistant MFA where the
plan supports it. Require least-privilege roles, change alerts, audit-log retention, two-person
approval for production and protected break-glass credentials. Do not use a Global API Key.

Confirm the portal's parent zone is active in the correct account and nameserver delegation is
complete:

```bash
dig +short NS "$EDUTEX_SES_DOMAIN"
dig +short SOA "$EDUTEX_SES_DOMAIN"
```

The returned authoritative nameservers must match the approved zone. If DNS is split across
providers, document which provider owns each SES and portal record before proceeding.

## Cloudflare plan capability gate

Confirm with the account team and in the actual zone that the plan permits:

- Cloudflare Tunnel/Zero Trust connector management;
- Cloudflare Managed Ruleset and OWASP Core Ruleset deployment;
- the required custom-rule count and `http_ratelimit` rules;
- the selected OWASP paranoia level controls;
- IP/country expressions and the intended request characteristics;
- Bot Management fields if `enable_bot_management=true`.

Leave bot management disabled unless the `cf.bot_management.*` fields are licensed. Never resolve a
plan error by removing WAF controls without an approved replacement and risk decision.

## Edge TLS settings

In **SSL/TLS > Edge Certificates** set Minimum TLS Version to **TLS 1.2**, enable TLS 1.3 and enable
Always Use HTTPS. Do not select Flexible mode. The tunnel carries encrypted outbound transport to
Cloudflare and HTTP only over loopback between `cloudflared` and the application container.

Do **not** enable Authenticated Origin Pulls for this hostname: Cloudflare documents that it is not
compatible with Cloudflare Tunnel. Add HSTS only after hostname, redirects, certificate issuance and
recovery have been tested; an incorrect long HSTS policy is difficult to reverse for clients.

# Phase 4 - SES identity and invitation delivery

## Create and verify the sending domain

Use SES v2 in the same region as Cognito:

```bash
aws sesv2 create-email-identity \
  --email-identity "$EDUTEX_SES_DOMAIN" \
  --region "$EDUTEX_AWS_REGION" \
  > "$EDUTEX_EVIDENCE_DIR/ses-create-identity.json"

aws sesv2 get-email-identity \
  --email-identity "$EDUTEX_SES_DOMAIN" \
  --region "$EDUTEX_AWS_REGION" \
  > "$EDUTEX_EVIDENCE_DIR/ses-identity.json"
```

If the identity already exists, `create-email-identity` may return `AlreadyExistsException`; verify
ownership/change history and continue with `get-email-identity`. From `DkimAttributes.Tokens`,
create all three DNS CNAMEs:

```text
<token>._domainkey.school.example  CNAME  <token>.dkim.amazonses.com
```

Also publish an approved DMARC policy at `_dmarc.school.example`. Begin with the organisation's
monitored rollout policy and move to enforcement after legitimate senders are inventoried; do not
invent a DMARC reporting mailbox. SPF alignment depends on the approved MAIL FROM design.

Poll until both identity verification and DKIM are successful:

```bash
aws sesv2 get-email-identity \
  --email-identity "$EDUTEX_SES_DOMAIN" \
  --query '{Verified:VerifiedForSendingStatus,Dkim:DkimAttributes.Status}' \
  --output table
```

Expected: `Verified=true`, `Dkim=SUCCESS`.

## Create the configuration set

```bash
aws sesv2 create-configuration-set \
  --configuration-set-name "$EDUTEX_SES_CONFIGURATION_SET" \
  --region "$EDUTEX_AWS_REGION"
```

If it already exists, inspect it and confirm ownership. Configure bounce, complaint and delivery
events to the approved monitoring destination and suppression policy. The source stack does not
create this external mail-governance path.

## Leave the SES sandbox

In SES **Account dashboard**, request production access for the actual mail type and region. Provide
the website, consent/recipient model, bounce/complaint process and sending volume honestly. Wait for
approval. Confirm:

```bash
aws sesv2 get-account --query '{ProductionAccess:ProductionAccessEnabled,SendingEnabled:SendingEnabled}' --output table
```

Both must be `true` for client invitations. Create the source ARN now:

```bash
export EDUTEX_SES_SOURCE_ARN="arn:aws:ses:${EDUTEX_AWS_REGION}:${EDUTEX_AWS_ACCOUNT_ID}:identity/${EDUTEX_SES_DOMAIN}"
```

The bootstrap `--ses-from-address` value must be the plain address in `$EDUTEX_SES_FROM`. The
display-name syntax is rejected by the script's strict email validator.

# Phase 5 - prepare remote Terraform state

## State security requirements

Cloudflare state contains account, zone, tunnel, hostname and WAF metadata. Treat it as
confidential. Use a pre-existing central state bucket or create one through the organisation's
approved bootstrap stack. It must have:

- S3 Block Public Access at account and bucket level;
- versioning;
- SSE-KMS with a dedicated key and least-privilege deployment/reader policies;
- TLS-only bucket policy;
- access logging/CloudTrail data events per policy;
- object retention/recovery appropriate to infrastructure evidence;
- a unique key for this school;
- Terraform S3 native locking with `use_lockfile=true`;
- no backend credentials embedded in source, plan files or `-backend-config` values.

The application release contains an empty `backend "s3" {}` declaration and therefore cannot use
local production state accidentally.

## Verify the approved backend

```bash
aws s3api get-public-access-block --bucket "$EDUTEX_TF_STATE_BUCKET"
aws s3api get-bucket-versioning --bucket "$EDUTEX_TF_STATE_BUCKET"
aws s3api get-bucket-encryption --bucket "$EDUTEX_TF_STATE_BUCKET"
aws kms describe-key --key-id "$EDUTEX_TF_STATE_KMS_ARN" \
  --query 'KeyMetadata.{Enabled:Enabled,State:KeyState,Manager:KeyManager}' --output table
```

Expected: all public block flags true, versioning `Enabled`, default KMS encryption using the
approved key, and key state `Enabled`. Test that the deployment role can read/write only its
approved state prefix and lock file. Stop if state would be local or publicly accessible.

# Phase 6 - create the Cloudflare Tunnel and scoped token

## Create a remotely managed named tunnel

In Cloudflare Zero Trust:

1. Open **Networks > Connectors > Cloudflare Tunnels**.
2. Choose **Create a tunnel**, connector type **Cloudflared**.
3. Name it `edutex-production-<school-slug>`.
4. Select **Cloudflared** as the environment but do not run the displayed installation command on
   the workstation.
5. Record the tunnel UUID as `$EDUTEX_CF_TUNNEL_ID` and compare account ownership.
6. Copy the connector token once into the controlled secret-entry workflow. Do not paste it into the
   Terraform variables, evidence, change ticket or source.
7. Do not configure a public hostname manually; Terraform owns the CNAME and ingress configuration.

The CNAME may exist while the connector is offline. That is safe because no AWS origin has been
exposed yet.

## Create a least-privilege Cloudflare API token

Create a short-lived or tightly controlled token, limited to the one account and zone. Grant only
the edit/read permissions required for zone DNS records, zone Rulesets/WAF and account Tunnel
configuration. Permission labels can change in the Cloudflare dashboard; have the Cloudflare owner
compare the Terraform resources against the token summary before issuance. Do not grant account-wide
administration or use a Global API Key.

Enter the token without placing its value in shell history:

```bash
IFS= read -r -s -p 'Cloudflare API token: ' CLOUDFLARE_API_TOKEN
printf '\n'
export CLOUDFLARE_API_TOKEN
```

Set non-secret Terraform variables:

```bash
export TF_VAR_account_id="$EDUTEX_CF_ACCOUNT_ID"
export TF_VAR_zone_id="$EDUTEX_CF_ZONE_ID"
export TF_VAR_hostname="$EDUTEX_HOSTNAME"
export TF_VAR_tunnel_id="$EDUTEX_CF_TUNNEL_ID"
```

Verify the token without printing it:

```bash
curl --fail --silent --show-error \
  --header "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  https://api.cloudflare.com/client/v4/user/tokens/verify \
  | jq -e '.success == true and .result.status == "active"' >/dev/null
```

Expected: exit 0 and no token value in output. Rotate immediately if the terminal is recorded or the
token appears in a process capture/log.

# Phase 7 - configure and apply the Cloudflare edge

## Create the protected variable file

From the release root:

```bash
cd infra/cloudflare
umask 077
cp terraform.tfvars.example production.tfvars
```

Edit `production.tfvars` in the approved secret-free editor. It contains identifiers and policy
values only:

```hcl
account_id = "cloudflare-account-id"
zone_id    = "cloudflare-zone-id"
hostname   = "portal.school.example"
tunnel_id  = "00000000-0000-4000-8000-000000000000"

# Whole-site access accepts an approved IP OR an approved country when both lists are present.
allowed_ip_cidrs      = ["203.0.113.0/24"]
allowed_country_codes = ["AU", "NZ"]

# Administration is independently limited to these networks.
admin_ip_cidrs = ["203.0.113.0/24", "2001:db8:1234::/48"]

# Leave false unless the selected plan exposes cf.bot_management fields.
enable_bot_management = false
```

Use real client CIDRs; documentation ranges above will not permit production clients. Include all
authorised NAT/VPN egress addresses and IPv6 ranges. Avoid individual home IPs for privileged
administration. If the school requires strict whole-site IP **and** country membership rather than
the current approved OR semantics, stop and obtain a reviewed Terraform change; do not assume AND.

Confirm the token is absent:

```bash
if grep -Ein 'api[_ -]?token|secret|password|bearer' production.tfvars; then
  printf 'STOP: possible secret in production.tfvars\n' >&2
  exit 1
fi
```

## Inventory existing phase entry-point rulesets

Cloudflare permits one zone entry-point ruleset per phase. The configuration manages these phases:

| Terraform resource               | Phase                           |
| -------------------------------- | ------------------------------- |
| `cloudflare_ruleset.custom_waf`  | `http_request_firewall_custom`  |
| `cloudflare_ruleset.managed_waf` | `http_request_firewall_managed` |
| `cloudflare_ruleset.rate_limits` | `http_ratelimit`                |

In **Security > WAF** and the Rulesets API, inventory every current rule and owner. If an
entry-point ruleset exists, do not apply a second ruleset or delete it. Decide whether to:

- import it into the matching Terraform resource and merge all pre-existing rules into `main.tf`;
- integrate the Edutex rules into the zone's existing shared Terraform ownership; or
- use a dedicated zone where the Edutex configuration is authoritative.

For a reviewed import using Cloudflare provider 5.x:

```bash
terraform import cloudflare_ruleset.custom_waf \
  "zones/${EDUTEX_CF_ZONE_ID}/<existing-custom-ruleset-id>"
terraform import cloudflare_ruleset.managed_waf \
  "zones/${EDUTEX_CF_ZONE_ID}/<existing-managed-ruleset-id>"
terraform import cloudflare_ruleset.rate_limits \
  "zones/${EDUTEX_CF_ZONE_ID}/<existing-rate-ruleset-id>"
```

Replace each placeholder with the exact ruleset ID for that phase. Import only resources that exist.
Immediately run `terraform plan`; an import does not merge source, so copy all retained existing
rules into reviewed Terraform before any apply. Stop on any planned deletion or replacement that
lacks a named owner and approval.

## Initialise the remote backend and provider lock

```bash
terraform init -reconfigure \
  -backend-config="bucket=${EDUTEX_TF_STATE_BUCKET}" \
  -backend-config="key=${EDUTEX_TF_STATE_KEY}" \
  -backend-config="region=${EDUTEX_AWS_REGION}" \
  -backend-config='encrypt=true' \
  -backend-config="kms_key_id=${EDUTEX_TF_STATE_KMS_ARN}" \
  -backend-config='use_lockfile=true'

terraform providers lock
terraform fmt -check -recursive
terraform validate
```

Expected: backend migration/initialisation succeeds, `.terraform.lock.hcl` is created, formatting
and validation exit 0. Review and retain the lockfile. Do not answer yes to migrating unexpected
local state; stop and establish its provenance first.

## Produce a saved plan

```bash
export EDUTEX_CF_PLAN="$EDUTEX_EVIDENCE_DIR/cloudflare.tfplan"
terraform plan \
  -input=false \
  -lock-timeout=5m \
  -var-file=production.tfvars \
  -out="$EDUTEX_CF_PLAN"
terraform show -no-color "$EDUTEX_CF_PLAN" \
  > "$EDUTEX_EVIDENCE_DIR/cloudflare-plan.txt"
terraform show -json "$EDUTEX_CF_PLAN" \
  > "$EDUTEX_EVIDENCE_DIR/cloudflare-plan.json"
```

The reviewer must verify:

- the exact account, zone, hostname and tunnel UUID;
- one proxied CNAME to `<tunnel-uuid>.cfargotunnel.com`;
- ingress to `http://127.0.0.1:8080` with a terminal `http_status:404` rule;
- whole-site and admin restrictions match the change record;
- TRACE/unknown method, scanner-path and public-health blocks are enabled;
- Cloudflare Managed Ruleset and OWASP Core Ruleset execute only for the portal hostname;
- OWASP paranoia level 4 is disabled, resulting in level 3;
- authentication rate limit is 20 requests/60 seconds with a 600-second block;
- API rate limit is 600 requests/60 seconds with managed challenge;
- no retained zone rule is removed;
- no secret value is shown in plan/state outputs.

Record reviewer name, timestamp and plan SHA-256:

```bash
sha256sum "$EDUTEX_CF_PLAN" "$EDUTEX_EVIDENCE_DIR/cloudflare-plan.txt" \
  > "$EDUTEX_EVIDENCE_DIR/cloudflare-plan.sha256"
```

## Apply exactly the reviewed plan

```bash
terraform apply -input=false -lock-timeout=5m "$EDUTEX_CF_PLAN"
terraform output -json > "$EDUTEX_EVIDENCE_DIR/cloudflare-outputs.json"
terraform plan -detailed-exitcode -input=false -var-file=production.tfvars
```

Expected final plan exit code: `0` (no drift). Terraform exit code `2` means changes remain and is a
stop condition; exit code `1` means error. Never generate a new unreviewed plan implicitly during
apply.

## Immediate edge checks while the connector is offline

```bash
dig +short CNAME "$EDUTEX_HOSTNAME"
dig +short "$EDUTEX_HOSTNAME"
```

Expected CNAME target: `${EDUTEX_CF_TUNNEL_ID}.cfargotunnel.com.` and proxied Cloudflare edge
addresses. A browser request may return a tunnel error until AWS starts the connector; it must not
reach any public AWS endpoint.

Unset the Cloudflare API token after Terraform and any approved API checks:

```bash
unset CLOUDFLARE_API_TOKEN
```

# Phase 8 - verify and approve the release source

## Extract without executing

Work from the supplied RC5 release directory. If it is a ZIP, record its SHA-256 before extraction,
scan it with the approved anti-malware service and inspect paths for absolute/traversal entries. Do
not execute prototype patch scripts or reuse a prior `node_modules` directory.

```bash
cd /approved/workspace/Edutex-production
find . -type l -print
find . -type f -perm -0002 -print
```

Expected: only reviewed symbolic links, if any, and no world-writable source. Compare the source
package hash with the release record.

## Confirm the RC5 corrections

```bash
grep -F "ALLOW_USER_AUTH" scripts/bootstrap-school.ts
grep -F "email_verified" scripts/bootstrap-school.ts
grep -F "buildPasskeyRegistrationUrl" apps/api/src/modules/auth/cognito.ts
grep -F 'backend "s3"' infra/cloudflare/backend.tf
grep -F 'edutex/tenants/' apps/api/src/modules/admin/cognito-identity-service.ts
grep -F 'VERSION_CONFLICT' apps/api/src/modules/admin/routes.ts
grep -F 'IDENTITY_PROVIDER_MAPPING_REQUIRED' apps/api/src/modules/admin/routes.ts
grep -F 'rowVersion: Number' apps/api/src/modules/admin/routes.ts
grep -F 'booleanValue' scripts/migrate-legacy.ts
```

All nine commands must find reviewed source. If not, stop: this guide does not support an older
release candidate.

## Install deterministically

```bash
node --version
npm --version
npm ci --ignore-scripts
npm rebuild sharp
```

`npm ci` must use `package-lock.json`, make no lockfile change and run with install scripts
disabled. `sharp` is the only explicitly rebuilt native dependency. Review any unexpected lifecycle
script or network source before continuing.

## Run the full quality gate

```bash
npm run quality 2>&1 | tee "$EDUTEX_EVIDENCE_DIR/npm-quality.txt"
npm audit --omit=dev --audit-level=high --json \
  > "$EDUTEX_EVIDENCE_DIR/npm-runtime-audit.json"
npm audit --audit-level=high --json \
  > "$EDUTEX_EVIDENCE_DIR/npm-full-audit.json" || true
npm sbom --omit=dev --sbom-format=cyclonedx \
  > "$EDUTEX_EVIDENCE_DIR/edutex-runtime-sbom.cdx.json"
```

`npm run quality` must exit 0 and performs type checking, tests, lint with zero warnings, format
check and all workspace builds. Runtime audit must have no unaccepted high/critical advisory. The
full development audit is evidence: RC5 carries risk R-014 for high-severity transitive CDK build
dependencies and must be upgraded, mitigated or re-accepted before its recorded due date. A runtime
high/critical issue is a release stop.

Generate integrity hashes:

```bash
sha256sum package-lock.json "$EDUTEX_EVIDENCE_DIR/edutex-runtime-sbom.cdx.json" \
  > "$EDUTEX_EVIDENCE_DIR/source-evidence.sha256"
```

## Secret and prototype exclusion review

Run the organisation-approved secret scanner. At minimum, perform the repository checks below and
manually review results; they do not replace a dedicated scanner:

```bash
rg -n --hidden --glob '!node_modules/**' --glob '!*.map' \
  '(AKIA[0-9A-Z]{16}|BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|service_role|anon[_-]?key|client_secret\s*[:=])' .
rg -n --hidden --glob '!node_modules/**' '(supabase|localStorage|sessionStorage)' apps packages infra scripts
```

Expected: no live credential, Supabase client or browser token storage. Inspect contextual false
positives; never paste a match containing a secret into evidence. Confirm the legacy prototype is
not present in the runtime image context.

## Build and scan an ARM64 image

```bash
export EDUTEX_LOCAL_IMAGE="edutex:${EDUTEX_SCHOOL_SLUG}-rc2"
docker buildx build \
  --platform linux/arm64 \
  --load \
  --tag "$EDUTEX_LOCAL_IMAGE" \
  .

docker image inspect "$EDUTEX_LOCAL_IMAGE" \
  --format '{{json .RepoDigests}} {{json .Id}}' \
  > "$EDUTEX_EVIDENCE_DIR/local-image-identity.txt"
```

Run the organisation-approved container vulnerability, malware, licence and secret scanners. Store
machine-readable results and require no unaccepted critical/high runtime finding. Verify the final
image runs as UID/GID `10001`, uses a read-only filesystem at runtime and contains no development
toolchain or plaintext secret. CDK will publish an independently hashed asset from the same source;
compare source revision and Docker context rather than assuming the local tag is the deployed
digest.

# Phase 9 - store the Tunnel token in AWS Secrets Manager

## Create the secret without exposing its value

Set the exact name and read the connector token into a non-exported shell variable:

```bash
export EDUTEX_TUNNEL_SECRET_NAME='edutex/production/cloudflare/tunnel-token'
IFS= read -r -s -p 'Cloudflare Tunnel connector token: ' EDUTEX_TUNNEL_TOKEN
printf '\n'
```

Create the secret by sending its value on standard input so it is not a command-line argument:

```bash
printf '%s' "$EDUTEX_TUNNEL_TOKEN" | aws secretsmanager create-secret \
  --name "$EDUTEX_TUNNEL_SECRET_NAME" \
  --description "Cloudflare Tunnel token for ${EDUTEX_SCHOOL_SLUG} production" \
  --tags \
    Key=edutex:environment,Value=production \
    Key=edutex:school,Value="$EDUTEX_SCHOOL_SLUG" \
    Key=edutex:purpose,Value=cloudflare-tunnel \
  --secret-string file:///dev/stdin \
  > "$EDUTEX_EVIDENCE_DIR/tunnel-secret-create.json"
unset EDUTEX_TUNNEL_TOKEN
```

If the name already exists, stop and establish ownership/rotation intent. Do not overwrite it
casually. The default Secrets Manager KMS key is acceptable only if policy permits; when using a
customer key, the ECS execution role must receive `kms:Decrypt` through reviewed CDK/IAM.

Capture only the ARN and metadata:

```bash
export EDUTEX_TUNNEL_SECRET_ARN="$(aws secretsmanager describe-secret \
  --secret-id "$EDUTEX_TUNNEL_SECRET_NAME" --query ARN --output text)"
aws secretsmanager list-secret-version-ids \
  --secret-id "$EDUTEX_TUNNEL_SECRET_ARN" \
  --query 'Versions[].{VersionId:VersionId,Stages:VersionStages,Created:CreatedDate}' \
  > "$EDUTEX_EVIDENCE_DIR/tunnel-secret-versions.json"
jq -e 'any(.[]; .Stages | index("AWSCURRENT"))' \
  "$EDUTEX_EVIDENCE_DIR/tunnel-secret-versions.json" >/dev/null
```

Expected: one current version and exit 0. Never call `get-secret-value` merely to prove the value is
present. Rotate the Cloudflare token and replace the secret immediately if exposure is suspected.

# Phase 10 - bootstrap CDK, synthesise and review AWS

## Bootstrap the target CDK environment

From the release root:

```bash
cd /approved/workspace/Edutex-production
aws sts get-caller-identity
npm exec --workspace @edutex/infra-aws -- cdk bootstrap \
  "aws://${EDUTEX_AWS_ACCOUNT_ID}/${EDUTEX_AWS_REGION}" \
  --termination-protection \
  --no-version-reporting
```

Review the CDK bootstrap stack against organisational policy. In a centrally managed environment,
use the pre-approved bootstrap qualifier, permissions boundary, trust and execution policies rather
than creating an independent one. Never broaden bootstrap trust to unapproved accounts.

Verify:

```bash
aws cloudformation describe-stacks --stack-name CDKToolkit \
  --query 'Stacks[0].{Status:StackStatus,TerminationProtection:EnableTerminationProtection}' \
  --output table
```

Expected: `CREATE_COMPLETE` or `UPDATE_COMPLETE`, termination protection true.

## Synthesise the production stack

The stack name is controlled by `-c environment=production`. CloudFormation parameters are not valid
inputs to `cdk synth`; they remain unresolved `Ref` values in the template and are supplied at
deploy time.

```bash
export EDUTEX_CDK_OUT="$EDUTEX_EVIDENCE_DIR/cdk.out"
npm exec --workspace @edutex/infra-aws -- cdk synth "$EDUTEX_STACK_NAME" \
  -c environment=production \
  --no-version-reporting \
  --output "$EDUTEX_CDK_OUT"

sha256sum "$EDUTEX_CDK_OUT/${EDUTEX_STACK_NAME}.template.json" \
  > "$EDUTEX_EVIDENCE_DIR/cdk-template.sha256"
```

Stop if the synthesised stack ID is not exactly `Edutex-production`; non-production context reduces
NAT, backup and service capacity and must never be deployed as production.

## Mandatory template review

Review the complete template and CDK diff:

```bash
npm exec --workspace @edutex/infra-aws -- cdk diff "$EDUTEX_STACK_NAME" \
  -c environment=production \
  --parameters "${EDUTEX_STACK_NAME}:PublicHostname=${EDUTEX_HOSTNAME}" \
  --parameters "${EDUTEX_STACK_NAME}:CloudflareTunnelTokenSecretArn=${EDUTEX_TUNNEL_SECRET_ARN}" \
  --no-version-reporting \
  > "$EDUTEX_EVIDENCE_DIR/cdk-diff.txt"
```

The reviewer must prove all of the following:

### Network

- VPC spans three AZs with application private-with-egress, database isolated and public NAT
  subnets;
- production has two NAT gateways;
- Fargate tasks have `AssignPublicIp=DISABLED`;
- there is no ALB, internet-facing load balancer, API Gateway, public EC2 endpoint or inbound
  service security-group rule;
- application SG can reach RDS Proxy on 5432; proxy can reach Aurora on 5432;
- migration SG alone can reach the Aurora writer directly on 5432;
- database instances are not publicly accessible;
- default security group is restricted and VPC Flow Logs are present.

### Compute and edge connector

- application task is Linux ARM64, 1 vCPU/2 GiB, 30 GiB ephemeral, non-root UID 10001 and read-only
  root filesystem;
- `cloudflared` is pinned to the reviewed version, non-root UID 65532, read-only and essential;
- tunnel token is injected from the exact Secrets Manager ARN, never as plaintext;
- `cloudflared` waits for the application health check and reaches only loopback port 8080;
- production desired/minimum count is three and auto-scaling maximum is 30;
- deployment circuit breaker with rollback is enabled.

### PostgreSQL

- Aurora PostgreSQL engine is 16.6, encrypted and deletion-protected;
- writer plus production reader are private Serverless v2 instances, minimum 1 ACU and maximum 32;
- backup retention is 35 days and PostgreSQL logs are retained one year;
- `rds.force_ssl=1`, connection/disconnection, lock wait, slow statement and pgAudit settings exist;
- RDS Proxy requires TLS and uses IAM authentication end-to-end;
- application gets neither the migrator password secret nor a direct writer path;
- migration/bootstrap tasks alone receive the generated migrator secret.

### Data protection and state

- KMS keys for tenant field data, files and sessions have rotation and production retention;
- S3 blocks public access, enforces TLS, is versioned and KMS encrypted;
- session/auth transaction DynamoDB tables are KMS encrypted, have TTL and 35-day PITR;
- AWS Backup has daily continuous recovery and monthly archive rules;
- production Backup Vault Lock has the approved 35-day minimum, 2555-day maximum and 3-day
  changeable period;
- retained resources and deletion policies match the recovery plan.

### IAM and logging

- ECS execution role can read only the specified tunnel secret and pull/log assets;
- runtime role uses workload identity for database, S3, DynamoDB, KMS, Cognito and scoped provider
  secret creation;
- wildcard Cognito permissions in the one-shot bootstrap role are understood and time-bounded by
  task invocation; no human assumes the task role;
- CloudWatch log group is `/edutex/production/application`, KMS encrypted and retained one year;
- no secret value, database password or client email is a CloudFormation output.

Any public origin, database CIDR ingress, plaintext secret, unapproved wildcard, disabled deletion
protection, unexpected resource replacement or retained-data deletion is a stop condition.

# Phase 11 - deploy the AWS stack

## Create the reviewed change set through CDK

CDK deploy builds and publishes the Docker asset and creates the CloudFormation change set. Run only
after the diff/template and scanner evidence are approved:

```bash
export EDUTEX_CDK_OUTPUTS="$EDUTEX_EVIDENCE_DIR/cdk-outputs.json"
npm exec --workspace @edutex/infra-aws -- cdk deploy "$EDUTEX_STACK_NAME" \
  -c environment=production \
  --parameters "${EDUTEX_STACK_NAME}:PublicHostname=${EDUTEX_HOSTNAME}" \
  --parameters "${EDUTEX_STACK_NAME}:CloudflareTunnelTokenSecretArn=${EDUTEX_TUNNEL_SECRET_ARN}" \
  --require-approval broadening \
  --outputs-file "$EDUTEX_CDK_OUTPUTS" \
  --no-version-reporting
```

Do not use `--require-approval never` in an interactive production deployment. If the organisation
uses a pipeline, the equivalent approved change-set review must be enforced before execution.

Monitor events separately:

```bash
aws cloudformation describe-stack-events --stack-name "$EDUTEX_STACK_NAME" \
  --max-items 100 \
  > "$EDUTEX_EVIDENCE_DIR/cloudformation-events.json"
aws cloudformation describe-stacks --stack-name "$EDUTEX_STACK_NAME" \
  --query 'Stacks[0].StackStatus' --output text
```

Expected final status: `CREATE_COMPLETE` or `UPDATE_COMPLETE`. If rollback begins, preserve stack,
ECS and CloudWatch events before retrying. Do not repeatedly redeploy an unexplained failure.

## Validate and extract the eight required outputs

```bash
jq -e --arg stack "$EDUTEX_STACK_NAME" '.[$stack] | type == "object"' \
  "$EDUTEX_CDK_OUTPUTS" >/dev/null

export EDUTEX_CLUSTER="$(jq -r --arg stack "$EDUTEX_STACK_NAME" \
  '.[$stack].ApplicationClusterName' "$EDUTEX_CDK_OUTPUTS")"
export EDUTEX_MIGRATION_TASK="$(jq -r --arg stack "$EDUTEX_STACK_NAME" \
  '.[$stack].DatabaseMigrationTaskDefinitionArn' "$EDUTEX_CDK_OUTPUTS")"
export EDUTEX_BOOTSTRAP_TASK="$(jq -r --arg stack "$EDUTEX_STACK_NAME" \
  '.[$stack].SchoolBootstrapTaskDefinitionArn' "$EDUTEX_CDK_OUTPUTS")"
export EDUTEX_LEGACY_TASK="$(jq -r --arg stack "$EDUTEX_STACK_NAME" \
  '.[$stack].LegacyMigrationTaskDefinitionArn' "$EDUTEX_CDK_OUTPUTS")"
export EDUTEX_MIGRATION_SG="$(jq -r --arg stack "$EDUTEX_STACK_NAME" \
  '.[$stack].DatabaseMigrationSecurityGroupId' "$EDUTEX_CDK_OUTPUTS")"
export EDUTEX_SUBNETS_CSV="$(jq -r --arg stack "$EDUTEX_STACK_NAME" \
  '.[$stack].ApplicationSubnetIds' "$EDUTEX_CDK_OUTPUTS")"
export EDUTEX_PROXY_ENDPOINT="$(jq -r --arg stack "$EDUTEX_STACK_NAME" \
  '.[$stack].RdsProxyEndpoint' "$EDUTEX_CDK_OUTPUTS")"
export EDUTEX_FILES_BUCKET="$(jq -r --arg stack "$EDUTEX_STACK_NAME" \
  '.[$stack].FilesBucketName' "$EDUTEX_CDK_OUTPUTS")"

for value in "$EDUTEX_CLUSTER" "$EDUTEX_MIGRATION_TASK" "$EDUTEX_BOOTSTRAP_TASK" \
  "$EDUTEX_LEGACY_TASK" \
  "$EDUTEX_MIGRATION_SG" "$EDUTEX_SUBNETS_CSV" "$EDUTEX_PROXY_ENDPOINT" \
  "$EDUTEX_FILES_BUCKET"; do
  test -n "$value" && test "$value" != 'null'
done
```

Expected: all tests exit 0. The output file contains identifiers, not secret values.

## Confirm there is no public AWS origin

```bash
aws ecs list-services --cluster "$EDUTEX_CLUSTER"
aws ec2 describe-security-groups --group-ids "$EDUTEX_MIGRATION_SG"
aws rds describe-db-clusters \
  --query 'DBClusters[?DatabaseName==`edutex`].{Endpoint:Endpoint,Public:PubliclyAccessible}'
aws s3api get-public-access-block --bucket "$EDUTEX_FILES_BUCKET"
```

Also inspect all stack-created ENIs, service SG ingress and load balancers by CloudFormation stack
tag. Expected: Fargate private IPs only, no application listener, no public database and no public
bucket. Cloudflare Tunnel is the sole inbound path.

## Verify the connector becomes healthy

In Cloudflare **Networks > Connectors**, the tunnel must show the expected three production
connectors after ECS stabilises. In AWS:

```bash
aws logs tail /edutex/production/application --since 15m --format short \
  > "$EDUTEX_EVIDENCE_DIR/initial-application-logs.txt"
aws ecs describe-services --cluster "$EDUTEX_CLUSTER" --services \
  "$(aws ecs list-services --cluster "$EDUTEX_CLUSTER" --query 'serviceArns[0]' --output text)" \
  > "$EDUTEX_EVIDENCE_DIR/ecs-service.json"
```

Review connector registration and application health without retaining tokens. The public
`/health/*` path should be blocked at Cloudflare; use ECS health and logs for internal health.

# Phase 12 - run immutable PostgreSQL migrations

## Build the exact private network configuration

```bash
export EDUTEX_NETWORK_JSON="$(jq -cn \
  --arg subnets "$EDUTEX_SUBNETS_CSV" \
  --arg sg "$EDUTEX_MIGRATION_SG" \
  '{awsvpcConfiguration:{subnets:($subnets|split(",")),securityGroups:[$sg],assignPublicIp:"DISABLED"}}')"
jq -e '.awsvpcConfiguration.subnets | length >= 2' <<<"$EDUTEX_NETWORK_JSON" >/dev/null
jq -e '.awsvpcConfiguration.assignPublicIp == "DISABLED"' <<<"$EDUTEX_NETWORK_JSON" >/dev/null
```

## Start one migration task

```bash
export EDUTEX_MIGRATION_RUN="$EDUTEX_EVIDENCE_DIR/migration-run.json"
aws ecs run-task \
  --cluster "$EDUTEX_CLUSTER" \
  --task-definition "$EDUTEX_MIGRATION_TASK" \
  --launch-type FARGATE \
  --network-configuration "$EDUTEX_NETWORK_JSON" \
  --started-by "edutex-release-${EDUTEX_SCHOOL_SLUG}" \
  > "$EDUTEX_MIGRATION_RUN"

jq -e '(.failures | length) == 0 and (.tasks | length) == 1' \
  "$EDUTEX_MIGRATION_RUN" >/dev/null
export EDUTEX_MIGRATION_TASK_ARN="$(jq -r '.tasks[0].taskArn' "$EDUTEX_MIGRATION_RUN")"
```

If `failures` is non-empty, record its ARN/reason and stop. Never start several migration tasks to
race past a capacity or permissions error.

## Wait and prove exit code 0

```bash
aws ecs wait tasks-stopped \
  --cluster "$EDUTEX_CLUSTER" \
  --tasks "$EDUTEX_MIGRATION_TASK_ARN"

aws ecs describe-tasks \
  --cluster "$EDUTEX_CLUSTER" \
  --tasks "$EDUTEX_MIGRATION_TASK_ARN" \
  > "$EDUTEX_EVIDENCE_DIR/migration-result.json"

export EDUTEX_MIGRATION_EXIT="$(jq -r \
  '.tasks[0].containers[] | select(.name=="migration") | .exitCode' \
  "$EDUTEX_EVIDENCE_DIR/migration-result.json")"
test "$EDUTEX_MIGRATION_EXIT" = '0'
```

Review `stoppedReason`, container `reason` and logs:

```bash
aws logs tail /edutex/production/application \
  --since 30m --log-stream-name-prefix migration --format short \
  > "$EDUTEX_EVIDENCE_DIR/migration-logs.txt"
```

Expected: each pending migration applies once and the runner exits 0. The nine RC5 migration files
are immutable; checksum mismatch, SQL error, lock timeout, TLS/certificate failure, secret denial or
OOM is a stop condition. Do not edit an applied migration or manually mark it complete. Use a new
forward migration or execute the approved point-in-time recovery decision.

## Readiness after migration

Cloudflare blocks `/health/ready` publicly. Validate application/database readiness from an approved
ECS Exec/one-shot diagnostic path only if it was pre-authorised; do not add a public health
exception. At minimum, confirm service logs no longer show undefined relations/migration errors and
the school bootstrap task can connect successfully in the next phase.

# Phase 13 - bootstrap the school and initial administrator

## Pre-bootstrap checks

Confirm:

- migration exit is exactly 0;
- hostname and slug are not allocated to another release/account;
- SES identity, configuration set and production sending are ready;
- administrator name/email are independently verified with the client;
- the initial administrator is an individual, not a shared mailbox;
- the administrator has received secure out-of-band onboarding instructions;
- time zone is an IANA identifier and country is ISO alpha-2;
- academic year name/start/end are approved school-calendar values and end is not before start;
- no second school will be bootstrapped into this stack.

## Generate a protected container override

```bash
umask 077
export EDUTEX_BOOTSTRAP_OVERRIDE="$(mktemp -t edutex-bootstrap.XXXXXX.json)"
jq -n \
  --arg slug "$EDUTEX_SCHOOL_SLUG" \
  --arg name "$EDUTEX_SCHOOL_NAME" \
  --arg hostname "$EDUTEX_HOSTNAME" \
  --arg adminEmail "$EDUTEX_ADMIN_EMAIL" \
  --arg adminName "$EDUTEX_ADMIN_NAME" \
  --arg campusName "$EDUTEX_CAMPUS_NAME" \
  --arg academicYearName "$EDUTEX_ACADEMIC_YEAR_NAME" \
  --arg academicYearStart "$EDUTEX_ACADEMIC_YEAR_START" \
  --arg academicYearEnd "$EDUTEX_ACADEMIC_YEAR_END" \
  --arg timezone "$EDUTEX_TIMEZONE" \
  --arg country "$EDUTEX_COUNTRY" \
  --arg region "$EDUTEX_AWS_REGION" \
  --arg sesSourceArn "$EDUTEX_SES_SOURCE_ARN" \
  --arg sesFrom "$EDUTEX_SES_FROM" \
  --arg sesConfigurationSet "$EDUTEX_SES_CONFIGURATION_SET" \
  '{containerOverrides:[{name:"school-bootstrap",command:[
    "node","scripts/dist/bootstrap-school.js",
    "--slug",$slug,
    "--name",$name,
    "--hostname",$hostname,
    "--admin-email",$adminEmail,
    "--admin-name",$adminName,
    "--campus-name",$campusName,
    "--academic-year-name",$academicYearName,
    "--academic-year-start",$academicYearStart,
    "--academic-year-end",$academicYearEnd,
    "--timezone",$timezone,
    "--country",$country,
    "--region",$region,
    "--ses-source-arn",$sesSourceArn,
    "--ses-from-address",$sesFrom,
    "--ses-configuration-set",$sesConfigurationSet
  ]}]}' > "$EDUTEX_BOOTSTRAP_OVERRIDE"

jq -e '.containerOverrides[0].name == "school-bootstrap"' \
  "$EDUTEX_BOOTSTRAP_OVERRIDE" >/dev/null
jq -e --arg from "$EDUTEX_SES_FROM" \
  '.containerOverrides[0].command | index($from) != null' \
  "$EDUTEX_BOOTSTRAP_OVERRIDE" >/dev/null
```

This file contains identifiers/PII but no password or secret. Protect and delete it after evidence
fields have been redacted/recorded according to policy.

## Run and verify the bootstrap task

```bash
aws ecs run-task \
  --cluster "$EDUTEX_CLUSTER" \
  --task-definition "$EDUTEX_BOOTSTRAP_TASK" \
  --launch-type FARGATE \
  --network-configuration "$EDUTEX_NETWORK_JSON" \
  --overrides "file://${EDUTEX_BOOTSTRAP_OVERRIDE}" \
  --started-by "edutex-school-bootstrap-${EDUTEX_SCHOOL_SLUG}" \
  > "$EDUTEX_EVIDENCE_DIR/bootstrap-run.json"

jq -e '(.failures | length) == 0 and (.tasks | length) == 1' \
  "$EDUTEX_EVIDENCE_DIR/bootstrap-run.json" >/dev/null
export EDUTEX_BOOTSTRAP_TASK_ARN="$(jq -r '.tasks[0].taskArn' \
  "$EDUTEX_EVIDENCE_DIR/bootstrap-run.json")"

aws ecs wait tasks-stopped \
  --cluster "$EDUTEX_CLUSTER" \
  --tasks "$EDUTEX_BOOTSTRAP_TASK_ARN"
aws ecs describe-tasks \
  --cluster "$EDUTEX_CLUSTER" \
  --tasks "$EDUTEX_BOOTSTRAP_TASK_ARN" \
  > "$EDUTEX_EVIDENCE_DIR/bootstrap-result.json"

export EDUTEX_BOOTSTRAP_EXIT="$(jq -r \
  '.tasks[0].containers[] | select(.name=="school-bootstrap") | .exitCode' \
  "$EDUTEX_EVIDENCE_DIR/bootstrap-result.json")"
test "$EDUTEX_BOOTSTRAP_EXIT" = '0'
```

Capture logs with restricted access because they contain tenant ID/email metadata:

```bash
aws logs tail /edutex/production/application \
  --since 30m --log-stream-name-prefix school-bootstrap --format short \
  > "$EDUTEX_EVIDENCE_DIR/bootstrap-logs-restricted.txt"
grep -F 'School created. Tenant ' "$EDUTEX_EVIDENCE_DIR/bootstrap-logs-restricted.txt"
```

Expected: exit 0, one `School created` line and one invitation email. The task creates a Cognito
Plus pool, managed-login v2 domain, confidential PKCE client whose secret is backend-only in the
exact tenant-scoped Secrets Manager record, initial forced-change user, tenant/campus/default
roles/modules and KMS envelope data key. If database provisioning fails, it attempts to deactivate
deletion protection and remove the just-created pool. If cleanup also fails, stop and reconcile both
systems manually under incident/change control; never rerun until state is understood.

## Verify Cognito output rather than trusting the invitation

Find the exact pool by name:

```bash
aws cognito-idp list-user-pools --max-results 60 > "$EDUTEX_EVIDENCE_DIR/user-pools.json"
export EDUTEX_USER_POOL_ID="$(jq -r --arg name "edutex-${EDUTEX_SCHOOL_SLUG}" \
  '[.UserPools[] | select(.Name==$name) | .Id] | if length==1 then .[0] else empty end' \
  "$EDUTEX_EVIDENCE_DIR/user-pools.json")"
test -n "$EDUTEX_USER_POOL_ID"

aws cognito-idp describe-user-pool --user-pool-id "$EDUTEX_USER_POOL_ID" \
  > "$EDUTEX_EVIDENCE_DIR/user-pool.json"
aws cognito-idp get-user-pool-mfa-config --user-pool-id "$EDUTEX_USER_POOL_ID" \
  > "$EDUTEX_EVIDENCE_DIR/user-pool-mfa.json"
aws cognito-idp list-user-pool-clients --user-pool-id "$EDUTEX_USER_POOL_ID" --max-results 60 \
  > "$EDUTEX_EVIDENCE_DIR/user-pool-clients.json"

export EDUTEX_COGNITO_CLIENT_ID="$(jq -r \
  '[.UserPoolClients[] | select(.ClientName=="edutex-browser-bff") | .ClientId] |
   if length==1 then .[0] else empty end' "$EDUTEX_EVIDENCE_DIR/user-pool-clients.json")"
test -n "$EDUTEX_COGNITO_CLIENT_ID"
aws cognito-idp describe-user-pool-client \
  --user-pool-id "$EDUTEX_USER_POOL_ID" \
  --client-id "$EDUTEX_COGNITO_CLIENT_ID" \
  > "$EDUTEX_EVIDENCE_DIR/user-pool-client.json"
```

Check invariants:

```bash
jq -e '.UserPool.UserPoolTier == "PLUS" and .UserPool.DeletionProtection == "ACTIVE"' \
  "$EDUTEX_EVIDENCE_DIR/user-pool.json" >/dev/null
jq -e '.MfaConfiguration == "ON" and .SoftwareTokenMfaConfiguration.Enabled == true' \
  "$EDUTEX_EVIDENCE_DIR/user-pool-mfa.json" >/dev/null
jq -e '.WebAuthnConfiguration.UserVerification == "required" and
       .WebAuthnConfiguration.FactorConfiguration == "MULTI_FACTOR_WITH_USER_VERIFICATION"' \
  "$EDUTEX_EVIDENCE_DIR/user-pool-mfa.json" >/dev/null
jq -e '.UserPoolClient.ExplicitAuthFlows | index("ALLOW_USER_AUTH") != null' \
  "$EDUTEX_EVIDENCE_DIR/user-pool-client.json" >/dev/null
jq -e --arg callback "https://${EDUTEX_HOSTNAME}/api/v1/auth/callback" \
  '.UserPoolClient.CallbackURLs | index($callback) != null' \
  "$EDUTEX_EVIDENCE_DIR/user-pool-client.json" >/dev/null
```

Verify the RP ID equals the generated Cognito managed-login domain, **not** the portal hostname:

```bash
export EDUTEX_COGNITO_DOMAIN="$(jq -r '.UserPool.Domain + ".auth.'"$EDUTEX_AWS_REGION"'.amazoncognito.com"' \
  "$EDUTEX_EVIDENCE_DIR/user-pool.json")"
jq -e --arg domain "$EDUTEX_COGNITO_DOMAIN" \
  '.WebAuthnConfiguration.RelyingPartyId == $domain' \
  "$EDUTEX_EVIDENCE_DIR/user-pool-mfa.json" >/dev/null
```

Finally locate and verify the invited user:

```bash
aws cognito-idp list-users \
  --user-pool-id "$EDUTEX_USER_POOL_ID" \
  --filter "email = \"${EDUTEX_ADMIN_EMAIL}\"" \
  > "$EDUTEX_EVIDENCE_DIR/initial-admin-user.json"
jq -e '(.Users | length) == 1' "$EDUTEX_EVIDENCE_DIR/initial-admin-user.json" >/dev/null
jq -e '.Users[0].UserStatus == "FORCE_CHANGE_PASSWORD"' \
  "$EDUTEX_EVIDENCE_DIR/initial-admin-user.json" >/dev/null
jq -e '[.Users[0].Attributes[] | select(.Name=="email_verified" and .Value=="true")] |
       length == 1' "$EDUTEX_EVIDENCE_DIR/initial-admin-user.json" >/dev/null
```

If `email_verified` is absent/false, the package is not RC5 or bootstrap was changed. Stop; do not
weaken the callback identity check. If the invitation did not arrive, inspect SES delivery/bounce
events and address correctness without creating another admin or exposing the temporary password.

# Phase 14 - initial administrator, TOTP and passkey

## First sign-in

The initial administrator performs these steps on a managed, single-user device and supported
browser. The deployment operator does not ask for or view the temporary or long-term password.

1. Open `https://portal.school.example/auth/` using the exact production hostname.
2. Confirm the certificate, school branding and hostname; do not follow a Cognito URL from email
   without first verifying the portal.
3. Choose the local password/passkey option.
4. Enter the administrator email and the temporary password delivered by Cognito.
5. Create a unique long-term password in the organisation-approved password manager. The pool
   requires at least 15 characters and remembers 24 prior passwords; use a substantially longer
   generated value.
6. Complete Cognito's mandatory software-token MFA setup: scan the QR code with the approved
   authenticator, enter the current six-digit TOTP and store recovery/escalation information under
   policy.
7. Complete the redirect to `/app`. Confirm the visible user name/category is the named initial
   administrator and the session expires according to policy.

Expected: the managed-login flow changes status from `FORCE_CHANGE_PASSWORD`, registers TOTP and the
BFF issues one opaque device session. If the callback says the identity is incomplete, stop and
check RC5 `email_verified` rather than bypassing verification.

## Register a user-verified passkey

Amazon Cognito does not automatically prompt administrator-created users to register a passkey.
After the successful first session:

1. Open the account menu in the Edutex portal.
2. Choose **Register a passkey**.
3. Confirm the browser navigates to the same pool's Cognito managed-login `/passkeys/add` page.
4. Use an organisation-approved platform authenticator or hardware security key with user
   verification. Do not enrol a passkey on a shared kiosk or unmanaged family device.
5. Name/store the passkey according to school policy and complete the redirect back to Edutex.
6. Sign out of this device.
7. Start a new sign-in, choose the passkey path, complete user verification and confirm access.
8. Test a cancelled assertion and an unknown user; both must fail without user enumeration.

The portal starts registration with POST + CSRF and a fresh state, nonce, PKCE verifier and browser
binding. The callback consumes the transaction once and replaces the current device session. The RP
ID must be `$EDUTEX_COGNITO_DOMAIN`; changing it later invalidates enrolled credentials.

## Verify both factors

Use Cognito/CloudTrail administrative metadata, not screenshots of QR codes or credential material:

```bash
export EDUTEX_COGNITO_USERNAME="$(jq -r '.Users[0].Username' \
  "$EDUTEX_EVIDENCE_DIR/initial-admin-user.json")"
aws cognito-idp admin-get-user \
  --user-pool-id "$EDUTEX_USER_POOL_ID" \
  --username "$EDUTEX_COGNITO_USERNAME" \
  --query '{Status:UserStatus,MFA:UserMFASettingList,Preferred:PreferredMfaSetting}' \
  > "$EDUTEX_EVIDENCE_DIR/initial-admin-mfa.json"
```

Expected status `CONFIRMED` and software-token MFA metadata. Passkey credential listing is a
token-authorised user action; validate it through successful synthetic user registration/sign-in or
the managed user session, not by collecting the user's access token in an operator shell.

## Create two break-glass administrators

Before go-live, create two named, monitored emergency administrators using the approved account
provisioning procedure. Do not share an identity. Each must:

- use a unique mailbox/account and hardware-backed passkey plus approved recovery factor;
- receive only the minimum emergency role;
- be stored/escrowed under dual control;
- alert on every use and be tested at the approved cadence;
- have a documented disable/rotation process;
- not be used for normal administration.

The initial bootstrap user must not remain the sole administrator.

# Phase 15 - configure school authentication policy and home modules

## Authentication policy

In **Admin > Authentication**, review the optimistic-lock version and set:

| Setting           | Recommended production value                | Constraint                                                   |
| ----------------- | ------------------------------------------- | ------------------------------------------------------------ |
| Password          | Enabled only if client needs local accounts | When enabled, TOTP mode must be `required_for_password`      |
| Passkey           | Enabled                                     | Requires RC5 `ALLOW_USER_AUTH` and managed-login RP ID       |
| TOTP              | Required for password                       | Do not weaken to optional while password is enabled          |
| Microsoft         | Disabled until configured/tested            | Global switch and provider row must both permit it           |
| Google            | Disabled until configured/tested            | Same                                                         |
| SAML              | Disabled until configured/tested            | Same                                                         |
| Session idle      | 20 minutes default                          | Allowed 5-240; justify higher values                         |
| Session absolute  | 12 hours default                            | Allowed 1-72; not extended by activity beyond absolute limit |
| Step-up freshness | 10 minutes default                          | Allowed 1-60; keep short for restricted fields/actions       |

Save once, refresh and prove the returned row version changed. A 409 conflict means another admin
changed the row; reload and reconcile instead of blindly resubmitting.

## Home-screen modules

Review all 21 modules with the client. `dashboard` and `admin` remain enabled as platform-required
modules. Hiding a module changes navigation/home visibility, not the underlying role permission;
permissions remain the authoritative authorisation gate. Test mobile tabs, desktop navigation and
search after each change. Record module/role approval in the client configuration baseline.

# Phase 16 - Microsoft Entra ID (Azure AD) federation

## Design before configuration

Use one client-owned Entra enterprise application per Edutex production school. Prefer Entra **app
roles** with stable values over display-name groups. Define non-overlapping values such as:

| Entra app-role value    | Edutex category | Typical Edutex role |
| ----------------------- | --------------- | ------------------- |
| `Edutex.Student`        | student         | Student             |
| `Edutex.Teacher`        | teacher         | Teacher             |
| `Edutex.CorporateStaff` | corporate_staff | Corporate staff     |
| `Edutex.ITStaff`        | it_staff        | IT administrator    |
| `Edutex.Executive`      | executive_staff | Executive           |

Assign roles to controlled groups/users in Entra and require the client to own joiner/mover/leaver
governance. Avoid broad defaults. Microsoft group overage, nested/dynamic membership and conflicting
role assignments must be tested in the exact tenant.

## Register the Entra application

In Microsoft Entra admin centre:

1. Open **Identity > Applications > App registrations > New registration**.
2. Name it `Edutex Production - <School>`.
3. Select **Accounts in this organisational directory only** unless a documented multi-tenant
   requirement exists.
4. Under **Authentication > Web**, add the Cognito OIDC provider callback:

   ```text
   https://<cognito-managed-login-domain>/oauth2/idpresponse
   ```

   This is **not** the Edutex `/api/v1/auth/callback`; Cognito is the Entra relying party, and
   Edutex is the Cognito relying party.

5. Do not enable implicit grant. Edutex/Cognito use authorization code.
6. Create the five app roles with the exact stable values above and assign allowed users/groups.
7. Under **Token configuration**, include the required email/name claims. Ensure the chosen source
   yields a unique, current mail address for every allowed user.
8. Under **API permissions**, use only OIDC sign-in/profile permissions required for
   `openid email profile`; grant tenant admin consent through the client process.
9. Under **Certificates & secrets**, prefer a managed certificate/secret rotation process. If a
   client secret is used, set the shortest practical lifetime and record owner/expiry alerts.
10. Record directory tenant ID, application/client ID and secret once. Never put the secret in this
    guide, a screenshot or change ticket.

Issuer URL:

```text
https://login.microsoftonline.com/<tenant-id>/v2.0
```

## Configure in Edutex

In **Admin > Connected identity providers > Add provider** enter:

| Field           | Exact value pattern                      |
| --------------- | ---------------------------------------- |
| Provider type   | Microsoft Entra ID                       |
| Provider key    | `microsoft`                              |
| Display name    | Client-approved name                     |
| Button label    | `Continue with Microsoft`                |
| OIDC issuer URL | Tenant-specific v2.0 issuer above        |
| Client ID       | Entra application ID                     |
| Client secret   | Newly issued value; sent once to the API |
| Scopes          | `openid email profile`                   |

Selecting **Add provider** always creates or updates the provider in the disabled state. The form
does not publish it and there is deliberately no **Enabled** field. Confirm the provider row says
**Disabled** before continuing. If it does not, stop, disable the provider and investigate the
release/configuration mismatch before testing.

Recommended attribute mapping (destination Cognito attribute on the left, Entra claim on the right):

```json
{
  "email": "email",
  "name": "name",
  "preferred_username": "preferred_username",
  "custom:directory_role": "roles",
  "custom:authentication_assurance": "amr"
}
```

Cognito flattens multi-value attributes into a bracketed, comma-delimited, URL-encoded string. RC5
decodes custom multi-value attributes before exact matching. Keep total mapped values below the
Cognito custom-attribute limits and prove actual synthetic claims. Do not treat a provider display
name or requested login button as assurance; only signed token claims are used.

## Add Edutex role mappings

For each app role, add a mapping:

```text
Claim name:  custom:directory_role
Claim value: Edutex.Student     -> Student role, category student
Claim value: Edutex.Teacher     -> Teacher role, category teacher
Claim value: Edutex.CorporateStaff -> Corporate role, category corporate_staff
Claim value: Edutex.ITStaff     -> IT role, category it_staff
Claim value: Edutex.Executive   -> Executive role, category executive_staff
```

Use explicit priorities. A user can receive multiple matched roles; category uses the first matching
mapping by priority. Therefore, define and test a deterministic precedence, for example IT/Executive
before general corporate, and reject ambiguous business design.

## Test and enable

The **Enable** button remains blocked until the provider has at least one exact role mapping. During
the approved test window, confirm the mappings, select **Enable** on the provider row, then turn on
the Microsoft policy switch. These are separate publication decisions. Record the administrator, UTC
time, provider row version, approved mapping set and change reference, then test:

- one synthetic user for each role/category;
- an assigned user with no role value: must not receive privileged access;
- an unassigned user: Entra/Cognito must deny;
- a user with two app roles: permissions and category must match the approved precedence;
- disabled/removed user and group membership removal;
- required Entra MFA/Conditional Access and `amr` assurance behaviour;
- logout, step-up, idle/absolute expiry and device-isolated sessions;
- secret rotation with old secret invalidated after validation;
- group/app-role overage and maximum claim size.

If any negative test creates a privileged identity, turn off the Microsoft policy switch, select
**Disable** on the provider row, revoke sessions, preserve logs and treat it as a release blocker.

# Phase 17 - Google Workspace federation

## Choose the correct model

Google OIDC is suitable for authentication and verified email/profile claims. Standard Google OIDC
does not supply Workspace group membership as a general role claim. If school roles depend on
Workspace groups, use a client-managed SAML custom application that explicitly releases a bounded
role/group attribute, or another approved identity transformation; do not pretend the default OIDC
profile contains groups.

## Create the Google OAuth client

In the client Google Cloud project:

1. Configure the OAuth consent screen as **Internal** for one Workspace organisation where
   applicable.
2. Limit scopes to `openid`, `email`, `profile`.
3. Create an **OAuth 2.0 Client ID > Web application**.
4. Add this authorised redirect URI:

   ```text
   https://<cognito-managed-login-domain>/oauth2/idpresponse
   ```

5. Record/secure the client ID and secret and configure rotation/owner alerts.
6. Restrict the application to the intended organisation and test external/consumer accounts are
   denied where required.

## Configure in Edutex

| Field             | Value                    |
| ----------------- | ------------------------ |
| Provider type     | Google Workspace         |
| Provider key      | `google`                 |
| Display/button    | Client-approved          |
| Client ID/secret  | Google web client values |
| Scopes            | `openid email profile`   |
| Attribute mapping | below                    |

```json
{
  "email": "email",
  "email_verified": "email_verified",
  "name": "name",
  "preferred_username": "email"
}
```

With standard OIDC, pre-provision the user/role through an approved workflow or use a controlled
claim source; do not add a mapping based only on the email domain unless the security owner has
designed and tested that rule. Validate `hd` as a defence-in-depth tenant hint only, not as the sole
authorisation decision.

Test verified/unverified email behaviour, wrong Workspace domain, suspended user, revoked consent,
MFA context, logout, session expiry and absence of a directory-role mapping. Enable Google only
after all applicable tests pass.

# Phase 18 - generic OIDC federation

## Provider contract

Obtain the issuer's discovery document, signing algorithms/JWKS behaviour, client authentication
method, subject stability, email verification semantics, MFA/assurance claims, role claim format,
logout behaviour, key rotation SLA and incident contact. Issuer and metadata endpoints must be
public HTTPS; the API rejects loopback, link-local, RFC1918/ULA and local-use hosts, but security
review must also assess DNS rebinding and provider trust.

Register this callback at the provider:

```text
https://<cognito-managed-login-domain>/oauth2/idpresponse
```

In Edutex choose **OpenID Connect**, a unique lower-case provider key, exact issuer URL, client
credentials and minimal scopes. Map at least `email`, `name` and a stable role attribute; map
verified email and assurance where the provider supports them. Create exact claim-to-role mappings
and test unknown issuer, bad audience, expired token, rotated signing key, absent email, excessive
claim, unmapped role, MFA/no-MFA and disabled user. Enable only after the trust contract and
evidence are approved. Generic OIDC has no Microsoft/Google/SAML family policy switch: confirm the
row is **Disabled** after configuration, and treat its separate **Enable** action as the final
publication control.

# Phase 19 - SAML 2.0 federation

## Configure the school IdP

Cognito is the SAML service provider. Use:

```text
ACS URL: https://<cognito-managed-login-domain>/saml2/idpresponse
SLO URL: https://<cognito-managed-login-domain>/saml2/logout
```

Obtain a public HTTPS metadata URL with signing certificate chain, entity ID and endpoints. Prefer
signed assertions **and** responses, SHA-256 signatures, short assertion validity, audience and
recipient restriction, replay protection, encrypted assertions where supported/required and
documented certificate rotation. The current API configures metadata URL and IdP sign-out; verify
the actual Cognito provider settings after creation and treat any missing required
signing/encryption property as a source change/release gate, not a manual undocumented toggle.

Release bounded attributes for:

- persistent, non-reassigned subject/NameID;
- current unique email address;
- display name;
- one or more stable Edutex role values;
- user category if independently controlled;
- authentication assurance/MFA context where trustworthy.

## Configure in Edutex

Choose **SAML 2.0**, set the metadata URL and enter a mapping such as:

```json
{
  "email": "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress",
  "name": "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name",
  "custom:directory_role": "https://school.example/claims/edutex-role",
  "custom:authentication_assurance": "https://school.example/claims/authn-assurance"
}
```

Use the exact attribute names from a reviewed synthetic assertion. Do not paste production
assertions containing PII into tickets. Add exact role mappings, enable in a controlled window and
test signed/unsigned response, wrong audience, expired/not-yet-valid assertion, replay, changed
certificate, missing attribute, multiple roles, IdP/SP logout and disabled account.

# Phase 20 - identity acceptance matrix

For every enabled provider retain a completed matrix:

| Test                        | Expected                                                                           |
| --------------------------- | ---------------------------------------------------------------------------------- |
| Correct assigned user       | Authenticates and receives only mapped roles/category                              |
| Correct unprivileged user   | Authenticates only if policy allows, with no privileged role                       |
| Unassigned/wrong tenant     | Denied                                                                             |
| Disabled/suspended user     | Denied; active Edutex session revoked within control target                        |
| Missing email/subject       | Denied                                                                             |
| Unknown role value          | No role granted                                                                    |
| Conflicting roles           | Approved deterministic permissions/category                                        |
| Claim overage/too long      | Fails closed and alerts; no truncation-based privilege                             |
| No MFA                      | Restricted operations fail unless provider contract explicitly satisfies assurance |
| MFA/passkey                 | `mfaSatisfiedAt` and step-up behaviour correct                                     |
| Logout                      | This device session revoked and provider logout behaviour understood               |
| Second browser/device       | Independent cookie/session; no state sharing                                       |
| Secret/certificate rotation | New credential works, old is revoked, no outage                                    |
| JIT first sign-in           | User/category/role/campus process is correct and auditable                         |
| Mover/leaver                | Role removal/disablement refreshes active sessions within target                   |

Role mappings are evaluated and directory-managed grants reconciled on every federated sign-in;
active sessions periodically refresh the resulting Edutex status/roles. A directory change is not a
push revocation: the leaver process must disable the Edutex identity/revoke sessions, and explicitly
human-assigned roles remain until their access-review owner removes them.

# Phase 21 - prototype data migration

## Hard boundary of the supplied importer

The prototype export is never copied wholesale into JSONB and never moved through the browser. RC5
automates only these four core collections:

| Source collection | Relational destination                         | Automated fields                                  |
| ----------------- | ---------------------------------------------- | ------------------------------------------------- |
| `edutex_students` | `app.students`, `migration.legacy_identifiers` | core identity/demographic fields                  |
| `edutex_families` | `app.families`                                 | core family contact fields                        |
| `edutex_staff`    | `app.staff`                                    | core employment/contact fields                    |
| `edutex_classes`  | `app.classes`                                  | core class fields using the bootstrap campus/year |

All other collections require an approved typed mapping and tested extension before apply. Unknown
fields must not be silently dropped or placed into a generic JSON blob. Passwords, Supabase keys,
sessions, local/browser storage, executable HTML/scripts and the prototype audit stream are never
imported into the production trust boundary.

## Freeze and export

1. Approve a cutover/change ticket and notify users.
2. Stop prototype writes and prove the freeze time in UTC.
3. Export through the approved Supabase administrative/offline process using a dedicated temporary
   export identity; do not use a public `anon` key or browser console.
4. Produce one UTF-8 JSON object whose keys are collection names and whose values are row arrays.
5. Each row must contain a stable string `id`, an object `data`, and may contain integer `position`,
   string `updated_at` and string `updated_by`.
6. Store the original in the approved encrypted evidence/records repository under legal retention.
7. Work from a controlled copy, scan it and calculate its SHA-256.

Example shape with synthetic data only:

```json
{
  "edutex_students": [
    {
      "id": "legacy-student-1",
      "position": 1,
      "data": {
        "studentNumber": "S0001",
        "firstName": "Synthetic",
        "lastName": "Student",
        "yearLevel": "7",
        "status": "current"
      }
    }
  ],
  "edutex_families": [],
  "edutex_staff": [],
  "edutex_classes": []
}
```

## Inventory and mapping approval

Before running the importer, produce per-collection and per-field inventories: row count, distinct
IDs/natural keys, null/blank counts, type distributions, enum values, date/time zones, maximum
lengths, orphan relationships, duplicates and invalid encodings. Compare every collection against
the complete migration matrix in the companion handbook.

For each field record:

- source collection/path and business meaning;
- target table/column/key relationship;
- type/unit/time-zone transformation;
- allowed enum mapping and rejection rule;
- default rule, legal basis and data owner;
- sensitivity, encryption and retention requirements;
- reconciliation query/tolerance and approver;
- treatment for invalid/duplicate/orphaned rows.

Any source field without a signed decision is a migration stop. Financial, attendance, safeguarding,
medical, consent and legal-hold data require their specialist owner; the core importer does not
cover them.

## Extract the bootstrap IDs

Use the restricted bootstrap log line:

```bash
export EDUTEX_TENANT_ID="$(sed -nE \
  's/.*Tenant ([0-9a-f-]{36}); campus ([0-9a-f-]{36}); academic year ([0-9a-f-]{36});.*/\1/p' \
  "$EDUTEX_EVIDENCE_DIR/bootstrap-logs-restricted.txt" | tail -1)"
export EDUTEX_CAMPUS_ID="$(sed -nE \
  's/.*Tenant ([0-9a-f-]{36}); campus ([0-9a-f-]{36}); academic year ([0-9a-f-]{36});.*/\2/p' \
  "$EDUTEX_EVIDENCE_DIR/bootstrap-logs-restricted.txt" | tail -1)"
export EDUTEX_ACADEMIC_YEAR_ID="$(sed -nE \
  's/.*Tenant ([0-9a-f-]{36}); campus ([0-9a-f-]{36}); academic year ([0-9a-f-]{36});.*/\3/p' \
  "$EDUTEX_EVIDENCE_DIR/bootstrap-logs-restricted.txt" | tail -1)"

for value in "$EDUTEX_TENANT_ID" "$EDUTEX_CAMPUS_ID" "$EDUTEX_ACADEMIC_YEAR_ID"; do
  printf '%s' "$value" | grep -Eq '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
done
```

Stop if any identifier is missing or ambiguous. Do not guess a UUID from logs or another school.

## Upload an encrypted short-lived staging copy

```bash
export EDUTEX_LEGACY_FILE='/approved/export/edutex-legacy-snapshot.json'
test -f "$EDUTEX_LEGACY_FILE"
jq -e 'type == "object" and all(.[]; type == "array")' "$EDUTEX_LEGACY_FILE" >/dev/null
sha256sum "$EDUTEX_LEGACY_FILE" > "$EDUTEX_EVIDENCE_DIR/legacy-snapshot.sha256"

export EDUTEX_LEGACY_KEY="migration-input/${EDUTEX_SCHOOL_SLUG}/legacy-snapshot.json"
aws s3 cp "$EDUTEX_LEGACY_FILE" "s3://${EDUTEX_FILES_BUCKET}/${EDUTEX_LEGACY_KEY}" \
  --only-show-errors
aws s3api head-object --bucket "$EDUTEX_FILES_BUCKET" --key "$EDUTEX_LEGACY_KEY" \
  --query '{Length:ContentLength,Encryption:ServerSideEncryption,KMS:SSEKMSKeyId,Version:VersionId}' \
  > "$EDUTEX_EVIDENCE_DIR/legacy-staging-object.json"
jq -e '.Encryption == "aws:kms" and (.KMS | length > 0)' \
  "$EDUTEX_EVIDENCE_DIR/legacy-staging-object.json" >/dev/null
```

Expected: KMS encryption and a version ID. The bucket lifecycle expires current and noncurrent
`migration-input/` objects after eight days; delete the staging versions sooner after signed
reconciliation. The original controlled export follows the approved retention decision.

## Run plan mode inside the private task

Create the command override:

```bash
export EDUTEX_LEGACY_URI="s3://${EDUTEX_FILES_BUCKET}/${EDUTEX_LEGACY_KEY}"
export EDUTEX_LEGACY_PLAN_OVERRIDE="$(jq -cn --arg uri "$EDUTEX_LEGACY_URI" \
  '{containerOverrides:[{name:"legacy-migration",command:[
    "node","scripts/dist/migrate-legacy.js","--plan",$uri
  ]}]}')"

aws ecs run-task \
  --cluster "$EDUTEX_CLUSTER" \
  --task-definition "$EDUTEX_LEGACY_TASK" \
  --launch-type FARGATE \
  --network-configuration "$EDUTEX_NETWORK_JSON" \
  --overrides "$EDUTEX_LEGACY_PLAN_OVERRIDE" \
  --started-by "edutex-legacy-plan-${EDUTEX_SCHOOL_SLUG}" \
  > "$EDUTEX_EVIDENCE_DIR/legacy-plan-run.json"
jq -e '(.failures | length)==0 and (.tasks | length)==1' \
  "$EDUTEX_EVIDENCE_DIR/legacy-plan-run.json" >/dev/null
export EDUTEX_LEGACY_PLAN_TASK_ARN="$(jq -r '.tasks[0].taskArn' \
  "$EDUTEX_EVIDENCE_DIR/legacy-plan-run.json")"
aws ecs wait tasks-stopped --cluster "$EDUTEX_CLUSTER" --tasks "$EDUTEX_LEGACY_PLAN_TASK_ARN"
aws ecs describe-tasks --cluster "$EDUTEX_CLUSTER" --tasks "$EDUTEX_LEGACY_PLAN_TASK_ARN" \
  > "$EDUTEX_EVIDENCE_DIR/legacy-plan-result.json"
test "$(jq -r '.tasks[0].containers[] | select(.name=="legacy-migration") | .exitCode' \
  "$EDUTEX_EVIDENCE_DIR/legacy-plan-result.json")" = '0'
aws logs tail /edutex/production/application --since 30m \
  --log-stream-name-prefix legacy-migration --format short \
  > "$EDUTEX_EVIDENCE_DIR/legacy-plan-logs-restricted.txt"
```

Expected: the task prints the same SHA-256 as the local hash, exact collection counts and
`Plan only: no database rows were changed`. Reconcile every collection name and count. Unknown
collections are not an error by themselves, but they are an apply blocker until mapped, explicitly
excluded with data-owner approval, or removed from the cutover scope under a lawful decision.

## Rehearse in an isolated production-like environment

Before production apply, run the exact snapshot through the exact image and migration task in an
isolated restored/staging database with synthetic identities. Measure duration, CPU/memory, locks,
WAL/storage, errors and roll-forward/restore time. Run relationship, uniqueness, row-level security,
cross-tenant and business-total reconciliation. Amend transformations as a new reviewed source
change and repeat plan/rehearsal; never patch the production snapshot ad hoc.

## Apply in one private transaction

After signed mapping/rehearsal approval:

```bash
export EDUTEX_LEGACY_APPLY_OVERRIDE="$(jq -cn \
  --arg uri "$EDUTEX_LEGACY_URI" \
  --arg tenant "$EDUTEX_TENANT_ID" \
  --arg campus "$EDUTEX_CAMPUS_ID" \
  --arg year "$EDUTEX_ACADEMIC_YEAR_ID" \
  '{containerOverrides:[{name:"legacy-migration",command:[
    "node","scripts/dist/migrate-legacy.js","--apply",$uri,
    "--tenant-id",$tenant,"--campus-id",$campus,"--academic-year-id",$year
  ]}]}')"

aws ecs run-task \
  --cluster "$EDUTEX_CLUSTER" \
  --task-definition "$EDUTEX_LEGACY_TASK" \
  --launch-type FARGATE \
  --network-configuration "$EDUTEX_NETWORK_JSON" \
  --overrides "$EDUTEX_LEGACY_APPLY_OVERRIDE" \
  --started-by "edutex-legacy-apply-${EDUTEX_SCHOOL_SLUG}" \
  > "$EDUTEX_EVIDENCE_DIR/legacy-apply-run.json"
jq -e '(.failures | length)==0 and (.tasks | length)==1' \
  "$EDUTEX_EVIDENCE_DIR/legacy-apply-run.json" >/dev/null
export EDUTEX_LEGACY_APPLY_TASK_ARN="$(jq -r '.tasks[0].taskArn' \
  "$EDUTEX_EVIDENCE_DIR/legacy-apply-run.json")"
aws ecs wait tasks-stopped --cluster "$EDUTEX_CLUSTER" --tasks "$EDUTEX_LEGACY_APPLY_TASK_ARN"
aws ecs describe-tasks --cluster "$EDUTEX_CLUSTER" --tasks "$EDUTEX_LEGACY_APPLY_TASK_ARN" \
  > "$EDUTEX_EVIDENCE_DIR/legacy-apply-result.json"
test "$(jq -r '.tasks[0].containers[] | select(.name=="legacy-migration") | .exitCode' \
  "$EDUTEX_EVIDENCE_DIR/legacy-apply-result.json")" = '0'
aws logs tail /edutex/production/application --since 60m \
  --log-stream-name-prefix legacy-migration --format short \
  > "$EDUTEX_EVIDENCE_DIR/legacy-apply-logs-restricted.txt"
grep -F 'Migration committed:' "$EDUTEX_EVIDENCE_DIR/legacy-apply-logs-restricted.txt"
```

Any validation, SQL, FK, enum, date, uniqueness, TLS, permission, resource or exit-code error rolls
back the import transaction and stops cutover. Do not re-run until the cause and potential partial
effects are proven. Stable legacy-ID registry entries make the student import deterministic; natural
key upserts apply to the other automated entities, but signed reconciliation is still mandatory.

## Reconcile and sign off

At minimum compare:

- source rows, processed rows and database rows for each automated entity;
- every legacy ID to one production ID;
- distinct student/family/staff/class numbers and duplicate treatment;
- null/default/rejection counts and all status/year/date transformations;
- campus/year FKs and cross-tenant composite-FK rejection;
- representative records chosen by the data owner, including boundaries and non-ASCII names;
- unsupported relationships and fields against the signed migration matrix;
- financial balances, attendance totals, consent/safeguarding records and file hashes when their
  separately implemented migrations are later added;
- application/API read paths and role/campus visibility;
- audit event containing snapshot counts and cutover request identity.

Use independent queries/reports, not only importer output. Data Owner and Release Manager sign the
count/tolerance/exception report. No real users are invited until reconciliation passes.

## Dispose of the staging copy

After sign-off and legal/security approval, delete all current/noncurrent staging-object versions or
allow the enforced eight-day lifecycle. Confirm no replication/export copied it to an unapproved
location. Preserve only the approved original, its hash, mapping, reconciliation and audit evidence
for the authorised retention period. Revoke the temporary Supabase export identity and securely
retire its credentials.

# Phase 22 - public edge, TLS and application smoke tests

## DNS and certificate

```bash
dig +short CNAME "$EDUTEX_HOSTNAME"
curl --fail --silent --show-error --head "https://${EDUTEX_HOSTNAME}/auth/" \
  > "$EDUTEX_EVIDENCE_DIR/auth-headers.txt"
openssl s_client -connect "${EDUTEX_HOSTNAME}:443" -servername "$EDUTEX_HOSTNAME" \
  -tls1_2 </dev/null 2>/dev/null \
  | openssl x509 -noout -subject -issuer -dates \
  > "$EDUTEX_EVIDENCE_DIR/tls-certificate.txt"
```

Verify certificate hostname/chain/dates, TLS 1.2 and 1.3, HTTP-to-HTTPS redirect, no mixed content
and no direct AWS hostname. Test an obsolete TLS protocol from an approved scanner and require
failure.

## Security headers and cache

Inspect browser network responses and headers for `/auth/`, `/app`, API JSON and errors. Require:

- strict CSP with no unapproved third-party scripts, `unsafe-eval` or broad origins;
- HSTS only after its deployment decision, `X-Content-Type-Options: nosniff`, safe referrer and
  permissions policies;
- protected portal/assets unavailable before authentication;
- `Cache-Control: no-store` for authenticated HTML/API and identity callbacks;
- no Cognito tokens, session IDs, CSRF values, PII or stack traces in URLs/cache/logs;
- Cloudflare does not cache authenticated/private responses;
- public tenant branding cache is bounded as designed and contains no private configuration.

The user can always inspect HTML/JavaScript that their browser receives. Security comes from not
sending authenticated bundles/data until a valid session and from server/database controls, not from
claiming frontend code is hidden or relying on obscurity.

## Safe WAF checks

From authorised test sources and within the rules of engagement:

```bash
curl --silent --output /dev/null --write-out '%{http_code}\n' \
  "https://${EDUTEX_HOSTNAME}/.env"
curl --silent --output /dev/null --write-out '%{http_code}\n' \
  -X TRACE "https://${EDUTEX_HOSTNAME}/auth/"
curl --silent --output /dev/null --write-out '%{http_code}\n' \
  "https://${EDUTEX_HOSTNAME}/health/live"
curl --fail --silent "https://${EDUTEX_HOSTNAME}/api/v1/public/tenant" \
  | jq -e '.tenantId and .enabledMethods' >/dev/null
```

Expected: scanner path, TRACE and public health are blocked; the public tenant endpoint succeeds
only from an allowed source. Exact block status can vary with Cloudflare action, but it must not
reach the origin. Correlate each request in Cloudflare security events.

Test whole-site country/IP rules from one allowed and one disallowed network, including IPv6. Test
admin paths separately from an allowed and disallowed admin CIDR. Identity is still required from an
allowed network. Do rate-limit threshold testing in a dedicated test window/environment so it does
not lock out real users; verify edge events and automatic recovery after mitigation timeout.

# Phase 23 - session, authorisation and tenant isolation tests

## Device-session matrix

Use two synthetic users, two browsers and two devices:

1. Sign in user A on browser/device 1 and user B on browser/device 2.
2. Confirm opaque `__Host-edutex_sid` and `__Host-edutex_device` cookies are Secure, HttpOnly,
   SameSite=Lax, Path=/ and have no Domain attribute.
3. Confirm cookies differ across clients and no token is in local/session storage, IndexedDB, URL or
   source.
4. Sign out device 1; device 2 remains valid.
5. Copy only a session cookie without the device cookie, then with a mismatched user-agent in a
   controlled test: both fail and revoke the invalid session.
6. Test idle expiry, absolute expiry, password/role/status change refresh and disabled account.
7. Test CSRF with missing/wrong token, cross-site form/fetch and disallowed Origin/Fetch Metadata.
8. Test session fixation by pre-setting cookies before login; callback must replace any prior
   session.
9. Test code/state/nonce/PKCE/browser-binding replay; each transaction is single-use and expires in
   five minutes.
10. Test recent-MFA expiry and step-up redirect for restricted student fields.

Record only result/request IDs and redacted metadata. Never retain cookie/token values.

## Two-tenant isolation

The supported deployment is one school per stack, but database tenant controls still require a
two-tenant test in an isolated production-like environment. Create synthetic tenants A/B through an
approved test-only provisioning path and exercise every module/API with:

- B's valid record IDs in A's read/update/delete/list/filter/sort/upload/download requests;
- relationships linking an A row to a B parent/child/campus/user;
- body/query/header/hostname tenant substitution;
- guessed/sequential/random UUIDs and IDs obtained legitimately from the other tenant;
- bulk actions, exports, attendance roll saves, encrypted-field endpoints and admin mappings;
- direct migration-role negative tests proving `edutex_app` RLS/permissions cannot bypass.

Expected: 403/404 or safe validation, no timing/body distinction that reveals protected records, no
cross-tenant FK, and correlated denial/audit evidence. Any cross-tenant read, link, mutation or
metadata leak is a critical release stop.

# Phase 24 - file and client-side field-encryption tests

## File path

Test only supported images. Require MIME/decoded-image agreement, pixel/size limits, re-encoding,
metadata stripping, private KMS S3 storage, opaque object keys, authenticated authorisation and no
public bucket URL. Test malformed headers, polyglots, decompression/pixel bombs, truncated images,
duplicate filenames, cross-tenant file IDs and interrupted multipart uploads. Non-image upload is a
feature gate until quarantine, malware scanning and clean-object promotion exist.

## Restricted student fields

For each sensitive field:

- recent passkey/TOTP assurance is required before key release;
- API wraps the tenant data key over ephemeral P-256 ECDH to a non-extractable browser key;
- AES-256-GCM uses a unique IV and tenant/record/field/version-bound AAD;
- ciphertext/tag tampering, wrong record/tenant/key/version and stale assurance fail;
- plaintext is absent from request logs, PostgreSQL columns, audit data, browser storage, crash
  reports and screenshots;
- decrypted values are cleared on logout/session expiry/navigation as designed;
- CSP/XSS tests prove no third-party script surface; nevertheless, an authorised XSS can read
  plaintext in the active page, so XSS remains a critical control.

Do not market browser encryption as protection against a fully compromised endpoint or authorised
malicious script. It is an additional boundary for selected database-stored fields.

# Phase 25 - monitoring, audit and alerting

## Required telemetry sources

Forward to the approved central security account/SIEM with UTC synchronisation and access control:

| Source                 | Minimum monitored events                                                                                       |
| ---------------------- | -------------------------------------------------------------------------------------------------------------- |
| Cloudflare             | WAF/rate/IP/country blocks, tunnel connector changes, DNS/ruleset/admin changes, unusual countries/automation  |
| Cognito                | failed/risky login, MFA/passkey changes, user/provider/client/pool policy changes, account disablement         |
| CloudTrail             | IAM/KMS/Secrets Manager/ECS/RDS/S3/DynamoDB/Backup/CloudFormation/SES and console administrative activity      |
| Application            | authentication/authorisation denials, validation failures, step-up, admin changes, request IDs, service errors |
| PostgreSQL             | pgAudit DDL/role/write, connections, lock waits, slow statements, error rates and audit-chain verification     |
| VPC Flow Logs          | rejected/abnormal egress, database path anomalies, unexpected destinations                                     |
| ECS/Container Insights | task restarts, unhealthy tasks, CPU/memory/storage, desired/running mismatch and deployment rollback           |
| RDS/Proxy              | capacity, connections, failover, replication lag, auth/TLS errors, storage/ACU and proxy saturation            |
| DynamoDB               | throttle/system errors, PITR changes, session/auth transaction anomalies                                       |
| S3/KMS                 | public-policy attempts, denied decrypt, unusual Get/Put/Delete, key disable/deletion schedule                  |
| Backup                 | job failure/expiry, Vault Lock change window, restore test failure                                             |
| SES                    | delivery, bounce, complaint, reputation and configuration change                                               |

Do not log request bodies, credentials, cookies, OAuth codes/tokens, TOTP seeds/codes, passkey
attestations, decrypted fields, raw identity assertions, database secrets or full student records.

## Minimum alert tests

Generate one authorised synthetic event for each route and prove receipt/acknowledgement:

- Cloudflare WAF scanner-path block;
- repeated failed login/rate-limit event;
- protected admin-path access from a disallowed network;
- ECS task stopped/unhealthy;
- application 5xx threshold;
- RDS failover/connection saturation simulation or test alarm;
- KMS/Secrets Manager access denial;
- CloudFormation/IAM/security-group change;
- backup job failure test notification;
- SES bounce/complaint simulator where appropriate;
- audit-chain verification failure in isolated test data.

Record event/request ID, UTC send/receive/acknowledge times, routing destination, responder and
corrective action. An untested alert is not an effective ISO/OWASP control.

## Audit-chain validation

Run the repository's approved audit verification procedure against synthetic tenant events through a
private controlled task/query. Confirm sequence continuity and prior-hash/event-hash linkage from
first to last event. Restrict database audit reads to authorised roles. A chain proves detected
tampering/continuity within its design; it does not prove every security event was generated, so
compare coverage against API/CloudTrail/Cloudflare logs.

# Phase 26 - backup, restore and continuity proof

## Confirm configured protection

Verify without modifying production:

```bash
aws backup list-backup-vaults > "$EDUTEX_EVIDENCE_DIR/backup-vaults.json"
aws backup get-backup-vault-access-policy --backup-vault-name edutex-production \
  > "$EDUTEX_EVIDENCE_DIR/backup-vault-policy.json" 2>/dev/null || true
readonly EDUTEX_RDS_RECOVERY_QUERY='DBClusters[?DatabaseName==`edutex`].{'\
'Retention:BackupRetentionPeriod,'\
'DeletionProtection:DeletionProtection,'\
'Earliest:EarliestRestorableTime,'\
'Latest:LatestRestorableTime}'
aws rds describe-db-clusters \
  --query "$EDUTEX_RDS_RECOVERY_QUERY" \
  > "$EDUTEX_EVIDENCE_DIR/rds-recovery.json"
aws dynamodb list-tables > "$EDUTEX_EVIDENCE_DIR/dynamodb-tables.json"
aws s3api get-bucket-versioning --bucket "$EDUTEX_FILES_BUCKET" \
  > "$EDUTEX_EVIDENCE_DIR/files-versioning.json"
```

Confirm daily continuous recovery, 35-day production retention, monthly archive/cold transition and
2555-day deletion, Vault Lock bounds, Aurora automated restore range, DynamoDB PITR and S3 versions.
Final contractual RPO/RTO remain client decisions and must be measured.

## Quarterly isolated full restore

1. Approve a restore ticket, recovery point and isolated account/VPC with no public ingress.
2. Preserve incident/evidence snapshots before any recovery operation.
3. Restore Aurora to a new cluster/name; never overwrite the only production cluster.
4. Restore required file versions to a new private KMS bucket/prefix.
5. Do not restore expired production session/auth-transaction state; create empty tables and require
   fresh authentication.
6. Deploy the exact approved application image privately with migration execution disabled until
   schema/checksum inspection completes.
7. Verify extensions, schema versions/checksums, roles, `rds.force_ssl`, RLS and ownership.
8. Reconcile tenant/table counts, FKs, financial totals, audit-chain continuity and sample records.
9. Test KMS decrypt only through the approved test context and one synthetic encrypted field.
10. Run two-tenant login/permission/read/write/file smoke tests.
11. Measure backup age, restore duration, validation duration, achieved RPO and achieved RTO.
12. Export minimal evidence and securely destroy all temporary data, keys and resources after
    approval.

Cognito, external IdPs, Cloudflare and SES are not restored by the PostgreSQL backup. Maintain and
test their IaC/configuration recovery and credential/certificate inventories separately.

## Recovery decision tree

- Isolated task/instance/AZ problem: prefer ECS/Aurora managed failover and validate.
- Bad application release with compatible schema: roll back to the previous immutable task/image.
- Database corruption/destructive change: point-in-time restore to a **new** cluster, validate, then
  perform an approved private cutover.
- Migration defect: prefer a tested forward fix; restore only under the data-loss/RPO decision.
- Compromised image/role: preserve evidence, rotate/revoke and redeploy a known-good immutable
  build.
- Tunnel/DNS incident: keep the AWS origin private throughout; never add temporary public ingress.

# Phase 27 - accessibility, mobile and user-acceptance testing

The visual design is a core product control, but usability must be verified rather than asserted.
Test the current supported browser/OS matrix on real devices and assistive technology:

- 320 CSS-pixel phone width through large desktop and 200%-400% zoom/reflow;
- portrait/landscape, safe areas, on-screen keyboard and slow/mobile network;
- keyboard-only focus order, visible focus, skip/main landmarks, modal focus trap/return and Escape;
- screen-reader names, headings, status/error announcements, tables/forms and icon buttons;
- contrast, non-colour status cues, text resizing and reduced motion;
- touch target size, scroll containment, navigation drawer, bottom tabs and account/passkey menu;
- auth, first-password/TOTP, passkey, SSO and error/recovery flows;
- every prototype module's information remains discoverable without horizontal data loss;
- representative long names, translations/locale formats and empty/loading/error/conflict states;
- protected pages/assets are not preloaded before authentication.

Record browser/device/assistive-tech version, test case, result, screenshot only with synthetic
data, defect and retest. Complete client UAT for student, teacher, staff, IT and executive
workflows.

# Phase 28 - penetration-test handoff

Do not start testing until this guide's mandatory live gates, isolated restore and two-tenant tests
pass. Use a dedicated production-like environment or explicitly authorised synthetic production
tenant. The signed rules of engagement must name:

- exact hostname, source CIDRs, dates/times/time zone, testers and emergency stop phrase;
- allowed AWS/Cloudflare/IdP configuration review versus provider infrastructure that is out of
  scope;
- data prohibition/minimisation and encrypted finding channel;
- rate/volume limits and separately authorised denial-of-service, phishing, persistence, destructive
  deletion or supplier pivoting;
- request markers, evidence retention/destruction and critical/high immediate notification;
- retest and closure requirements.

Required themes include Cloudflare/origin bypass, request normalisation/smuggling, OAuth
state/nonce/PKCE/mix-up/replay, MFA/passkey downgrade/enrolment/recovery, session/CSRF, BOLA/BFLA/
BOPLA/mass assignment, injection, file/polyglot/pixel flood, browser encryption protocol, secrets/
logs/source maps, IdP SSRF/claim overage and audit tampering. Map findings to OWASP ASVS 5.0.0 and
CWE. Critical/high findings block client data unless the legally authorised risk authority records a
time-bounded acceptance - which cannot override law, contract or an absolute policy.

# Phase 29 - final go-live gate

## Mandatory release checklist

Every item requires an evidence reference and owner signature:

- [ ] exact RC5 source/package hash and change approvals recorded;
- [ ] production runtime audit has no unaccepted high/critical finding;
- [ ] full build dependency exception R-014 has a valid owner/due date;
- [ ] SBOM, container/IaC/secret/licence scans and image/source identity retained;
- [ ] AWS organisation/account/root/federation/audit/security baseline effective;
- [ ] Cloudflare scoped token removed, remote state protected and drift plan exit 0;
- [ ] tunnel connectors healthy; no public AWS origin/load balancer/IP/inbound rule;
- [ ] edge TLS, managed WAF, OWASP PL3, custom/rate/IP/country/admin rules tested;
- [ ] SES identity/DKIM/DMARC/production sending and bounce/complaint monitoring tested;
- [ ] CDK stack, IAM and deletion/retention settings reviewed; outputs complete;
- [ ] all nine migrations exit 0 with immutable checksums;
- [ ] school/campus/academic year/admin bootstrap exits 0 and Cognito invariants pass;
- [ ] long-term password, mandatory TOTP and user-verified passkey tests pass;
- [ ] each enabled SSO provider and role/category matrix passes positive/negative tests;
- [ ] directory roles reconcile on subsequent federated login and stale mappings deny access;
- [ ] module policy and role permissions approved by the client;
- [ ] migration plan/rehearsal/apply/reconciliation and unsupported-data decisions signed;
- [ ] public headers/cache/protected-bundle/error and origin-bypass tests pass;
- [ ] independent device/session/CSRF/expiry/disablement/step-up tests pass;
- [ ] isolated two-tenant API/RLS/FK test passes every module;
- [ ] file and restricted-field crypto negative tests pass;
- [ ] SIEM/on-call alert tests and UTC correlation pass;
- [ ] isolated restore achieves approved RPO/RTO and cleanup completes;
- [ ] mobile/desktop/accessibility/UAT defects are closed or lawfully accepted;
- [ ] privacy notices, DSR, retention, deletion, legal-hold and safeguarding workflows are live;
- [ ] incident contacts/playbook, break-glass and client communications are tested;
- [ ] penetration-test entry criteria pass; blocking findings closed/retested;
- [ ] risk register/SoA/quality records reviewed and final release decision signed.

The repository risk register currently identifies open live-evidence and product/operating gaps,
including session inventory/revoke-all, central alert integration, privacy deletion/export workers,
restore proof and production scan/provenance. Do not mark the application generally available to
clients until each applicable pre-live item is implemented, tested or formally handled under the
stated acceptance rule.

## Controlled cutover

1. Announce go/no-go and freeze nonessential configuration.
2. Confirm backups/recovery point, current plans, on-call and rollback authority.
3. Enable the approved Cloudflare access/SSO policy; do not alter AWS origin exposure.
4. Run the synthetic smoke suite from allowed mobile/desktop networks.
5. Monitor Cloudflare, Cognito, application, ECS, RDS, SES and SIEM dashboards continuously through
   the heightened-monitoring window.
6. Invite a small approved pilot cohort, then expand only after error/security/support metrics stay
   inside thresholds.
7. Record cutover UTC, operator/approvers, configuration versions and first/last validation IDs.
8. Hand over dashboards, runbooks, contacts, renewal/rotation dates and known accepted risks.

# Phase 30 - rollback and stop conditions

## Immediate stop conditions

Stop/contain and notify the accountable owner on:

- any cross-tenant access/link/mutation or public AWS origin;
- authentication/MFA/passkey/SSO/step-up bypass or default privileged mapping;
- exposed secret/token/key/session/PII or plaintext restricted field;
- destructive/unexplained Cloudflare/Terraform/CDK/CloudFormation change;
- migration checksum/SQL/task error or unsigned data reconciliation;
- failed audit chain, missing central logs/alerts or unexplained clock skew;
- failed backup/restore or RPO/RTO breach;
- critical/high exploitable runtime/container/IaC/penetration finding;
- absent legal/privacy/safeguarding capability required for client data;
- loss of break-glass, on-call or rollback control.

## Application rollback

Roll back only to a previously approved immutable task definition/image whose database compatibility
with the current schema is proven. Use ECS deployment circuit breaker/controlled service update and
retain failed task/log evidence. Never rebuild the old tag and call it the same release.

## Infrastructure rollback

Use reviewed IaC and the stored prior state/version/change set. Do not edit resources manually
unless incident containment requires it and every change is recorded/reconciled back to IaC. Never
open an ALB/public IP/security-group origin as a temporary workaround.

## Database rollback

Applied migration files are immutable. Prefer a new forward migration. If restore is required,
restore to a new cluster, validate and perform an approved cutover with an explicit data-loss/RPO
decision. Do not run destructive down SQL, `git checkout` an applied migration or overwrite the only
recovery/evidence copy.

## Secret/tunnel rollback

If the tunnel token is exposed, rotate/revoke it in Cloudflare, put a new `AWSCURRENT` value in the
same approved Secrets Manager secret, force a new ECS deployment, remove unknown connectors and
inspect DNS/ruleset changes. The origin remains private throughout.

# Troubleshooting catalogue

Use each diagnostic as a stop-safe sequence. Do not skip directly to the response without first
confirming the stated cause from retained evidence.

\needspace{5\baselineskip} **`cdk synth: unknown option --parameters`**

- Likely cause: the RC1 runbook command is being used.
- Exact safe response: remove parameters from synthesis; supply stack-qualified parameters to
  deployment only.

\needspace{5\baselineskip} **Bootstrap rejects the SES From address**

- Likely cause: display-name syntax was used.
- Exact safe response: use one plain address such as `no-reply@school.example`.

\needspace{5\baselineskip} **Initial callback reports an incomplete identity**

- Likely cause: the RC1 administrator lacks `email_verified`.
- Exact safe response: stop and deploy RC5 or re-bootstrap through approved recovery. Never weaken
  the callback verification.

\needspace{5\baselineskip} **Passkey registration is absent or fails**

- Likely cause: missing `ALLOW_USER_AUTH`, the wrong relying-party ID, or old source.
- Exact safe response: verify the app-client explicit flow, Cognito-domain relying-party ID and RC5
  account-menu flow.

\needspace{5\baselineskip} **Cognito returns `InvalidParameterException` for WebAuthn**

- Likely cause: feature-plan, Region, domain or relying-party-ID mismatch.
- Exact safe response: confirm Cognito Plus, managed login v2, the prefix domain and the exact
  relying-party ID before retrying.

\needspace{5\baselineskip} **Terraform reports that the ruleset already exists**

- Likely cause: the zone already has a phase entry point.
- Exact safe response: import and merge the existing ruleset or formally move ownership. Never
  delete it blindly.

\needspace{5\baselineskip} **A Terraform WAF field is unavailable**

- Likely cause: the Cloudflare plan does not include that feature.
- Exact safe response: disable only the documented optional bot rule. Escalate every mandatory
  feature gap; never weaken the baseline silently.

\needspace{5\baselineskip} **The Terraform backend asks to migrate unexpected state**

- Likely cause: local or other state was discovered.
- Exact safe response: stop, identify its owner and history, take an approved backup and authorise
  an explicit state migration.

\needspace{5\baselineskip} **The Tunnel is inactive after the ECS deployment**

- Likely cause: a bad or old token, unavailable NAT/DNS, or an absent secret stage.
- Exact safe response: inspect cloudflared logs, `AWSCURRENT`, egress and the connector inventory
  without reading or logging the token.

\needspace{5\baselineskip} **The ECS service is stable but the portal reports database errors**

- Likely cause: liveness does not query the database, or migrations are absent.
- Exact safe response: run or verify the migration task and readiness evidence. Do not expose a
  public health endpoint.

\needspace{5\baselineskip} **The migration task has no task ARN**

- Likely cause: the ECS `failures` array is non-empty.
- Exact safe response: record the ARN/reason response, fix quota, IAM or network failure, and do not
  start parallel retries.

\needspace{5\baselineskip} **The migration container exits non-zero**

- Likely cause: SQL, checksum, TLS, secret or resource failure.
- Exact safe response: preserve the task and logs, stop, and use the reviewed forward-migration or
  restore decision.

\needspace{5\baselineskip} **Bootstrap reports a duplicate slug or hostname**

- Likely cause: prior or partial provisioning.
- Exact safe response: reconcile tenant, domain and Cognito state. Do not change spelling or rerun
  casually.

\needspace{5\baselineskip} **The bootstrap invitation is not delivered**

- Likely cause: SES sandbox, identity, DKIM, address or bounce status.
- Exact safe response: inspect SES events and account status, then correct the root cause. Never
  share or set a temporary password manually.

\needspace{5\baselineskip} **An SSO redirect does not match**

- Likely cause: the wrong callback was registered upstream.
- Exact safe response: the upstream redirect is Cognito `/oauth2/idpresponse`; the Edutex callback
  exists only in the Cognito app client.

\needspace{5\baselineskip} **A SAML response is rejected**

- Likely cause: metadata, certificate, signature, audience or time mismatch.
- Exact safe response: compare the synthetic assertion, metadata and UTC. Never disable validation
  merely to make the test pass.

\needspace{5\baselineskip} **A federated user is denied a mapping**

- Likely cause: provider disabled, or a missing, encoded or differently shaped claim.
- Exact safe response: inspect approved Cognito attributes or a synthetic claim and add an exact,
  reviewed mapping. Never add a default role.

\needspace{5\baselineskip} **A returning user loses an old directory role**

- Likely cause: RC5 entitlement reconciliation is correctly applying current claims.
- Exact safe response: confirm the new claims and mapping. Restore access only through an approved
  current-directory or explicit manual assignment.

\needspace{5\baselineskip} **A Google role claim is unavailable**

- Likely cause: standard Google OIDC does not supply Workspace groups.
- Exact safe response: use approved pre-provisioning or a SAML/custom-claim design. Do not authorise
  by guess.

\needspace{5\baselineskip} **A country or IP rule blocks the operator**

- Likely cause: the CIDR or country inventory is wrong.
- Exact safe response: use the authorised break-glass/change process from an approved path, then
  correct Terraform and re-plan.

\needspace{5\baselineskip} **`/health/live` is publicly answered with 403**

- Likely cause: this is the intended Cloudflare policy.
- Exact safe response: use ECS/container health and CloudWatch; do not add a public exception.

\needspace{5\baselineskip} **The legacy task cannot read the snapshot**

- Likely cause: wrong bucket, prefix, KMS policy or S3 grant.
- Exact safe response: require the exact files bucket and `migration-input/` key, then inspect the
  task role and object encryption.

\needspace{5\baselineskip} **The legacy digest differs**

- Likely cause: the staging/source data or its encoding changed.
- Exact safe response: stop, preserve both copies, re-export and re-approve. Never apply mismatched
  data.

\needspace{5\baselineskip} **A rate test locks out users**

- Likely cause: the test exceeded a production threshold.
- Exact safe response: wait for the mitigation timeout or use the approved test source/window. Do
  not disable the entire WAF.

\needspace{5\baselineskip} **Authenticated pages appear cached**

- Likely cause: an application header or Cloudflare rule error.
- Exact safe response: stop client use, purge under control, correct the `no-store` or cache rule,
  and assess exposure.

\needspace{5\baselineskip} **A CDK deployment rolls back**

- Likely cause: CloudFormation, ECS, RDS, quota or asset failure.
- Exact safe response: preserve events and logs and identify the first failure. Do not loop
  deployments.

# Post-go-live operating cadence

| Cadence                     | Mandatory activity                                                                                                     |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Continuous                  | SIEM/on-call, WAF/tunnel/ECS/RDS/backup/SES health, critical advisory and secret exposure monitoring                   |
| Daily                       | Failed backups, security findings, connector/service count, application error and mail reputation review               |
| Weekly                      | Vulnerability/dependency/container delta, privileged changes, WAF tuning and unresolved incident review                |
| Monthly                     | Access/role/IdP review, risk/CAPA, cost/capacity, Terraform/CDK drift and evidence completeness                        |
| Quarterly                   | Full isolated restore, break-glass, tunnel/IdP secret/certificate inventory, two-tenant regression and supplier review |
| Per release                 | Full quality/scans/SBOM/IaC plan/migration/rollback/smoke/ASVS evidence and approval                                   |
| Annually or material change | Threat model, DPIA/privacy, ISO scope/SoA, BCP/DR exercise, penetration test and management review                     |

Rotate credentials before expiry, not during an outage. Patch Node/base image/CDK/provider versions
through the full release process. Review Cloudflare/AWS/Cognito service changes because this guide
is time-stamped and service interfaces evolve.

# Command cleanup and evidence closeout

After handover:

```bash
unset EDUTEX_TUNNEL_SECRET_ARN
unset CLOUDFLARE_API_TOKEN
unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN
aws sso logout --profile "$EDUTEX_AWS_PROFILE"
```

Remove temporary override/plan/source copies only after approved evidence transfer and
reconciliation. Do not delete remote Terraform state, CloudFormation outputs required for operation,
source/SBOM hashes, audit/restore evidence or records subject to retention/legal hold. Verify the
evidence system has access logging, retention, named owner and no secrets.

# Authoritative service references

These links were checked against official documentation on 12 August 2026. Re-check them during each
release because service behaviour and CLI/provider options change.

## AWS and Cognito

- [AWS CDK bootstrapping environments](https://docs.aws.amazon.com/cdk/v2/guide/bootstrapping-env.html)
- [CDK bootstrap command](https://docs.aws.amazon.com/cdk/v2/guide/ref-cli-cmd-bootstrap.html)
- [AWS Secrets Manager create-secret CLI](https://docs.aws.amazon.com/cli/latest/reference/secretsmanager/create-secret.html)
- [Amazon SES identity creation](https://docs.aws.amazon.com/ses/latest/dg/creating-identities.html)
- [Request SES production access](https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html)
- [ECS run-task CLI](https://docs.aws.amazon.com/cli/latest/reference/ecs/run-task.html)
- [Cognito managed login](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-managed-login.html)
- [Cognito authentication and passkeys](https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-authentication-flow-methods.html)
- [Cognito managed-login endpoints](https://docs.aws.amazon.com/cognito/latest/developerguide/managed-login-endpoints.html)
- [Cognito TOTP MFA](https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-settings-mfa-totp.html)
- [Cognito OIDC providers](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-oidc-idp.html)
- [Cognito SAML providers](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-saml-idp.html)
- [Cognito attribute mapping and multi-values](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-specifying-attribute-mapping.html)
- [Cognito feature plans](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-sign-in-feature-plans.html)
- [RDS Proxy end-to-end IAM](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/rds-proxy-iam-migration.html)
- [Aurora IAM database authentication](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/UsingWithRDS.IAMDBAuth.html)
- [RDS PostgreSQL TLS](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.SSL.html)
- [AWS Backup Vault Lock](https://docs.aws.amazon.com/aws-backup/latest/devguide/vault-lock.html)
- [AWS Organizations best practices](https://docs.aws.amazon.com/organizations/latest/userguide/orgs_best-practices.html)
- [IAM best practices](https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html)
- [CloudTrail security best practices](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/best-practices-security.html)

## Cloudflare and Terraform

- [Create a remotely managed Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/get-started/create-remote-tunnel/)
- [Cloudflare Tunnel tokens](https://developers.cloudflare.com/tunnel/advanced/tunnel-tokens/)
- [Cloudflare managed WAF with Terraform](https://developers.cloudflare.com/terraform/additional-configurations/waf-managed-rulesets/)
- [Cloudflare custom WAF rules with Terraform](https://developers.cloudflare.com/terraform/additional-configurations/waf-custom-rules/)
- [Cloudflare rate limits with Terraform](https://developers.cloudflare.com/terraform/additional-configurations/rate-limiting-rules/)
- [Cloudflare API tokens](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/)
- [Cloudflare Ruleset resource/import](https://registry.terraform.io/providers/cloudflare/cloudflare/latest/docs/resources/ruleset)
- [Cloudflare minimum TLS](https://developers.cloudflare.com/ssl/edge-certificates/additional-options/minimum-tls/)
- [Cloudflare TLS 1.3](https://developers.cloudflare.com/ssl/edge-certificates/additional-options/tls-13/)
- [Authenticated Origin Pull limitations](https://developers.cloudflare.com/ssl/origin-configuration/authenticated-origin-pull/)
- [Cloudflare cache-control behaviour](https://developers.cloudflare.com/cache/concepts/cache-control/)
- [Terraform S3 backend and native locking](https://developer.hashicorp.com/terraform/language/backend/s3)
- [Terraform backend credential handling](https://developer.hashicorp.com/terraform/language/backend)
- [Terraform state](https://developer.hashicorp.com/terraform/language/state)

## External identity providers

- [Microsoft identity platform OIDC](https://learn.microsoft.com/en-us/entra/identity-platform/v2-protocols-oidc)
- [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect)
- [AWS tutorial for Google federation](https://docs.aws.amazon.com/cognito/latest/developerguide/tutorial-create-user-pool-social-idp.html)

# Final operator sign-off

| Decision                            | Name | Role | UTC time | Evidence/change reference | Signature/approval |
| ----------------------------------- | ---- | ---- | -------- | ------------------------- | ------------------ |
| Source/release approved             |      |      |          |                           |                    |
| Cloudflare plan approved            |      |      |          |                           |                    |
| AWS change approved                 |      |      |          |                           |                    |
| Schema/data reconciliation approved |      |      |          |                           |                    |
| Security/live gates approved        |      |      |          |                           |                    |
| Client go-live approved             |      |      |          |                           |                    |

Release decision: **GO / NO-GO / CONDITIONAL (attach lawful time-bounded acceptance)**.

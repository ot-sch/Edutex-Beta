# RC5 production deployment runbook

Release baseline: 1.0.0-rc.5 / 2026-08-12

Owner: Platform Operations  
Approvers: Release Manager and Security/Cloud approver  
Change type: high-risk production change

## Purpose and assurance boundary

This is the technical operating contract for the RC5 deployment assistant. The assistant removes
manual sequencing and rejects inconsistent values, but it cannot create organisational governance,
purchase Cloudflare features, approve its own change, prove a live control, conduct a restore or
issue an ISO/OWASP certificate. Do not admit client data until target-environment checks,
independent penetration testing, ISMS/QMS evidence and authorised acceptance are complete.

The supported topology is exactly one production AWS stack, Cloudflare hostname and school per
deployment. Do not add a second hostname or school to the same stack.

Interrupted apply is resumed with the same approved command. If an already-recorded migration or
bootstrap task proves failed, a replacement is forbidden until the approver records the exact
stopped task ARN. The operator then adds `--retry-failed-task migration|bootstrap` and
`--confirm-failed-task-arn <exact-arn>` to apply. RC5 preserves the predecessor ARN, changes the ECS
idempotency token, refuses completed stages and caps the history at ten before a mandatory incident.

## Required separation of duties

| Role                | Required action                                                                                                  | Must not do alone                                             |
| ------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Cloud owner         | Creates the dedicated AWS production account, SSO role, state bucket/KMS key, SES identity and security services | Approve their own privileged change                           |
| Edge owner          | Creates the Cloudflare Tunnel and narrowly scoped API token; confirms WAF/rate-limit entitlements                | Store a token in source/config/evidence                       |
| Release manager     | Verifies RC5 hash, approves source/image/SBOM and change window                                                  | Supply or retrieve long-term credentials                      |
| Security approver   | Reviews Terraform/CDK/IAM/network changes and stop conditions                                                    | Waive a failed mandatory gate without recorded risk treatment |
| Deployment operator | Runs the four stages using short-lived SSO/token access and preserves evidence                                   | Edit a plan after approval or bypass a failed stage           |
| Independent tester  | Runs target tests and reports findings                                                                           | Treat repository checks as a penetration test                 |

Two different authorised people must approve the plan for production. Privileged administrators must
use phishing-resistant MFA where available and a managed workstation.

## Prerequisites created before RC5 is run

The assistant deliberately verifies rather than silently creates these organisational resources:

1. A dedicated AWS production account under AWS Organizations, with IAM Identity Center, MFA,
   CloudTrail organisation trail, GuardDuty, Security Hub, AWS Config, alert routing, budgets and
   tested break-glass access.
2. An AWS deployment role/profile scoped to the approved account and change. Use short-lived SSO
   credentials; do not create an IAM-user access key for the operator.
3. A reviewed modern CDK bootstrap stack named `CDKToolkit` in the approved account/region, with
   organisation-approved execution policies, permissions boundaries, asset encryption and trust.
4. An S3 Terraform-state bucket in the same approved region with versioning enabled, all four
   public-access-block settings true, `BucketOwnerEnforced`, a bucket-wide non-TLS deny, default
   SSE-KMS with bucket keys, and the exact customer-managed KMS key supplied to RC5.
5. The state KMS key enabled with automatic rotation and a reviewed key policy granting only the
   deployment/backup/security roles that need it.
6. A verified Amazon SES identity in the same region/account, production sending enabled and, when
   selected, an existing SES configuration set.
7. A Cloudflare account/zone with a plan supporting the managed WAF and rate-limit resources in
   `infra/cloudflare/main.tf`, protected administrator accounts and audit-log retention.
8. One remotely managed Cloudflare Tunnel. Store its connector token as the `AWSCURRENT` value of a
   Secrets Manager secret in the approved AWS account/region. The configuration contains the secret
   ARN only; never the token.
9. Approved school legal name, permanent slug, exact hostname, campus, academic year, time zone,
   country, initial administrator email/name, allowed networks/countries and target task count.
10. Approved change ID, release/security approvers, maintenance window and rollback/incident owner.
11. Node.js 24+, npm 11+, AWS CLI v2, Terraform 1.10+, Docker Engine 24+ with buildx, Git/ZIP tools
    and the unmodified RC5 release on a supported managed workstation.

## Operator filesystem

Keep the release immutable and keep environment-specific records outside it:

```text
Edutex-Deployments/
├── release/Edutex-production/        # extracted RC5 source; do not edit after plan
└── schools/<school-slug>/
    ├── production.json               # non-secret validated configuration, owner-only
    └── work/                         # plans, hashes, progress and receipt, owner-only
```

The `work` folder contains confidential infrastructure metadata but no intended secret value. Store
it in the organisation's encrypted evidence repository after deployment. Never email or chat it.

## Stage 1 — create the non-secret configuration

From the RC5 repository root:

```bash
npm ci --ignore-scripts
npm rebuild sharp
npm run deploy:new -- \
  --output ../schools/<school-slug>/production.json
```

The interview asks one item at a time, validates it immediately and writes mode `0600`. It never
asks for a password, AWS key, Cloudflare API token, Tunnel token, client secret, private key,
session token or recovery code. Stop if any person/process requests one of those for
`production.json`.

School bootstrap creates a confidential Cognito OAuth client and immediately places the generated
client secret in `edutex/tenants/<tenant-id>/cognito/browser-client-secret`. The value must never be
copied into PostgreSQL, deployment configuration or evidence. The long-running task role can read
only that exact tenant-path suffix; it uses the value for backend `client_secret_basic` code
exchange and discards Cognito tokens after verification.

The schema rejects:

- tutorial placeholders and secret-shaped fields/values;
- invalid DNS/UUID/account/region/date/time-zone/CIDR values;
- duplicate network/country lists;
- mismatched school/Cloudflare hostnames;
- ARNs from another AWS account or region;
- an incorrectly tenant-scoped Terraform state key;
- a maintenance window whose end is not after its start; and
- fewer than three or more than thirty production tasks.

Do not hand-edit the JSON. If an approved answer changes, rerun `deploy:new` with `--replace`,
review the complete file and produce a new plan.

## Stage 2 — read-only prerequisite check

First obtain a short-lived AWS SSO session:

```bash
aws sso login --profile <profile-entered-in-production.json>
```

Then run:

```bash
npm run deploy:check -- \
  --config ../schools/<school-slug>/production.json \
  --work-dir ../schools/<school-slug>/work
```

`deploy:check` performs no Terraform/CDK/ECS mutation. It fails closed unless it proves:

- Node/npm/AWS CLI/Terraform/Docker/buildx meet minimum versions;
- the AWS profile resolves to the exact approved account and region, and `CDKToolkit` is in a
  completed/rollback-completed stable state;
- the Tunnel-token secret metadata resolves to the exact ARN and has `AWSCURRENT`, without reading
  its secret value;
- the state bucket is in the approved region, versioned, owner-enforced, fully public-blocked,
  protected by a bucket-wide non-TLS deny and encrypted by the exact enabled customer KMS key with
  bucket keys;
- the customer KMS key has rotation enabled; and
- the SES identity reports `SUCCESS`, the account has production sending enabled and any named
  configuration set resolves exactly.

Save the terminal output. Do not proceed when the final line is not `CHECK PASSED`.

## Stage 3 — plan and bind review evidence

Obtain a short-lived Cloudflare token limited to the intended account/zone and the Tunnel/DNS/WAF
permissions required by this release. Inject it using the approved password-manager/CI facility as
`CLOUDFLARE_API_TOKEN`; do not write it to JSON, tfvars, source or a command argument.

```bash
npm run deploy:plan -- \
  --config ../schools/<school-slug>/production.json \
  --work-dir ../schools/<school-slug>/work
```

The plan stage:

1. repeats the complete preflight including token presence;
2. runs the function-comment gate, strict typecheck, tests, lint, format check and production build;
3. blocks on high-severity runtime dependency findings and writes a CycloneDX runtime SBOM;
4. writes owner-only Terraform backend/variable files without the Cloudflare token;
5. initialises encrypted remote state, formats/validates Terraform and creates a binary plan;
6. exports `cloudflare-plan.txt` for human review;
7. synthesises the production CDK/CloudFormation template with the application defaulted to zero
   tasks and exports `aws-cdk-diff.txt`; and
8. writes `plan-record.json` binding release, change, hostname, configuration SHA-256, complete
   controlled-source SHA-256, Terraform provider-lock/binary/human-plan SHA-256 values, synthesized
   CloudFormation-template and complete cloud-assembly SHA-256, and human-readable CDK-diff SHA-256.

The operator stops at `PLAN READY`. The release manager and security/cloud approver independently
review at least:

- correct account, region, school, hostname, Tunnel UUID and remote-state key;
- proxied Cloudflare CNAME only—no public AWS origin;
- Cloudflare managed WAF plus OWASP managed rules, expected rate limits and plan entitlements;
- exact IP/country/admin policy semantics and no accidental broad denial/allow;
- no ALB, public ECS IP, inbound application rule or public database path;
- IAM grants, KMS/Secrets Manager scopes, resource replacements and retention/deletion policies;
- production `ApplicationDesiredCount` default `0` for the foundation phase;
- immutable container asset/build inputs; and
- no unexpected destroy/replace or policy broadening.

Record approval against the exact plan/source/configuration hashes. Any edit after plan requires a
new plan and new approval.

## Stage 4 — apply the approved plan

Apply only inside the ISO-offset maintenance window recorded in `production.json`. The operator must
repeat both human confirmation values exactly:

```bash
npm run deploy:apply -- \
  --config ../schools/<school-slug>/production.json \
  --work-dir ../schools/<school-slug>/work \
  --execute \
  --approval-id <exact-approved-change-id> \
  --confirm-hostname <exact-school-hostname> \
  --confirm-record-sha256 <64-character-hash-from-approved-change-record>
```

Apply exits before mutation if the confirmation, externally recorded plan-record hash, time window,
AWS/cloud prerequisites, source/configuration hash or any provider-lock/binary/human-readable
plan/template/assembly/diff hash differs. Terraform's S3 backend and Cloudflare apply are pinned to
the validated AWS SSO profile/region. Ambient static AWS variables are rejected; the Cloudflare
token is stripped from all child processes except the exact Terraform plan/apply command. The
mutation sequence is fixed:

1. apply the approved Cloudflare binary plan;
2. deploy the private AWS foundation from the exact approved CDK cloud assembly, with desired
   application count zero;
3. run one private Fargate database-migration task and require the expected container exit code 0;
4. run one private Fargate school-bootstrap task and require exit code 0;
5. deploy the same approved cloud assembly with the approved desired count (minimum three); and
6. wait for ECS stability and write `deployment-receipt.json`.

Migration/bootstrap use private subnets, public IP assignment `DISABLED`, the emitted migration
security group and deterministic ECS client tokens. RC5 writes each task ARN before waiting, so a
lost terminal does not justify starting a second task.

## Interrupted terminal or failed stage

Do not delete the work folder and do not manually rerun ECS tasks. Open the same RC5 release and
run:

```bash
npm run deploy:status -- \
  --config ../schools/<school-slug>/production.json \
  --work-dir ../schools/<school-slug>/work
```

Preserve logs, identify and correct the approved external prerequisite, obtain renewed approval if
the source/config/plan changes, then rerun the exact `deploy:apply` command inside an approved
window. Completed stages are skipped only when the progress file matches the same source and
configuration hashes. Never fabricate/edit progress or receipt JSON.

## Mandatory stop and incident conditions

Stop immediately and invoke incident/change control for a public origin, secret disclosure,
unexpected account/hostname, failed or checksum-mismatched migration, failed bootstrap, cross-tenant
behavior, MFA/authorization bypass, audit-chain failure, unexplained replacement/destruction,
critical/high runtime issue, or changed approved bytes. Do not weaken WAF, RLS, TLS, MFA, IAM,
validation or network controls merely to make deployment continue.

Application rollback may select the previous immutable task definition only after schema
compatibility is confirmed. Database recovery prefers reviewed roll-forward or point-in-time
restore. Infrastructure changes use reviewed IaC; never open an origin or edit applied migration
SQL. Preserve evidence before changing state.

## Post-deployment acceptance (still mandatory)

`DEPLOYMENT COMPLETE` is not go-live approval. Complete and retain evidence for:

- direct-origin discovery/connectivity failure and proxied Cloudflare DNS/Tunnel health;
- WAF, rate, IP, country, admin-network and private-health-path positive/negative tests;
- password+TOTP, passkey, logout, expiry, disabled account, recovery and step-up tests;
- Microsoft Entra, Google Workspace/OIDC and SAML with real school claim/group edge cases;
- unauthenticated protected-asset denial and per-device unique session/revocation tests;
- live two-tenant API and PostgreSQL-RLS negative tests;
- browser encryption, KMS context, log/plaintext absence and key-rotation/recovery tests;
- S3 upload restrictions, malware/content validation and retention;
- audit chain, monitoring, alert delivery and incident exercise;
- isolated backup restore meeting approved RTO/RPO;
- mobile/desktop accessibility, supported-browser, load and resilience tests;
- SAST/DAST/container/IaC/cloud configuration scans and independent penetration testing; and
- privacy/legal/records review, ISMS/QMS internal audit, management review and applicable
  certification assessment.

Formal ISO/IEC 27001 or ISO 9001 conformity/certification belongs to the operating organisation and
its scoped management systems. OWASP is a verification baseline, not a product-certification body.
Repository controls are designed to support those outcomes but cannot truthfully establish “100%
compliance” without live evidence and authorised independent assessment.

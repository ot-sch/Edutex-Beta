# Edutex production platform

This repository is the production-candidate replacement for the uploaded Edutex prototype. It is a
multi-tenant school platform built as independent web, API, database and infrastructure units. The
production browser never connects to PostgreSQL, no Supabase client or key is present, and the
public origin has no inbound route from the internet.

## Release status

The code and infrastructure are deployable, but a release is not certified or penetration-test
approved merely because it builds. Before client data is admitted, complete the environment-specific
controls in the deployment runbook, run the live integration and restore tests, close or accept the
documented risks, and obtain independent penetration-test approval.

The assurance baseline is OWASP ASVS 5.0.0 with the OWASP Top 10:2025 and API Security Top 10:2023
as threat catalogues. ISO/IEC 27001:2022 (including Amendment 1:2024) is the primary governance
target; ISO 9001:2015 (including Amendment 1:2024) supplies the quality-management process. Formal
ISO certification applies to the operating organisation and its scoped management system, not to
source code alone.

Release candidate 5 supports one production AWS stack, exact Cloudflare hostname and school per
client deployment. Tenant-aware RLS and composite keys remain defence in depth; additional client
hostnames in one stack are not supported while callback/base URL and Tunnel ingress are stack-wide.

RC5 adds a four-command production deployment assistant. It interviews the operator one approved,
non-secret value at a time; validates account/region/hostname relationships; verifies AWS identity,
state encryption and prerequisite resources; binds reviewed binary and human-readable Terraform/CDK
artifacts plus the Terraform provider lock to exact source/configuration hashes; creates the private
AWS foundation at zero running application tasks; runs migrations and school bootstrap as private
idempotent ECS jobs; and only then activates three or more application tasks. Interrupted applies
resume from signed-off local evidence rather than guessing which one-shot task ran. A mandatory
source-documentation gate now checks every maintained file and every implemented function/callback
before compilation.

## Repository layout

| Path                 | Responsibility                                              |
| -------------------- | ----------------------------------------------------------- |
| `apps/auth-web`      | Minimal public authentication and school-branding client    |
| `apps/portal-web`    | Authenticated, responsive Tailwind portal                   |
| `apps/api`           | Fastify backend-for-frontend and all data access            |
| `packages/contracts` | Shared Zod request/response contracts                       |
| `packages/database`  | PostgreSQL pool, tenant transactions and migrations         |
| `infra/aws`          | Private AWS application plane in CDK                        |
| `infra/cloudflare`   | DNS, Tunnel, WAF, managed rules and network restrictions    |
| `scripts`            | Guarded deployment, school bootstrap and legacy migration   |
| `docs`               | Architecture, standards, assurance and operating procedures |

## Security model at a glance

- Cloudflare is the only public edge. A remotely managed Tunnel makes an outbound connection from
  the Fargate task; the AWS origin has no public IP, load balancer or inbound security-group rule.
- Production requests must carry Cloudflare's request marker and the exact stack-provided hostname;
  host confusion or an unapproved origin path fails closed before tenant resolution.
- Cognito Plus user pools are isolated per school and support password + TOTP, verified passkeys,
  Microsoft Entra ID, Google, generic OIDC and SAML federation.
- Passkey enrolment uses the managed-login relying-party domain and a CSRF/state/nonce/PKCE-bound
  transaction; federated roles are re-evaluated on every upstream sign-in.
- OAuth authorization code + PKCE uses one-time state, nonce and a separate browser-binding cookie.
  Cognito tokens are verified and consumed by the API and never stored in the browser.
- Each school uses a confidential Cognito OAuth client. Its generated secret is written directly to
  tenant-scoped AWS Secrets Manager and read only by the BFF for `client_secret_basic` code
  exchange; PKCE/state/nonce/browser binding remain mandatory.
- Browser sessions are opaque 256-bit reference tokens. Only hashes are stored in KMS-encrypted
  DynamoDB, bound to a device cookie and user-agent privacy hash, with idle and absolute expiry.
- Every data operation is permission checked in the API and again by PostgreSQL row-level policies.
  Tenant-aware composite foreign keys prevent cross-tenant relationships.
- Selected highly sensitive student fields are AES-256-GCM encrypted in the browser. The KMS
  envelope key is released only after recent high-assurance authentication and is re-wrapped over
  ephemeral P-256 ECDH into a non-extractable browser key.
- All production PostgreSQL traffic uses RDS Proxy, IAM authentication and certificate-verified TLS.
  The separate one-shot migration and provisioning tasks receive the bootstrap database secret from
  AWS Secrets Manager and have the only approved direct writer path.

See [production architecture](docs/architecture/PRODUCTION_ARCHITECTURE.md) and
[security architecture](docs/security/SECURITY_ARCHITECTURE.md).

## Local verification

Node.js 24.14+ and npm 11+ are required.

```bash
npm ci --ignore-scripts
npm rebuild sharp
npm run quality
npm audit --omit=dev --audit-level=high
```

Development adapters are intentionally rejected when `NODE_ENV=production`. Copy `.env.example` to
an untracked environment file only for local development; never put real credentials there.

## Production deployment order

After the cloud/security owners create the approved AWS/Cloudflare prerequisites, the controlled
workstation uses these fail-closed stages:

```bash
npm run deploy:new -- --output ../edutex-operator/<school>/production.json
npm run deploy:check -- --config ../edutex-operator/<school>/production.json
npm run deploy:plan -- --config ../edutex-operator/<school>/production.json
npm run deploy:apply -- --config ../edutex-operator/<school>/production.json \
  --execute --approval-id <approved-change-id> --confirm-hostname <exact-hostname> \
  --confirm-record-sha256 <approved-plan-record-hash>
```

`deploy:new` never asks for passwords or tokens. `deploy:check` is read-only. `deploy:plan` performs
the complete source gate and saves human-readable plans. `deploy:apply` is the only mutating stage
and refuses to run outside the approved time window or against changed bytes. The application stays
stopped until Cloudflare, PostgreSQL migrations and initial-school bootstrap have all succeeded.

The complete commands and rollback gates are in
[`docs/operations/DEPLOYMENT_RUNBOOK.md`](docs/operations/DEPLOYMENT_RUNBOOK.md).

## Database migration from the prototype

The prototype’s JSON document rows are not copied blindly. Stable business entities are mapped to
typed relational columns and relationships. JSONB remains only where the shape is genuinely dynamic,
such as a versioned form definition, bounded audit evidence or integration metadata. Run the legacy
migrator in plan mode first and reconcile every unsupported table before `--apply`. See
[`docs/MIGRATION_MATRIX.md`](docs/MIGRATION_MATRIX.md).

## Standards and evidence

- [Codebase standards](docs/standards/CODEBASE_STANDARDS.md)
- [Database standards](docs/standards/DATABASE_STANDARDS.md)
- [PostgreSQL object catalogue](docs/standards/DATABASE_OBJECT_CATALOG.md)
- [OWASP ASVS evidence matrix](docs/security/OWASP_ASVS_5_MATRIX.md)
- [ISO/IEC 27001 pre-SoA](docs/governance/ISO27001_STATEMENT_OF_APPLICABILITY.md)
- [ISO 9001 quality plan](docs/governance/ISO9001_QUALITY_PLAN.md)
- [Risk register](docs/governance/RISK_REGISTER.md)
- [Penetration-test readiness](docs/operations/PENETRATION_TEST_READINESS.md)

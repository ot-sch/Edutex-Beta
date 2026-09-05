> RC5 historical reference. For this build, start with
> [the RC6 technical guide](Edutex_RC6_Technical_Setup_Guide.md),
> [the RC6 guide for everyone](Edutex_RC6_Setup_Guide_for_Everyone.md), and
> [the explicit roadmap gaps](../RC6_ROADMAP_COVERAGE.md). Do not reuse RC5 version values or apply
> receipts for RC6.

---

title: 'Edutex Complete Project Handbook' subtitle: 'Framework, architecture, governance,
operations, security, standards and migration' author: 'Edutex Engineering' date: 'Release candidate
5 · 12 August 2026' lang: en-GB documentclass: report classoption:

- oneside
- openany papersize: a4 fontsize: 9.5pt geometry:
- top=23mm
- bottom=24mm
- left=19mm
- right=19mm colorlinks: true linkcolor: EdutexBlue urlcolor: EdutexTeal toccolor: EdutexBlue
  toc-depth: 3 secnumdepth: 3

---

# Document control and assurance boundary

| Field                         | Controlled value                                                                                                                             |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Document                      | Edutex Complete Project Technical and Operational Handbook                                                                                   |
| Version                       | 1.0.0-rc.5                                                                                                                                   |
| Product baseline              | `edutex-production`, release candidate 5, 12 August 2026                                                                                     |
| Scope                         | Application, frontend, API, database, AWS, Cloudflare, identity, security, governance, quality, operations, migration and assurance evidence |
| Supported production topology | One AWS stack, exact Cloudflare hostname and school per client deployment                                                                    |
| Security management target    | ISO/IEC 27001:2022 including Amendment 1:2024                                                                                                |
| Quality management target     | ISO 9001:2015 including Amendment 1:2024                                                                                                     |
| Verification baseline         | OWASP ASVS 5.0.0 Level 2 plus selected Level 3 controls; OWASP Top 10:2025; OWASP API Security Top 10:2023                                   |
| Status                        | Production candidate; pre-certification, pre-live-evidence completion and pre-independent penetration-test approval                          |
| Owners                        | Product, Engineering, Platform Operations, Information Security, Data Engineering, Privacy/Legal and client service owner                    |
| Review                        | Every release/material change/major incident, and at least annually                                                                          |

## Purpose

This handbook is the consolidated project dossier for Edutex. It explains what the system is, how
its components fit together, which controls are implemented in source, which controls depend on the
live environment or operating organisation, how prototype data moves to PostgreSQL, and which
evidence is required before client data is admitted.

The first part provides a readable system-level account. The second part incorporates the complete
source-controlled project documents as the normative detail: architecture, security architecture,
code and database standards, OWASP matrix, ISO pre-Statement of Applicability, ISO 9001 quality
plan, risk register, migration matrix, deployment/backup/incident/penetration-test runbooks, project
security/contribution policy and change history.

## Assurance statement

No source repository can be “100% ISO 27001 compliant,” “OWASP certified,” universally secure or
unhackable. ISO certification applies to the operating organisation's scoped management system and
requires policy, ownership, competence, risk treatment, auditable operation and accredited audit.
OWASP ASVS conformance requires verified requirements and retained evidence in the deployed
environment. This candidate deliberately records open controls and risks instead of converting
design intent into an unsupported certification claim.

## Normative language and hierarchy

**Must** is mandatory; **should** requires a documented approved deviation; **may** is optional.
Applicable law, safeguarding obligation and signed customer contract take precedence, followed by
approved organisational policy, this handbook/source standards, approved architecture/change
records, and implementation comments. Stop and obtain Legal/Privacy/Security/owner direction on a
conflict; no risk acceptance can authorise breach of law or an absolute policy.

# Executive project summary

## Product outcome

Edutex is a visually led school operations platform rebuilt from a prototype into separated
authentication, portal, API, contract, relational database and infrastructure workspaces. The
browser never connects to PostgreSQL and receives no AWS credential, database credential or Cognito
token. Cloudflare is the sole public edge; an outbound Tunnel sidecar reaches a private Fargate
application over task loopback. School identities live in a school-isolated Cognito Plus pool and
may use password plus TOTP, user-verified passkeys, Microsoft Entra ID, Google, generic OIDC or
SAML.

The relational model replaces generic JSON document storage with typed columns, UUID primary keys,
composite tenant-aware foreign keys, constraints, indexes, parameterised SQL, transaction-local
tenant context and PostgreSQL row-level security. JSONB remains only for genuinely dynamic,
versioned or bounded evidence/integration structures.

## What changed from the prototype

| Prototype condition                                | Production-candidate treatment                                                                  |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Monolithic `index.html` and sequential patch files | npm workspace repository with independent auth, portal, API, contract, DB, IaC and script units |
| Supabase/browser-to-database path                  | Private Fastify BFF; Aurora PostgreSQL reachable only through private AWS paths                 |
| Generic JSON rows                                  | Normalised typed SQL model with PK/FK/check/unique/index/RLS controls                           |
| Browser/local shared state                         | Opaque per-device server-side sessions in KMS DynamoDB, CSRF and device/UA binding              |
| Public/weak origin assumptions                     | Cloudflare DNS/Tunnel/WAF/rate/access policy; AWS has no public application ingress             |
| Inline/ad-hoc CSS                                  | React/Vite clients with Tailwind CSS 4, shared design language and responsive layouts           |
| Non-working SSO                                    | Cognito brokerage for Entra, Google, OIDC and SAML with explicit provider-scoped role mappings  |
| No production MFA                                  | Required TOTP for password plus user-verified WebAuthn passkeys that can satisfy MFA            |
| Source secrets                                     | Workload identity and AWS Secrets Manager; no runtime key in source/browser                     |
| Shared/colliding sessions                          | 256-bit opaque session per browser/device; one-device logout and bounded expiry                 |
| Unstructured assurance                             | ISO/IEC 27001 pre-SoA, ISO 9001 quality plan, ASVS evidence matrix, risk/CAPA/runbooks          |
| Blind JSON migration                               | Hash/plan/rehearse/transaction/reconcile process with only four typed collections automated     |

## RC5 corrective changes

RC5 retains all RC2-RC4 identity, migration and deployment corrections and additionally adds:

- a guided configuration interview that accepts only approved, non-secret values and validates
  account/region/hostname/ARN/date/time-zone/CIDR relationships before a vendor tool can run;
- read-only proof of the selected AWS identity, Tunnel-secret stage, exact KMS-encrypted and
  versioned Terraform-state boundary, customer-key rotation and SES verification;
- binary and human-readable Terraform plans plus synthesized CloudFormation template and CDK diff
  bound to the exact release, configuration and controlled source tree before production mutation;
- a staged AWS deployment whose production application count is zero until private migration and
  school-bootstrap ECS tasks both exit successfully, followed by activation at three or more tasks;
- deterministic ECS idempotency tokens plus owner-only atomic progress/receipt files for safe
  interruption and resume;
- an AST-enforced source-documentation gate covering every maintained file and every implemented
  function/callback, including private helpers and test/React/collection callbacks; and
- an assembly-manual beginner guide aligned to those four tested deployment commands.

The retained earlier corrections include:

- the tenant-scoped Secrets Manager path and runtime IAM action required for SSO provider setup;
- immutable caching only for fingerprinted authentication assets;
- transactional optimistic concurrency for module-visibility changes;
- strict legacy boolean, positive-integer and relational enum conversion;
- stronger production URL, Cloudflare identifier/CIDR, hostname, timezone and region validation;
- disabled-by-default new/reconfigured external identity-provider staging, performed before upstream
  trust changes, with an explicit row-versioned publication action that requires at least one exact
  provider-scoped role mapping;
- normalised administration row versions at the PostgreSQL-to-JSON boundary so policy, module and
  provider optimistic-concurrency checks cannot fail because `bigint` values arrived as strings;
- corrected the repository CDK synthesis shortcut so options reach the CDK CLI, and made the
  unauthenticated CI synthesis account-agnostic to prevent an invalid Availability Zone lookup;
- runtime release metadata derived from the approved API package version;
- regression tests for identity-secret isolation, private-origin synthesis and new validation
  boundaries;
- a companion plain-English setup guide for less-experienced operators.

The retained RC2 corrections are:

- Cognito `ALLOW_USER_AUTH`, Cognito-domain WebAuthn RP ID and a safe self-service passkey
  registration transaction;
- verified initial-admin invitation identity;
- bracketed multi-value Cognito claim decoding;
- current directory-role reconciliation on every federated sign-in, with stale directory grants
  removed and no-match denied;
- one-shot private legacy import from KMS-encrypted, eight-day S3 staging;
- explicit initial academic-year creation and identifiers at school bootstrap;
- mandatory remote S3 Terraform backend declaration;
- corrected CDK synthesis and SES From-address runbook instructions;
- explicit one-school/hostname-per-stack production boundary.

# Assurance and release status

## Control-state model

| State                  | Meaning                                                                | Release treatment                                                           |
| ---------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Implemented in source  | Code/IaC/SQL exists and local verification passes                      | Still requires deployment/configuration evidence                            |
| Live evidence required | Control depends on target account, provider, data, people or operation | Mandatory pre-live test and retained record                                 |
| Product gap            | Required workflow/control is not yet complete in the candidate         | Implement before live or meet strict lawful acceptance rule where permitted |
| Operating control      | Organisation/client must own policy, staffing, supplier or response    | Named owner, procedure, training and effectiveness evidence                 |
| Independent assurance  | External security/audit verification                                   | Blocking results closed/retested before general availability                |

## Implemented technical baseline

- strict TypeScript/ESM workspaces, Zod contracts, lint/format/build/test gate;
- React 19 + Vite 8 + Tailwind 4 separate public/protected clients;
- Fastify 5 BFF with Helmet/CSP, safe errors, rate limits, request correlation and redaction;
- OAuth code + PKCE S256, state, nonce, one-time store and browser binding;
- Cognito Plus, managed login v2, TOTP, WebAuthn UV, external federation and claim mapping;
- opaque DynamoDB sessions with KMS, TTL, device/UA binding, idle/absolute expiry and 60-second
  stored-identity refresh;
- Aurora PostgreSQL 16.6, typed relational schema, PK/FK/RLS, IAM/TLS runtime path and pgAudit;
- KMS/S3/DynamoDB encryption, KMS envelope field key, browser AES-GCM and private file handling;
- private Fargate/Cloudflare Tunnel topology with managed/custom WAF and rate rules;
- immutable checksum migrations, one-shot bootstrap/import tasks, backup/Vault Lock design;
- structured architecture/security/ISO/OWASP/quality/risk/operations/migration documents.

## Mandatory live evidence

- AWS organisation, account, IAM Identity Center, CloudTrail, GuardDuty, Security Hub, Config,
  Inspector/SIEM and on-call baseline;
- actual Cloudflare plan feature support, ruleset imports, WAF/rate/access behaviour and tunnel
  connector/origin-bypass evidence;
- SES domain/DKIM/DMARC/production access and event routing;
- TOTP/passkey first sign-in, recovery and disabled-user tests;
- every real Entra/Google/OIDC/SAML provider claim/MFA/role/mover/leaver/rotation case;
- complete two-tenant/API/RLS/composite-FK negative suite in an isolated production-like
  environment;
- full image/IaC/secret/licence/provenance scans and signed release evidence;
- central alert effectiveness, audit-chain verification and time correlation;
- quarterly isolated restore with achieved RPO/RTO;
- browser/device/mobile/accessibility/UAT matrix;
- independent penetration test and retest closure;
- privacy, data-subject request, retention/disposal/legal-hold and safeguarding operation.

## Material open gates

The source risk register is authoritative. Important current gates include:

- administrator session inventory and revoke-all product workflow is not complete;
- active external IdP leavers require the operating disable/revoke process; directory claims are
  reconciled at the next upstream authentication, not continuously pushed;
- retention/erasure/export workers and legal validation are outstanding;
- central SIEM/on-call integration and alert tests are deployment responsibilities;
- full restore evidence has not been produced for a target client environment;
- container registry signing/provenance and target-account scanning remain live release gates;
- only four legacy collections have an automated typed importer;
- SAML signing/encryption and each provider's exact MFA claims require target-tenant proof;
- R-014 records a time-bounded development/CDK transitive dependency exception due 22 August 2026.

General client availability is a no-go until all applicable pre-live gates are closed or, only where
law/policy permits, accepted by the named authority within the risk rule.

# Framework and technology catalogue

## Runtime and language

| Layer             | Framework/runtime             | Pinned candidate version/policy                        |
| ----------------- | ----------------------------- | ------------------------------------------------------ |
| Language          | TypeScript/ECMAScript modules | TypeScript 6.0.3; strict workspace configuration       |
| Server runtime    | Node.js                       | 24.14.0 container; repository engine Node >=24         |
| Package manager   | npm workspaces                | npm >=11; exact lockfile and `npm ci --ignore-scripts` |
| API               | Fastify                       | 5.11.3                                                 |
| Schema contracts  | Zod                           | 4.4.3                                                  |
| PostgreSQL client | `pg`                          | 8.22.0                                                 |
| OIDC/JWT          | `jose`                        | 6.2.8                                                  |
| Logging           | Pino through Fastify          | 10.3.1, structured/redacted                            |
| Image processing  | Sharp                         | 0.35.3, explicit rebuild and re-encode                 |
| Browser UI        | React / React DOM             | 19.2.8                                                 |
| UI build          | Vite                          | 8.2.1                                                  |
| Styling           | Tailwind CSS                  | 4.3.3                                                  |
| Icons             | Lucide React                  | 1.30.0                                                 |
| Tests             | Vitest                        | 4.1.10                                                 |
| AWS IaC           | AWS CDK/constructs            | CLI 2.1135.1, library 2.264.0, constructs 10.8.1       |
| Edge IaC          | Terraform/Cloudflare provider | Terraform >=1.10; provider >=5.10,<6                   |
| Container         | Debian Bookworm slim          | multi-stage, non-root/read-only ARM64 runtime          |

## Managed services

| Service                | Responsibility                                                    | Security boundary                                     |
| ---------------------- | ----------------------------------------------------------------- | ----------------------------------------------------- |
| Cloudflare DNS/Edge    | TLS, DDoS, WAF, OWASP rules, rate limits, IP/country/admin policy | Only public ingress                                   |
| Cloudflare Tunnel      | Outbound connector from task to edge                              | No origin IP/listener; loopback service               |
| Amazon ECS Fargate     | Stateless API, web bundles and connector                          | Private subnets, no public IP, circuit breaker        |
| Amazon Cognito Plus    | School pool, managed login, local MFA/passkeys and federation     | One pool/client/domain per school                     |
| Aurora PostgreSQL 16.6 | Authoritative relational business data                            | Isolated subnets, encrypted, RLS, deletion protection |
| RDS Proxy              | Runtime connection mediation                                      | IAM auth end-to-end and TLS required                  |
| DynamoDB               | Session and auth-transaction stores                               | KMS, TTL, PITR, hashed identifiers                    |
| S3                     | Private files and temporary migration input                       | KMS, versioning, TLS-only, public block, lifecycle    |
| KMS                    | Session/files/tenant field keys                                   | Rotation, encryption context and least IAM            |
| Secrets Manager        | Tunnel, DB bootstrap and IdP client secret records                | No browser/source return; workload-role access        |
| CloudWatch/Flow Logs   | Application, connector, DB and network telemetry                  | KMS/retention and central forwarding required         |
| AWS Backup             | Aurora/Dynamo protection and Vault Lock                           | Isolated restore proof required                       |
| SES                    | Cognito invitation/recovery email                                 | Same-region verified identity and event monitoring    |

# Repository and codebase architecture

## Workspace map

| Path                 | Owned responsibility                                                 | May depend on                          |
| -------------------- | -------------------------------------------------------------------- | -------------------------------------- |
| `apps/auth-web`      | Minimal unauthenticated school branding and approved sign-in choices | contracts only; public tenant API      |
| `apps/portal-web`    | Authenticated responsive workspace, modules, admin, encryption UI    | contracts; BFF API; no AWS/DB SDK      |
| `apps/api`           | Fastify BFF, auth/session/admin/files/crypto/resources               | contracts, database package, AWS SDKs  |
| `packages/contracts` | Shared Zod request/response/domain identifiers                       | Zod only                               |
| `packages/database`  | pool, IAM/TLS, tenant/system transactions, migrations                | `pg`, RDS signer, Zod                  |
| `infra/aws`          | private AWS application plane                                        | CDK only; no Cloudflare ownership      |
| `infra/cloudflare`   | proxied DNS, Tunnel config, custom/managed WAF and rate rules        | Terraform Cloudflare provider          |
| `scripts`            | school bootstrap and private legacy migration                        | declared AWS/database/Zod dependencies |
| `docs`               | architecture, standards, governance, risk and runbooks               | source-controlled release evidence     |

The root orchestrates deterministic build, typecheck, test, lint, format and package tasks. Source
modules use descriptive names, explicit interfaces, bounded comments at trust boundaries and no
prototype patch-chain execution.

## Build and delivery path

1. `npm ci --ignore-scripts`, explicit Sharp rebuild and full quality gate.
2. Runtime audit, full dev audit/evaluation, CycloneDX SBOM and secret/licence/container scans.
3. Multi-stage Docker build compiles every workspace and prunes dev dependencies.
4. CDK hashes/builds/publishes the ARM64 application asset.
5. Fargate runs as UID/GID 10001 with a read-only root; cloudflared runs as UID/GID 65532.
6. Immutable task definition, CloudFormation events/outputs and evidence hashes identify release.

No environment secret is baked into the image. Development adapters are rejected when
`NODE_ENV=production`.

# System architecture and trust boundaries

## End-to-end request path

| Step | Component              | Control                                                                         |
| ---: | ---------------------- | ------------------------------------------------------------------------------- |
|    1 | User browser           | HTTPS, supported browser/device, no AWS/database credential                     |
|    2 | Cloudflare edge        | certificate/TLS, DDoS, access policy, WAF and rate controls                     |
|    3 | Named Tunnel           | outbound connector token, no direct origin, catch-all 404                       |
|    4 | Fargate task loopback  | cloudflared to `127.0.0.1:8080`; app expects Cloudflare request marker          |
|    5 | Fastify BFF            | headers/CSP, route validation, session/CSRF/permission, safe error/logging      |
|    6 | Data/service adapter   | parameterised PostgreSQL transaction, AWS SDK workload identity or Cognito OIDC |
|    7 | PostgreSQL/AWS service | RLS/composite FK/IAM/resource policy/KMS/TLS/storage controls                   |
|    8 | Response               | allowlisted contract, redaction, private/no-store where authenticated           |

## Network topology

- three-AZ VPC; two NAT gateways in production;
- Fargate in private-with-egress subnets; Aurora/RDS Proxy in isolated subnets;
- service SG has no inbound rule and can reach only required outbound services/proxy;
- proxy accepts PostgreSQL only from service SG; database accepts only proxy and migration SG;
- migration, school-bootstrap and legacy-import tasks use the direct writer via the dedicated SG;
- no ALB, public application IP, public database or public S3 object;
- the tunnel CNAME is proxied and reveals no AWS origin.

## Availability and scaling

RC5 creates the private foundation at zero application tasks, runs migration/bootstrap, then
activates at three tasks and auto-scales 3-30 at 55% CPU; ongoing deployments use circuit-breaker
rollback. Aurora Serverless v2 runs 1-32 ACU with writer plus scale-with-writer reader. DynamoDB
uses on-demand billing. Capacity is not proof of service levels: client SLO, load/soak/failover
tests, quotas, NAT/Tunnel/IdP dependencies and measured restore RTO/RPO are required.

## Deployment unit

RC5 supports one school and exact hostname per production stack. This keeps global callback/base
URL, Tunnel ingress, Cognito RP/redirect and client evidence unambiguous. The database retains
`tenant_id`, RLS and composite tenant FKs as defence in depth and testable isolation. A later
multi-host topology requires an architecture decision and code/IaC changes; operators must not
bootstrap several clients into one RC5 stack.

# Frontend and experience architecture

## Public authentication client

The public bundle exposes only approved school branding, tenant-safe login configuration and buttons
for enabled methods. It contains no protected portal asset, business data, secret or database/AWS
SDK. `index.html` is no-store; hashed assets may be immutable. Server-side method policy remains the
authority even if a user crafts an auth-start URL.

## Protected portal client

The portal bundle and SPA fallback are mounted behind `requireSession`; unauthenticated users do not
receive them. Once delivered to an authenticated browser, client code is inspectable - obscurity is
not a security boundary. Every API call is still authenticated/authorised, and PostgreSQL repeats
tenant/permission enforcement.

The portal provides desktop navigation, mobile drawer/tabs, command search, account/session
controls, passkey enrolment, responsive cards/tables/forms/modals, loading/empty/error/conflict
states and synthetic-friendly visual hierarchy. Tailwind supplies design utilities/components; a
small source-controlled CSS layer composes repeated semantic classes.

## Functional modules retained

| Group             | Modules                                             |
| ----------------- | --------------------------------------------------- |
| Core              | Dashboard, Students, Families, Staff, Enrolments    |
| Academic          | Attendance, Timetables, Classes, Activities, Grades |
| Operations        | Finance, Forms, Communications, Events, Photos      |
| Community/content | Alumni, Knowledge Base                              |
| Control           | Sign in/out, Import/Export, Audit, Admin            |

Module visibility is tenant configuration; it does not grant permission. Dashboard/admin remain
required. Role permissions and API/database controls determine access.

## Accessibility/mobile quality gate

Required live verification covers WCAG-relevant keyboard, focus, landmarks, names, announcements,
contrast, non-colour meaning, reflow/zoom, reduced motion and assistive technology, plus real
devices from 320 CSS pixels through desktop, portrait/landscape, on-screen keyboard, safe areas,
long labels and slow networks. Visual quality is an acceptance criterion, not a substitute for
accessibility.

# API and application architecture

## Route groups

| Group             | Principal routes/capabilities                                     |
| ----------------- | ----------------------------------------------------------------- |
| Public/web        | `/`, `/auth`, `/auth/*`, public tenant and clean branding         |
| Health            | `/health/live`, `/health/ready` (blocked publicly by Cloudflare)  |
| Authentication    | start, callback, passkey registration, session, one-device logout |
| Dashboard         | bounded aggregated school overview                                |
| Resources         | allowlisted generic list/create/patch/delete for approved modules |
| Attendance        | roll load, optimistic mark save and submit workflow               |
| Files             | re-encoded student image upload, authorised private fetch         |
| Restricted crypto | session key, sensitive student read/write with recent MFA         |
| Audit             | tenant permission-scoped event view                               |
| Administration    | auth policy, modules, identity providers and role mappings        |

## Common request controls

- maximum body/multipart limits and Zod parsing;
- explicit resource/field allowlists; no user-supplied SQL identifier;
- parameterised SQL and transaction-local `tenant_id`, `user_id`, permissions and request ID;
- `requireSession`, permission, CSRF and recent-MFA hooks as applicable;
- Origin and Fetch Metadata checks for unsafe methods;
- global and route-specific rate limits plus Cloudflare edge limits;
- no client-provided request ID; validated Cloudflare Ray ID or server UUID;
- structured redacted logs and safe application error contract;
- optimistic row versions/idempotency for concurrency-sensitive flows;
- protected response cache policy and narrow public cache exceptions.

# Identity, MFA and session architecture

## School identity plane

Bootstrap creates one deletion-protected Cognito Plus user pool, confidential app client and
managed-login v2 prefix domain per school. The generated client secret goes directly to the exact
tenant-scoped Secrets Manager name; only the BFF workload role can read that suffix and uses
`client_secret_basic` in addition to PKCE. Local username is email. Self-sign-up is disabled;
initial admin is invited with a generated two-day forced-change password over verified SES. Password
policy is 15+ characters and 24-history, with password users required to complete TOTP.

Passkeys use choice-based `ALLOW_USER_AUTH`, user verification required and
`MULTI_FACTOR_WITH_USER_VERIFICATION`. Managed-login WebAuthn is bound to the Cognito domain. A
signed-in user initiates enrolment from the account menu through POST/CSRF; the BFF creates a fresh
PKCE/state/nonce/browser transaction to `/passkeys/add` and replaces the current device session on
the verified callback.

## OAuth/OIDC flow

1. Exact hostname resolves the active tenant and enabled method.
2. BFF generates 256-bit state/binding, nonce and PKCE S256 material; only hashes/transaction data
   are stored with five-minute TTL.
3. Browser authenticates at Cognito/local or approved external IdP.
4. Cognito returns one-time code + state to the exact HTTPS callback.
5. BFF consumes state, checks browser binding, reads the exact tenant client secret, performs a
   confidential server-side code exchange and verifies JWT signature/JWKS, issuer, audience, time
   and nonce.
6. Bounded directory claims establish/reconcile the internal identity.
7. Local completion re-reads live Cognito MFA/TOTP/WebAuthn enforcement; federated completion binds
   the signed Cognito provider identity to the exact configured provider. Drift or mismatch fails.
8. Cognito tokens are discarded; the browser receives only opaque device/session cookies.

## External federation and role differentiation

Cognito supports Entra/other OIDC, Google and SAML. Upstream callback is Cognito
`/oauth2/idpresponse` or `/saml2/idpresponse`; Edutex `/api/v1/auth/callback` is registered only on
the Cognito app client.

The administrator stores provider metadata/client material and explicit attribute mapping. The
client secret traverses the protected API once, is recorded in Secrets Manager and used to configure
Cognito; it is never returned. Provider rows and global provider-type switches both govern public
availability.

Claims are bounded; Cognito bracketed multi-values are decoded. Exact provider-scoped mappings
assign roles and the first-priority category. On every federated sign-in, stale directory-managed
`assigned_by IS NULL` roles are removed, current matches are added, and no match fails closed.
Explicit human role grants retain their assigner and require access review. Entra app roles are
preferred; standard Google OIDC does not provide Workspace groups, so group-based Google access
requires an approved SAML/custom-claim design.

## Session model

- random 256-bit reference and stable per-device cookie; only SHA-256 hashes stored;
- `__Host-`, Secure, HttpOnly, SameSite=Lax, Path=/ and no Domain in production;
- binding to device hash and privacy-hashed user agent;
- default 20-minute idle, 12-hour absolute and 10-minute high-assurance freshness;
- session/identity refresh every 60 seconds from current Edutex user/roles/modules;
- current-device logout deletes that session; another device remains independent;
- CSRF token returned only to authenticated client and held in JS memory;
- Cognito access/ID/refresh tokens never enter browser storage.

Session inventory/revoke-all is an explicit pre-launch product gap. Until implemented, emergency
response uses the restricted operational procedure and account disablement; general client launch
must close or validly handle that gate.

# Data and PostgreSQL architecture

## Database roles and connection paths

| Role/path                       | Authentication                                      | Network                    | Purpose                                        |
| ------------------------------- | --------------------------------------------------- | -------------------------- | ---------------------------------------------- |
| `edutex_app` via RDS Proxy      | short-lived RDS IAM token, `verify-full` TLS        | service SG to proxy only   | normal API transactions                        |
| `edutex_migrator` direct writer | generated secret injected by ECS, `verify-full` TLS | one-shot migration SG only | schema, bootstrap and controlled legacy import |
| Public/browser                  | none                                                | none                       | explicitly prohibited                          |

`edutex_app` is `NOINHERIT`; migration grants `rds_iam`. The long-running task cannot read the
migrator secret or reach the writer directly.

## Relational design rules

- UUID primary key on business entities; composite `(tenant_id,id)` unique key where relationships
  cross tenant-owned tables;
- foreign keys include tenant ID, preventing a valid other-school UUID from linking;
- stable natural-key uniqueness per tenant, typed enums/checks and temporal/balance constraints;
- targeted indexes, bounded pagination and explicit selected columns;
- row-level security enabled with tenant + permission/action policies;
- optimistic `row_version`, timestamps and update triggers;
- security-definer functions use fixed `search_path`, narrow purpose and revoked `PUBLIC` execute;
- no dynamic SQL identifiers from requests; parameterised values only;
- immutable checksummed forward migrations in lexical order and one transaction;
- financial journals reject changes after posting and require balance;
- audit table denies runtime mutation and chains tenant events cryptographically.

## Schema/domain inventory

| Domain                | Representative tables                                                                                                                        |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Tenancy/config        | tenants, tenant_domains, campuses, academic_years, terms, tenant_modules, module_layouts                                                     |
| Identity/access       | users, roles, permissions, role_permissions, user_roles, user_campuses, authentication_policies, identity_providers, directory_role_mappings |
| People                | students, student_sensitive_fields/tags/families, families, guardians, staff, departments, houses                                            |
| Academics             | subjects, classes, class_staff, class_students, timetable sets/periods/entries, activities/participants, assessments/grade_results           |
| Attendance/safety     | attendance sessions/marks/alerts, student_movements, sign_in_out_requests                                                                    |
| Enrolment/finance     | enrolment_applications, chart_of_accounts, journals/lines, budgets, invoices/lines, payments                                                 |
| Forms/comms/events    | forms/answers/submissions/review log, communications/templates/rules/recipients, events/participants                                         |
| Content/community     | files, knowledge_articles, alumni profiles/engagements/mentorships                                                                           |
| Operations/governance | idempotency, export jobs, webhooks, retention, legal holds, DSRs, incidents, access reviews, backup tests, risk acceptances                  |
| Evidence/migration    | `audit.events`, `migration.legacy_identifiers`                                                                                               |

The normative Database Standards appendix contains the complete table/constraint/migration rules.

## JSONB policy

JSONB is allowed only where shape is intrinsically dynamic, versioned or evidence/integration
oriented - for example form schema, bounded answers, redacted audit state, provider mapping and
webhook metadata. Every JSONB value has type/size validation, schema version/owner and query/index
justification. Stable identity, status, ownership, money, dates, relationships and tenant keys are
typed relational columns. Unknown prototype data is never dumped into JSONB as an import fallback.

# Cryptography, files, secrets and privacy

## Cryptographic inventory

| Purpose                | Mechanism                                              | Boundary                                          |
| ---------------------- | ------------------------------------------------------ | ------------------------------------------------- |
| Public transit         | Cloudflare TLS 1.2/1.3; HSTS at app                    | Edge certificate policy                           |
| Database transit       | PostgreSQL `verify-full`, AWS RDS CA                   | Proxy/direct private paths                        |
| AWS at rest            | rotating customer KMS keys                             | files, sessions/auth tx, backups, tenant data key |
| Restricted fields      | AES-256-GCM with random 96-bit IV and record-bound AAD | ciphertext in PostgreSQL                          |
| Browser wrapping       | ephemeral P-256 ECDH, HKDF-SHA-256, AES-GCM            | non-extractable in-memory browser key             |
| OAuth/session material | CSPRNG, SHA-256 hashes, timing-safe comparison         | one-time transaction/session stores               |
| Audit integrity        | per-tenant SHA-256 previous/event chain                | append trigger and operational verifier           |

Browser field encryption reduces plaintext impact of a database-only compromise. It is not end-to-
end protection against the Edutex service, an authorised browser, XSS or compromised KMS/API role.

## Files

Current uploads are images only: one file, 5 MiB transport limit, decoded/pixel constraints, Sharp
re-encode, metadata stripping, SHA-256 metadata, private/versioned/KMS S3 and authorised retrieval.
Object keys are not credentials. Non-image upload remains prohibited until quarantine, malware
scanning and clean promotion are implemented.

## Secrets

Use workload IAM wherever possible. Tunnel, generated DB bootstrap and external IdP credentials are
managed through Secrets Manager/Cognito with least role access, CloudTrail and rotation playbooks.
Terraform input/state/output, source, browser bundles, logs, evidence and screenshots must not
contain secret values. Secret exposure triggers revoke/rotate, task redeployment, connector/provider
inventory and incident review.

## Privacy/data governance

The schema supports retention policies, legal holds, data-subject requests, incidents and evidence,
but workers and lawful country/client workflows must be completed and validated before live personal
data. Data minimisation, purpose/legal basis, notices/consent, safeguarding, subject rights,
subprocessor/transfers, retention/disposal and breach obligations remain jointly technical and
organisational controls.

# AWS infrastructure architecture

## Production resources

- three-AZ VPC, two NAT gateways, Flow Logs and restricted default SG;
- private ARM64 ECS cluster/service/task with application + pinned cloudflared sidecar;
- isolated Aurora PostgreSQL 16.6 Serverless v2 writer/reader and IAM/TLS RDS Proxy;
- dedicated schema, school-bootstrap and legacy-import Fargate task definitions;
- private versioned KMS S3 with export/migration lifecycle;
- KMS DynamoDB sessions/auth transactions with PITR and TTL;
- rotating KMS keys for sessions, files and tenant encrypted fields;
- one-year KMS CloudWatch application/connector/migration logs and RDS PostgreSQL logs;
- AWS Backup vault/plan, continuous/daily protection, monthly archive and production Vault Lock;
- CloudFormation parameters for exact public hostname and pre-created tunnel-token secret ARN;
- outputs for cluster, proxy, files bucket, three one-shot tasks, migration SG and private subnets.

## Responsibility boundary

The stack does not create organisation-wide CloudTrail, Security Hub, GuardDuty, Config, Inspector,
budgets, central SIEM/on-call, SES identity/configuration set or AWS account federation. Those must
already exist or be created by the platform/security management system and proven before live use.

# Cloudflare edge architecture

## Terraform ownership

Terraform owns one proxied CNAME, one remotely managed tunnel configuration and the Edutex custom,
managed and rate-limit rules. Production uses encrypted/versioned KMS S3 state with native lockfile;
local state is prohibited. Provider selection is retained in `.terraform.lock.hcl` and a saved plan
receives two-person approval.

Cloudflare permits one zone entry-point ruleset per phase. Existing custom/managed/rate rulesets
must be inventoried, imported and merged or retained under shared ownership; an Edutex apply must
not silently replace other zone controls.

## Policy semantics

- exact hostname CNAME to tunnel, proxied;
- tunnel ingress `http://127.0.0.1:8080`, host header set, catch-all 404;
- optional whole-site CIDRs/countries; with both lists, accepted IP **or** accepted country passes;
- independent admin path CIDR policy;
- unexpected methods, `.env/.git/wp-admin/phpMyAdmin` probes and public health blocked;
- Cloudflare Managed Ruleset and OWASP Core Ruleset, PL3;
- auth threshold 20/minute with ten-minute block; API threshold 600/minute with challenge;
- optional bot score rule only when licensed.

Authenticated Origin Pulls are not compatible with Tunnel and are not enabled. TLS minimum 1.2, TLS
1.3 and HTTPS redirect are target-zone settings. Cache respects authenticated `no-store/private`
responses; public tenant/clean branding use bounded cache.

# Governance and management systems

## ISO/IEC 27001 target

The ISMS must define scope/context/interested parties, leadership/policy, risk method/criteria,
Statement of Applicability, objectives, competence/awareness, documented information, operational
planning/control, performance evaluation, internal audit, management review and continual
improvement. Annex A control applicability/evidence is recorded in the pre-SoA; exclusions need a
reason, owner and approval. Climate-change context from Amendment 1:2024 is considered in context
and interested-party analysis.

## ISO 9001 priority

The QMS governs customer/requirements traceability, risk/opportunity, design/development, supplier
control, release acceptance, nonconformity/CAPA, competence, documented information, metrics,
internal audit and management review. Quality means correct, secure, accessible, supportable school
outcomes - not simply a passing build.

## OWASP verification

ASVS 5.0.0 Level 2 is the application baseline, with selected Level 3 requirements for
authentication, session, cryptography, tenancy and audit. The Top 10 and API Top 10 are threat
catalogues, not check-box certifications. Each matrix row identifies design/source evidence and live
evidence still required. Independent testing maps findings to ASVS/CWE and requires systemic fix,
regression test and retest.

## Risk/CAPA lifecycle

Risk uses likelihood/impact 1-5. Scores 15-25 require treatment and executive/security acceptance of
any remainder; 8-12 require owner/date and security acceptance; 1-6 may be accepted by the service
owner if monitored. Incidents, audit findings, test failures and nonconformities trigger root cause,
corrective action, effectiveness review and risk/SoA/standard updates. No acceptance may override
law, contract or absolute policy.

# Operations and service management

## Deployment/change model

Production order is fixed: authorise; establish account/security baselines; verify source/scans;
prepare SES; apply reviewed Cloudflare plan; store tunnel token; review/deploy CDK; run schema task;
bootstrap school; configure/test identity; plan/rehearse/reconcile data; run live security/restore/
accessibility gates; approve cutover. The companion Deployment & Setup Guide contains exact
commands, expected output and troubleshooting.

## Monitoring/on-call

Centralise Cloudflare, Cognito, CloudTrail, application, RDS/pgAudit, VPC Flow Logs, ECS, DynamoDB,
S3/KMS, Backup and SES. Alerts require synthetic effectiveness tests, UTC correlation, named
on-call, runbook link and acknowledge/escalate targets. Logging excludes bodies, secrets, cookies,
OAuth tokens/codes, TOTP/passkey material and restricted plaintext.

## Backup/continuity

Architecture supplies 35-day Aurora/continuous backup, Dynamo PITR, S3 versioning and monthly
2555-day archive/Vault Lock. Quarterly restore goes to isolated new resources, clears sessions,
checks schema/RLS/audit/data/KMS/two-tenant operation, measures RPO/RTO and destroys test data. IdP,
Cognito, Cloudflare and SES recovery are separate configuration/control-plane responsibilities.

## Incident response

Critical events include cross-tenant disclosure, RCE, privileged takeover and key/DB exfiltration;
target acknowledgement is 15 minutes. Workflow: declare, preserve, contain precisely, investigate,
eradicate/recover, notify under Legal/Privacy, and close with CAPA/effectiveness review. Tunnel/IdP/
session/database/KMS scenarios have dedicated actions. Never destroy evidence or open a public
origin as containment.

## Penetration testing

Entry requires production-like live gates, restore, two-tenant tests, scans and signed scope.
Third-party AWS/Cloudflare/Microsoft/Google infrastructure is not automatically authorised. Rules
limit data, rate, DoS/social engineering/persistence/destruction/supplier pivoting and evidence
handling. Critical/high findings are immediate and block release until retested or validly accepted.

# Migration architecture and matrix

## Migration principles

The original export is frozen, encrypted and hashed. Plan mode validates format/digest/counts
without database access. A KMS/private S3 staging copy is readable only by the one-shot legacy task
and expires after eight days. Apply uses the migrator writer path and one transaction. Stable
student legacy IDs and natural-key upserts support deterministic rehearsal, but independent
reconciliation and business-owner signature remain mandatory.

## Automated versus manual scope

| Module/domain                          | RC5 import                                | Required treatment                                                   |
| -------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------- |
| Students                               | Core automated                            | map families/tags/houses/photos/restricted fields/status beyond core |
| Families                               | Core family automated                     | guardians and relationship/consent joins manual                      |
| Staff                                  | Core automated                            | departments/campuses/roles manual                                    |
| Classes                                | Core automated                            | subject/teacher/student/capacity details beyond core manual          |
| Calendar                               | Bootstrap creates one current year/campus | historical campuses/years/terms require mapping                      |
| Identity                               | Never import password/session             | provision through Cognito/SSO and reviewed role mappings             |
| Timetable/activities/attendance/grades | Model exists, not automated               | typed transformations and business reconciliations                   |
| Finance                                | Model exists, not automated               | accountant-approved chart/journal/invoice/payment totals             |
| Forms/comms/events/alumni/content      | Model exists, not automated               | sanitisation, consent, versioning and joins                          |
| Files/photos                           | Re-upload only                            | production re-encode/authorisation pipeline                          |
| Audit/history                          | Not merged into new chain                 | retain legacy evidence separately with provenance                    |

Unknown fields never fall back to generic JSONB. A field without
target/default/rejection/reconciliation and owner decision blocks apply.

# Ownership and RACI

| Activity                  | Accountable             | Responsible                   | Consulted                            | Evidence consumer         |
| ------------------------- | ----------------------- | ----------------------------- | ------------------------------------ | ------------------------- |
| Product requirements/UAT  | Product/client owner    | Product/QA                    | Teachers/staff/accessibility/privacy | Release Manager           |
| Code/contracts            | Engineering Lead        | Engineers                     | Security/DBA/QA                      | Reviewer/auditor          |
| Database/schema/migration | Data Owner/DBA          | Data Engineering              | App/Security/client SMEs             | Release/client approver   |
| AWS platform              | Platform Owner          | Cloud Engineering             | Security/Finance/DR                  | SOC/auditor               |
| Cloudflare edge           | Edge Owner              | Platform/Security             | Client network                       | SOC/release approver      |
| Cognito/SSO/mappings      | IAM Owner               | Identity Engineering          | Client directory/security            | Access reviewer           |
| Privacy/retention/DSR     | Privacy/Data Controller | Privacy/Operations            | Legal/Engineering                    | Regulator/auditor         |
| Release/change            | Release Manager         | Deployment operator           | All owners                           | Client/service owner      |
| Monitoring/incident       | Security/Service Owner  | SOC/on-call                   | Legal/Privacy/client liaison         | Management/auditor        |
| Backup/restore            | Service Owner           | Platform/DBA                  | Security/Data Owner                  | Client/auditor            |
| Penetration test          | Security Owner          | Authorised independent tester | Platform/Product/Legal               | Risk/release authority    |
| ISO/QMS audit/CAPA        | Executive management    | ISMS/QMS managers             | All control owners                   | Internal/external auditor |

# Document and evidence map

| Source document                                   | Purpose                                                    |
| ------------------------------------------------- | ---------------------------------------------------------- |
| `README.md`                                       | project orientation, status, layout and deployment summary |
| `PRODUCTION_ARCHITECTURE.md`                      | component/trust/network/availability decisions             |
| `SECURITY_ARCHITECTURE.md`                        | threats, auth/session/data/crypto/header model             |
| `CODEBASE_STANDARDS.md`                           | module, TypeScript, API, frontend, test/review rules       |
| `DATABASE_STANDARDS.md`                           | naming/types/keys/RLS/migration/SQL/audit rules            |
| `DATABASE_OBJECT_CATALOG.md`                      | every SQL migration, function, trigger and table domain    |
| `OWASP_ASVS_5_MATRIX.md`                          | application verification evidence/gaps                     |
| `ISO27001_STATEMENT_OF_APPLICABILITY.md`          | technical pre-SoA and operating evidence                   |
| `ISO9001_QUALITY_PLAN.md`                         | quality objectives/processes/metrics/CAPA                  |
| `RISK_REGISTER.md`                                | scored risks, treatment, owner/due/state                   |
| `MIGRATION_MATRIX.md`                             | prototype collection/module treatment                      |
| `DEPLOYMENT_RUNBOOK.md`                           | concise controlled deployment order                        |
| `Edutex_Production_Deployment_and_Setup_Guide.md` | exhaustive companion setup procedure                       |
| `BACKUP_RESTORE.md`                               | protection, restore, RPO/RTO evidence                      |
| `INCIDENT_RESPONSE.md`                            | severity, roles, workflow and scenarios                    |
| `PENETRATION_TEST_READINESS.md`                   | scope, rules, themes and closure                           |
| `SECURITY.md`                                     | vulnerability reporting/handling policy                    |
| `CONTRIBUTING.md`                                 | contributor quality/security workflow                      |
| `CHANGELOG.md`                                    | release evolution and RC5 corrections                      |

\part{Normative source-controlled project documentation}

The following chapters are incorporated from the repository without replacing their source
authority. Where a concise runbook conflicts with the companion exhaustive setup guide, the RC5
guide's corrected command and explicit release gate applies; raise and correct the source conflict
through change control.

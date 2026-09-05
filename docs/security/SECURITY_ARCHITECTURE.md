# Security architecture and threat model

Document owner: Information Security  
Version: 1.0.0-rc.5 / 2026-08-12

## Assurance statement

This implementation is designed for verification against OWASP ASVS 5.0.0, with the highest
applicable requirements selected for authentication, sessions, cryptography and tenant isolation. It
is not a declaration of blanket “OWASP compliance,” ISO certification or immunity from attack.
Controls that require a live environment, an operating process or independent evidence remain open
until tested and approved.

## Protected assets

1. Student identity, safeguarding, health, attendance, grades and family relationships.
2. Staff identity, employment and directory claims.
3. Authentication factors, sessions, IdP client secrets and recovery processes.
4. Financial journals, invoices and payment records.
5. Tenant configuration, permissions, audit evidence and cryptographic keys.
6. Availability of school operations and integrity of timetable/attendance decisions.

## Principal threats and controls

| Threat                           | Preventive controls                                                                           | Detective/recovery controls                                        |
| -------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Direct-origin/WAF bypass         | Outbound Tunnel, no public IP/LB/ingress, CF-Ray gate and exact stack-provided Host allowlist | VPC flow logs, Cloudflare analytics                                |
| Credential stuffing              | Cloudflare/API rate limits, Cognito threat protection, passkeys/TOTP                          | Cognito/CloudTrail alerts and incident playbook                    |
| OAuth login CSRF/replay          | Code + PKCE S256, 256-bit state/nonce, one-time Dynamo record, browser binding                | Rejected transaction logs and request correlation                  |
| Session theft/sharing            | Opaque 256-bit token, HttpOnly `__Host-` cookies, device + UA binding, idle/absolute TTL      | Single-session deletion; identity refresh disables stale access    |
| CSRF                             | SameSite cookies, in-memory CSRF token, Origin and Fetch Metadata checks                      | Structured 403 events                                              |
| XSS/content injection            | React escaping, strict CSP, no inline/eval, no third-party scripts, server validation         | WAF signals and CSP deployment monitoring                          |
| SQL injection                    | Parameterized values and source-controlled identifier allowlist                               | PostgreSQL logging, WAF, code review                               |
| BOLA/IDOR or cross-tenant access | Permission hooks, tenant predicates, RLS, composite tenant FKs                                | Hash-chained audit and cross-tenant tests                          |
| Mass assignment                  | Per-resource property allowlist and Zod schemas                                               | Validation failures and tests                                      |
| File polyglots/metadata          | Image-only MIME allowlist, 5 MiB limit, pixel limit, Sharp re-encode                          | File hash/metadata and private S3 records                          |
| Database disclosure              | Private isolated DB, IAM/TLS runtime, KMS at rest, browser encryption for selected fields     | CloudTrail/RDS logs, key rotation, restore capability              |
| Secret disclosure                | No source secrets, Secrets Manager injection, IAM roles, log redaction                        | Secret scanning, CloudTrail and rotation playbook                  |
| Audit tampering                  | Runtime cannot insert/update/delete audit rows; trigger capture and per-tenant hash chain     | Periodic chain verification and external log retention             |
| Supply-chain compromise          | Lockfile installs, runtime audit gate, non-root minimal image, Dependabot                     | SBOM, image scanning and signed release evidence (deployment gate) |

## Authentication flow

![Edutex authorization-code authentication sequence](docs/assets/authentication-flow.png)

Password users are challenged for TOTP when the school selects required MFA. A passkey configured
with user verification and Cognito `MULTI_FACTOR_WITH_USER_VERIFICATION` can satisfy the same
policy. The confidential app client enables `ALLOW_USER_AUTH`; its generated secret is stored only
in tenant-scoped Secrets Manager and used by the BFF as `client_secret_basic` in addition to PKCE.
WebAuthn is bound to the Cognito managed-login domain, and administrator-created users enrol through
a CSRF/state/nonce/PKCE/browser-bound `/passkeys/add` transaction. Local callback completion
re-reads Cognito's authoritative MFA/TOTP/WebAuthn settings and fails closed when they differ from
the database policy. External IdP assurance is accepted only from configured `amr`/`acr` or mapped
assurance values; the signed Cognito `identities` provider must exactly match the one-time
transaction, and absent assurance claims are treated as single-factor for sensitive step-up. Real
Microsoft, Google and SAML tenant tests must confirm claim shape before enabling production access.

Every newly created external identity provider is staged as disabled. It cannot be published until
an administrator has created at least one exact provider-scoped role mapping and then performs a
separate, concurrency-controlled enable action. Reconfiguring an existing provider withdraws it
before changing its upstream Cognito trust configuration and requires explicit republication.
PostgreSQL `bigint` row versions are converted to JSON numbers at the API boundary so the
administration client can reliably detect and reject stale policy, module and provider changes
instead of silently overwriting a newer decision.

Federated multi-value claims are decoded from Cognito's bounded bracketed representation. On every
federated sign-in, current provider-scoped mappings are re-evaluated, stale directory-managed roles
are removed and no-match fails closed. Active sessions still depend on the Edutex user status/stored
role refresh until the next upstream authentication; the leaver process must disable the Edutex
identity/revoke sessions, and session inventory/revoke-all remains a pre-launch product gate.

## Session lifecycle

- A successful authentication always creates a new random session and replaces only the current
  browser’s prior session.
- The browser receives no Cognito access, ID or refresh token. The API discards the exchange result
  after validating the ID token and establishing internal identity.
- Sessions are individually device bound and stored as hashes. Multiple approved devices may hold
  separate sessions; logout invalidates the current one.
- Authorization/disablement is refreshed every 60 seconds. Idle expiry slides in bounded increments
  but never exceeds absolute expiry.
- Sensitive-key access requires a recent high-assurance timestamp. A fresh Cognito interaction uses
  `prompt=login`; missing assurance claims fail closed.

An administrator-facing list/revoke-all-sessions workflow is a pre-launch requirement recorded in
the ASVS matrix and risk register; current account disablement takes effect within the refresh
window.

## Data protection model

| Class        | Examples                                                         | Required handling                                                 |
| ------------ | ---------------------------------------------------------------- | ----------------------------------------------------------------- |
| Public       | School name, approved logo, login choices                        | Exact verified hostname; bounded cache                            |
| Internal     | Timetable labels, non-sensitive configuration                    | Authenticated, tenant scoped, no public cache                     |
| Confidential | Student/staff/family records, grades, finance                    | Least privilege, RLS, TLS, KMS at rest, audit                     |
| Restricted   | Safeguarding, health and learning-adjustment notes               | Recent MFA, field permission, browser AES-GCM, no-store           |
| Secret       | Session tokens, IdP secrets, DB bootstrap password, KMS material | Never log/store in source; Secrets Manager/KMS; shortest lifetime |

Client-side encryption reduces database disclosure risk; it is not end-to-end encryption against the
Edutex service. The API temporarily unwraps the tenant data key under an authorized IAM role and can
therefore be a point of compromise. The browser key is non-extractable and memory-only, but
authorized JavaScript can use it. CSP, protected bundle delivery and XSS prevention remain
essential.

## Cryptographic inventory

| Purpose              | Mechanism                                             | Key/lifecycle owner                                  |
| -------------------- | ----------------------------------------------------- | ---------------------------------------------------- |
| Public HTTPS         | Cloudflare TLS 1.2/1.3 policy                         | Cloudflare certificate automation                    |
| Database transit     | PostgreSQL TLS verify-full, AWS global RDS CA         | AWS/RDS CA lifecycle                                 |
| AWS data at rest     | Customer-managed KMS keys with rotation               | Platform security                                    |
| Restricted fields    | AES-256-GCM, random 96-bit IV, record-bound AAD       | Per-tenant encrypted data key                        |
| Browser key delivery | P-256 ECDH + HKDF-SHA-256 + AES-256-GCM               | Ephemeral per request, five-minute browser reference |
| Session/state tokens | Node CSPRNG, SHA-256 stored hash, timing-safe compare | Per authentication/session                           |
| Audit integrity      | SHA-256 per-tenant event chain                        | PostgreSQL trigger, operational verifier             |
| Cognito assertions   | RS256/JWKS with issuer/audience/time/nonce validation | AWS Cognito key rotation                             |

## Security headers and caching

Production uses HSTS for two years including subdomains/preload, CSP `default-src 'self'`, no
objects, no frames, no inline script/style, same-origin isolation policies, no-referrer and a
restrictive Permissions-Policy. API, auth and portal responses are `no-store`; immutable hashed
authentication assets may be cached but `index.html` is not. Source maps are disabled.

## Residual dependencies

Security also depends on Cloudflare account protection, AWS Organizations/SCPs, IAM Identity Center,
CloudTrail/Security Hub/GuardDuty configuration, SES domain security, school IdP settings, endpoint
health, personnel screening, supplier management and incident response. These are deployment/ISMS
controls and cannot be embedded solely in this repository.

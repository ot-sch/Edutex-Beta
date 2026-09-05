# OWASP application security verification matrix

Release baseline: 1.0.0-rc.5 / 2026-08-12

Baseline: OWASP ASVS 5.0.0 Level 2 for all applicable requirements, with selected Level 3
requirements for authentication, session management, authorization, cryptography and logging. Threat
catalogues: OWASP Top 10:2025 and OWASP API Security Top 10:2023. Development-maturity reference:
OWASP SAMM.

This is an implementation evidence index, not an OWASP certification or a substitute for executing
the official requirement-by-requirement test workbook. Status meanings:

- **Implemented**: a source/infrastructure control exists and has local evidence.
- **Partial**: material control exists, but an applicable part or live evidence remains.
- **Operational**: the deploying organisation must configure/operate and retain evidence.
- **N/A**: the technology/function is not present; re-evaluate if scope changes.

## Chapter coverage

| ASVS 5 chapter                          | Status      | Principal evidence                                                                                                                                                                                         | Required live evidence / gap                                                                              |
| --------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| V1 Encoding and Sanitization            | Implemented | Zod boundaries; React escaping; parameterized SQL; identifier allowlist; no eval/HTML injection API                                                                                                        | DAST/fuzz validation and CSV export review if exports are activated                                       |
| V2 Validation and Business Logic        | Partial     | Bounded schemas, PostgreSQL checks, transactions, row versions, balanced journals                                                                                                                          | Model dual approval for high-value finance/admin actions; business-flow abuse tests                       |
| V3 Web Frontend Security                | Implemented | `__Host-` cookies, HttpOnly/Secure/SameSite, strict CSP/HSTS, Fetch Metadata, no source maps                                                                                                               | Browser matrix, header scan, accessibility/security interaction test                                      |
| V4 API and Web Service                  | Implemented | JSON REST only, method allowlist, body limits, stable errors, no GraphQL/WebSocket                                                                                                                         | Cloudflare-to-Fastify request-smuggling and cache tests                                                   |
| V5 File Handling                        | Partial     | Image-only types, 5 MiB limit, 40 MP limit, Sharp re-encode, generated key, private S3                                                                                                                     | Add managed malware scan/quarantine before any non-image upload feature                                   |
| V6 Authentication                       | Partial     | Cognito Plus, 15-character composition-neutral password policy, threat protection, TOTP, passkey MFA, short random initial password, anti-enumeration                                                      | Real tenant factor recovery tests; external IdP assurance claim validation; compromised-password evidence |
| V7 Session Management                   | Partial     | 256-bit opaque tokens, server-side hash, device/UA binding, idle/absolute TTL, rotation, current-session revoke                                                                                            | User/admin session inventory and revoke-all workflow; prove IdP/RP logout behavior                        |
| V8 Authorization                        | Implemented | Deny-by-default permissions, property allowlists, tenant transaction, RLS, composite tenant FKs, 60-second identity refresh                                                                                | Automated two-tenant integration suite against live PostgreSQL/runtime role                               |
| V9 Self-contained Tokens                | Implemented | Cognito JWT signature, issuer, audience, expiry/max age and nonce verification using trusted JWKS                                                                                                          | Key-rotation and malformed/JWT confusion test against live pool                                           |
| V10 OAuth and OIDC                      | Implemented | Backend-for-frontend, code + PKCE S256, state, nonce, one-time transaction, browser binding, exact callback                                                                                                | Microsoft/Google/OIDC/SAML conformance and mix-up tests per configured tenant                             |
| V11 Cryptography                        | Partial     | KMS rotation, AES-256-GCM, P-256 ECDH, HKDF-SHA-256, CSPRNG, timing-safe compare, key context                                                                                                              | Approved cryptographic policy/inventory, rotation exercise, independent protocol review, PQC roadmap      |
| V12 Secure Communication                | Operational | Cloudflare HTTPS, outbound Tunnel, RDS Proxy TLS required, PostgreSQL verify-full                                                                                                                          | Account TLS policy/cipher evidence, ECH decision, external scan, certificate-expiry alert                 |
| V13 Configuration                       | Partial     | Secrets Manager, IAM roles, private subnets, non-root container; RC5 validates exact account/region/ARN/hostname, state KMS/versioning/ownership/TLS policy and SES production readiness before plan/apply | AWS SCP/Config/Security Hub evidence; egress allowlisting; rotate tunnel/IdP secrets                      |
| V14 Data Protection                     | Partial     | Classification, no-store, log redaction, no browser storage, KMS, restricted browser encryption, retention tables                                                                                          | Data inventory/ROPA, deletion worker evidence, DLP, privacy review and retention jobs                     |
| V15 Secure Coding and Architecture      | Partial     | Strict TypeScript/lint, lockfile, runtime audit, workspaces, mass-assignment defense, minimal image; RC5 AST gate documents every maintained implementation                                                | Sign/provenance container, release SBOM archive, SAST/DAST/SCA service evidence                           |
| V16 Security Logging and Error Handling | Partial     | Structured/redacted logs, request IDs, UTC, append-only hash-chained DB audit, one-year log groups                                                                                                         | Central SIEM alerts, denied-authz audit completeness, chain verifier, access/retention evidence           |

## Selected requirement evidence

| Requirement                     | Intended verification                                      | Evidence                                                                                                                                                                                       |
| ------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| v5.0.0-1.2.4                    | Database injection prevention                              | `apps/api/src/modules/resources/routes.ts`; all values parameterized; identifiers registry-only                                                                                                |
| v5.0.0-2.2.2                    | Trusted service-layer validation                           | Zod schemas in contracts/routes; database constraints remain authoritative                                                                                                                     |
| v5.0.0-3.3.1 / 3.3.3 / 3.3.4    | Secure host-only session cookies                           | `apps/api/src/modules/auth/session.ts`                                                                                                                                                         |
| v5.0.0-3.4.1                    | HSTS                                                       | Helmet production policy with two-year max age, subdomains and preload                                                                                                                         |
| v5.0.0-4.1.4                    | Allowed HTTP methods only                                  | Cloudflare custom WAF method rule; registered Fastify routes                                                                                                                                   |
| v5.0.0-5.2.1 / 5.2.2 / 5.2.6    | File size, content/type and pixel safety                   | Multipart limits and Sharp decode/re-encode in file routes                                                                                                                                     |
| v5.0.0-6.3.3                    | MFA or combined factors                                    | Cognito required MFA for passwords; verified passkey counts as MFA; callback re-reads live Cognito enforcement and fails closed on drift                                                       |
| v5.0.0-6.4.1                    | Secure short-lived initial factor                          | CSPRNG temporary admin password; Cognito two-day validity and forced change                                                                                                                    |
| v5.0.0-6.8.1 / 6.8.2            | IdP namespacing and signed assertions                      | Per-tenant Cognito pool/provider; API validates token and signed `identities` provider against the one-time transaction; providers stage disabled and require exact mapping before publication |
| v5.0.0-6.8.4                    | Authentication assurance from IdP                          | `amr`, `acr`, mapped `custom:authentication_assurance`; unknown is low assurance                                                                                                               |
| v5.0.0-7.2.1 / 7.2.3 / 7.2.4    | Backend session verification, entropy and rotation         | Opaque 32-byte token; server-side Dynamo lookup; new token on every authentication                                                                                                             |
| v5.0.0-7.3.1 / 7.3.2            | Idle and absolute timeout                                  | Per-tenant bounded policy and server-side timestamps                                                                                                                                           |
| v5.0.0-7.4.1                    | Terminated session unusable                                | Atomic Dynamo delete on logout/expiry; current cookie cleared                                                                                                                                  |
| v5.0.0-7.5.3                    | Step-up for sensitive action                               | Recent assurance gate on restricted key release and mutation                                                                                                                                   |
| v5.0.0-8.2.1 / 8.2.2 / 8.2.3    | Function, object and field authorization                   | Permission hooks, tenant RLS, property registry and sensitive-field permissions                                                                                                                |
| v5.0.0-8.4.1                    | Cross-tenant control                                       | Tenant key on every table, RLS and tenant-composite foreign keys                                                                                                                               |
| v5.0.0-9.1.1 / 9.1.3            | Signed token and trusted key source                        | `jose` RemoteJWKSet built only from expected Cognito issuer                                                                                                                                    |
| v5.0.0-9.2.1 / 9.2.3            | Token time and audience                                    | `jwtVerify` issuer/audience/max age and library expiry validation                                                                                                                              |
| v5.0.0-10.1.1                   | Tokens only at BFF                                         | OAuth tokens consumed in API and never returned to browser/session store                                                                                                                       |
| v5.0.0-10.1.2 / 10.2.1 / 10.5.1 | Transaction binding, PKCE/state/nonce                      | One-time Dynamo transaction, independent HttpOnly browser binding and confidential-client authentication from tenant-scoped Secrets Manager                                                    |
| v5.0.0-11.3.2 / 11.3.3 / 11.3.4 | Authenticated encryption and unique IV                     | Web Crypto AES-256-GCM and random 96-bit IV with tenant/record AAD                                                                                                                             |
| v5.0.0-11.5.1                   | At least 128-bit CSPRNG secrets                            | 256-bit state/session/CSRF values from Node CSPRNG                                                                                                                                             |
| v5.0.0-12.3.1 / 12.3.2          | Encrypted internal connections with certificate validation | RDS CA bundle, `verify-full`, TLS-required proxy                                                                                                                                               |
| v5.0.0-13.3.1 / 13.3.2          | Vault and least-privilege secrets                          | Secrets Manager and separate ECS execution/task roles                                                                                                                                          |
| v5.0.0-14.3.2 / 14.3.3          | No-cache and no sensitive browser storage                  | `no-store`; no local/session/IndexedDB use; memory-only CSRF and data keys                                                                                                                     |
| v5.0.0-15.3.1 / 15.3.3          | Minimum fields and mass-assignment prevention              | Resource registry selects/accepts explicit fields only                                                                                                                                         |
| v5.0.0-16.2.5                   | Sensitive log handling                                     | Fastify redaction paths and audit-state secret/ciphertext removal                                                                                                                              |

## RC5 deployment-control evidence

The deployment assistant strengthens configuration and supply-chain verification but does not turn
repository status into OWASP certification. `deploy:new` rejects credentials/placeholders and
cross-field inconsistencies; `deploy:check` is read-only and proves the selected production
identity/state/key/email prerequisites; `deploy:plan` runs the complete quality/runtime audit and
binds human-readable plans to source/configuration/binary-plan/provider-lock hashes; `deploy:apply`
requires exact human confirmations, expected artifact paths, an active approved window and unchanged
bytes. The private application count remains zero until migration and bootstrap exit successfully.
Independent live ASVS verification and the mandatory closure list below remain unchanged.

## OWASP Top 10:2025 and API Top 10:2023 cross-check

Broken access/object/function/property authorization maps to API permission hooks, RLS and field
allowlists. Misconfiguration maps to CDK/Terraform, production validation and WAF. Supply-chain risk
maps to the lockfile, runtime audit, SBOM and immutable image evidence. Injection maps to schemas,
parameterized SQL and React encoding. Authentication/session failures map to Cognito, MFA/passkeys,
one-time OAuth transactions and opaque sessions. Logging/alerting risk maps to the audit chain and
the open SIEM evidence item. SSRF is constrained to public HTTPS configuration endpoints and must be
retested when new outbound integrations are added.

## Mandatory closure before client production data

1. Import the official ASVS 5.0.0 CSV into the assurance tracker, determine applicability for every
   requirement and attach pass/fail evidence - not only chapter summaries.
2. Implement session inventory plus current/all-device administrative revocation.
3. Execute external IdP MFA/role claim tests for each school and lock approved claim mappings.
4. Run SAST, DAST, dependency, image, IaC and secret scans in the permanent CI platform.
5. Run a two-tenant integration suite using the real `edutex_app` role and production RLS policies.
6. Configure central alerts and independently verify audit-chain continuity.
7. Complete independent penetration testing and remediate findings by risk before go-live.

Source standard: <https://owasp.org/www-project-application-security-verification-standard/>.

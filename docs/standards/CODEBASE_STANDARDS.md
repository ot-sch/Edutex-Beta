# Edutex codebase standards

Release baseline: 1.0.0-rc.5 / 2026-08-12

Normative language: **must** is mandatory, **should** requires documented justification to deviate,
and **may** is optional. These rules apply to application, infrastructure, migration and test code.

Document owner: Engineering  
Approval: Engineering Lead + Security Lead  
Review cycle: at least annually and after a material incident or architecture change

## 1. Repository and ownership

1. A workspace owns one cohesive responsibility. Browser UI, API, contracts, database and
   infrastructure must remain independently identifiable.
2. Production entry points must be explicit. `index.html` may bootstrap one web client; it must not
   contain application logic, patches, credentials, inline scripts or inline styles.
3. A module must contain its routes/components, domain types and focused tests. Shared code is moved
   to a shared package only after two real consumers exist.
4. Generated output (`dist`, `cdk.out`, coverage, PDFs, SBOMs) must not be edited by hand or used as
   the review source.
5. Every component has an accountable owner in the release record. CODEOWNERS should be configured
   when the source is connected to its permanent repository.

## 2. TypeScript and module rules

- Use ESM, TypeScript strict mode, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
  `useUnknownInCatchVariables`, `verbatimModuleSyntax` and `isolatedModules`.
- Do not use `any`, non-null assertions or unsafe type casts to bypass validation. Boundary values
  start as `unknown` and are parsed once with a Zod schema.
- Import types with `type`. Prefer immutable `readonly` interfaces and pure functions.
- Names describe the business concept, not an implementation accident. Files use lowercase
  kebab-case except React components, which use PascalCase.
- Functions should normally do one thing and fit on one screen. Split orchestration from parsing,
  authorization, persistence and external side effects.
- A dynamic SQL identifier, redirect path, provider key, file type or algorithm must come from a
  source-controlled allowlist - not from an assertion that user input is safe.

## 3. Comments and documentation

Every maintained TypeScript, TSX and JavaScript-module file must start with an `@fileoverview` that
states its responsibility, direct dependencies and relevant trust/security boundary. Every
implemented function—including private helpers, methods, constructors, React effects and handlers,
array predicates/mappers, transaction callbacks and test callbacks—must have a directly attached,
meaningful comment. The comment identifies what the function does, what calls or resource it links
to, important inputs/outputs or side effects, and its fail/authorization behavior when relevant.

`npm run source:docs` parses the source syntax tree and fails when a file overview or implemented
function comment is absent. It is the first stage of `npm run quality`, so undocumented executable
behavior cannot pass the repository release gate. Generated output is excluded. Existing immutable
SQL migrations are never edited merely to add comments because their checksums are a production
integrity control; the database standards and object catalogue explain those objects instead, and
new migrations must contain an explicit purpose/security header before review.

Comments must explain **why**, invariants and threat decisions. They must not narrate obvious syntax
or claim guarantees that the code cannot prove. Update or remove a comment in the same change that
alters its behavior. Complex business logic requires an adjacent test whose name restates the
expected rule.

API contracts, data classifications, session policy, retention, external connections and operating
limits belong in versioned documentation as well as code. Documentation changes follow the same
review path as code.

## 4. Input, output and business logic

1. Validate path, query, header, cookie, body, file and external-service values at their trusted
   service boundary. Client validation is usability only.
2. Prefer positive allowlists, exact enums and bounded lengths/ranges. Reject unknown properties.
3. Normalize only after a documented canonicalization rule; never repeatedly decode input.
4. Use React’s escaped text rendering. Do not use `dangerouslySetInnerHTML`, `eval`, dynamic
   function construction or runtime template compilation.
5. Error responses expose a stable code, safe message and request ID. Stack traces, SQL details,
   provider responses and secret identifiers stay in protected logs.
6. Multi-step business changes use a database transaction and idempotency key where retries are
   possible. High-value approvals must be modeled explicitly, not inferred from UI state.
7. Optimistic concurrency (`row_version`/`If-Match`) is mandatory for mutable user-facing records.

## 5. Authentication, sessions and authorization

- The browser must not process or store Cognito access, ID or refresh tokens. OAuth code exchange is
  server-side and requires a confidential school client (`client_secret_basic` from the exact
  tenant-scoped Secrets Manager record), PKCE S256, unpredictable state, OIDC nonce and browser
  binding. The OAuth client must not receive refresh-token or user-administration scopes.
- Session cookies are opaque, `HttpOnly`, `Secure`, `SameSite` and `__Host-` prefixed in production.
  Store only the token hash server-side.
- Each device receives an independent session. Do not copy sessions between clients or use shared
  browser storage. Session data must include idle and absolute expiry and an identity version.
- Every mutation uses CSRF protection in addition to SameSite and Origin/Fetch Metadata checks.
- Authorization is deny-by-default. The API checks operation permission, validates allowed fields,
  scopes the tenant and relies on PostgreSQL RLS as a second layer.
- Sensitive operations require recent verified MFA/passkey assurance. Local completion must verify
  live Cognito MFA/TOTP/WebAuthn policy, while external assurance must come from the approved mapped
  claims. Unknown or absent assurance is single-factor, never “probably MFA.”
- UI visibility is not authorization. Hidden modules and controls still require server enforcement.

## 6. Secrets and cryptography

1. No credential, private key, access token, client secret or production endpoint secret may enter
   source, environment examples, logs, test snapshots or built browser files.
2. Runtime services use IAM roles and short-lived credentials. Remaining secrets live in AWS Secrets
   Manager under a documented rotation and access policy.
3. Cryptography uses platform/AWS implementations and approved modes. New custom protocols require
   cryptographic review. Use AES-GCM for authenticated encryption, CSPRNG randomness and
   constant-time comparison for secrets.
4. Keys have a named purpose, tenant/context binding, owner, rotation state and retirement path.
5. Plaintext keys must be shortest-lived, never logged/cached persistently and cleared from mutable
   buffers when practical. Do not describe JavaScript memory clearing as a perfect erasure
   guarantee.

## 7. HTTP and external services

- All production transport is HTTPS/TLS. HTTP clients validate certificates, use a short timeout,
  reject unexpected redirects and bound response size.
- Outbound destinations are fixed or validated as public HTTPS with an allowlist where practical.
- Trust proxy headers only from the loopback Cloudflare sidecar. An edge header alone is not proof
  if an origin has public ingress.
- Define request/body/file limits at both Cloudflare and Fastify. Rate-limit authentication and
  expensive operations by the best available combination of source, tenant, account and session.
- Third-party failures must fail closed for authentication/authorization and degrade explicitly for
  non-security features. Retries must be bounded, back off and avoid duplicate side effects.

## 8. Logging, privacy and audit

Application logs are structured and UTC. Include request ID, component, outcome and safe
identifiers. Redact authorization, cookies, CSRF, passwords, provider secrets and tokens at the
logger. Do not log restricted student content, full IP addresses where a privacy hash suffices, or
decrypted keys.

Security-relevant data mutations use the database audit trigger. Audit events are append-only,
tenant-bound and hash chained. Operational logs and database audit records have separate access and
retention controls. Production monitoring must alert on repeated authorization failures, tunnel
failure, Cognito risk events, secret access, RDS authentication failure and audit-chain breaks.

## 9. Frontend and accessibility

- Tailwind CSS is the design foundation. Reusable visual patterns belong in component-layer classes
  or React components, not duplicated inline style objects.
- Design mobile-first at 320 CSS pixels, then enhance for tablet/desktop. Navigation, tables and
  forms must remain operable with touch, keyboard and 200% zoom.
- Use semantic landmarks, ordered headings, programmatic labels, visible focus, status/alert live
  regions and sufficient contrast. Icon-only controls require accessible names.
- Respect reduced motion and do not use color alone to communicate state. Loading, empty, failure,
  stale and permission-denied states are first-class designs.
- Sensitive values are masked until an intentional reveal and removed from component state when
  locked or signed out. Never persist restricted data in browser storage.

## 10. Testing and release gates

Every change runs:

```bash
npm run source:docs
npm run typecheck
npm run test
npm run lint
npm run format:check
npm run build
npm audit --omit=dev --audit-level=high
```

Security-critical changes require negative tests: unauthenticated, insufficient permission, wrong
tenant, stale version, invalid CSRF, expired session and malicious input. Database migrations
require syntax validation and a rehearsal against a production-like snapshot. Infrastructure
requires stored CDK/Terraform plans and policy review.

A production release additionally requires live smoke tests, SSO/passkey/TOTP tests, accessibility
checks, restore evidence, image/SBOM/vulnerability scan, change approval and rollback criteria. A
failing mandatory gate cannot be waived without a named risk owner, expiry and compensating
controls.

## 11. Dependency and remediation policy

Dependencies are exact-pinned in the lockfile and installed from the approved npm registry. Avoid
packages for trivial functionality. Runtime critical/high advisories block release; target
remediation is 24 hours for critical, 7 days for high, 30 days for moderate and 90 days for low. A
shorter period applies when exploitation is observed. Build-only exceptions require isolation from
untrusted input, an owner and a maximum 14-day initial expiry.

Generate and retain a CycloneDX SBOM for each release. Image digest, source revision, lockfile hash,
test output, dependency scan and approver identities form the release evidence set.

## 12. Change control and definition of done

A change is done only when requirements, implementation, tests, documentation, data migration,
security impact, telemetry, rollback and operator instructions agree. Two reviewers are required for
authentication, authorization, cryptography, tenant isolation, audit, infrastructure and destructive
data changes. Emergency changes receive retrospective review and corrective action within two
business days.

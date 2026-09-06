# Changelog

## 1.0.0-rc.6 - 5 September 2026

Review build based on the supplied RC5 source. Existing feature paths are retained. Adds school
management records, account-saved preferences, finance/event workflows, family/student workspaces,
care/maintenance/alumni records, Insights, Smart Alerts and a separate technician client.

Repairs fresh/populated migrations, deployment root resolution, community/guardian access, financial
settlement and journal integrity, medical view/key lifetimes, responsive dialogs and
listener/request cleanup. The revised numbered setup guide includes the separate RC5 upgrade path.

Local verification: 98 tests and all quality stages pass. See `quality/RELEASE_VERIFICATION.md` for
scope and evidence. The full roadmap is unfinished, including all-data browser encryption and
specified integrations/business workflows. Use an isolated synthetic evaluation only; no production
acceptance or ISO certification is asserted. See `docs/RC6_ROADMAP_COVERAGE.md`.

## 1.0.0-rc.5 - 2026-08-12

- Added a four-stage production deployment assistant: guided non-secret configuration, read-only
  prerequisite checks, source/config/plan-bound review evidence, and explicit time-windowed apply.
- Production infrastructure now deploys at zero application tasks; private PostgreSQL migrations and
  idempotent school bootstrap must both exit successfully before the assistant activates a minimum
  of three service tasks.
- Added deterministic ECS `RunTask` client tokens, owner-only atomic progress files and a status
  command so interrupted deployments resume without starting duplicate one-shot jobs.
- Added fail-closed validation for AWS identity/account/region, Cloudflare/hostname values,
  cross-account ARNs, encrypted/versioned/owner-enforced/TLS-only Terraform state, customer KMS
  rotation, verified SES identity, SES production sending/configuration set and forbidden
  placeholders/credentials.
- Added an AST-based quality gate requiring an explicit file overview and meaningful attached
  comment for every maintained implementation, including methods, callbacks, React effects,
  collection predicates, infrastructure tests and deployment functions.
- Added 731 verified function comments across 83 maintained executable source files and expanded
  Cloudflare Terraform comments at every trust-boundary feature.
- Added an exact-ARN, explicitly approved retry path for failed migration/bootstrap ECS tasks;
  predecessor ARNs remain in bounded deployment evidence and completed stages cannot be retried.
- Made production API/database startup reject embedded static cloud credentials and runtime database
  passwords, disabled TypeScript source maps, and made the container build remove stale compiler
  output before producing the runtime tree.
- Added a production-artifact publication gate that rejects source maps, test modules, compiler
  mapping directives and unambiguous embedded cloud/private-key signatures after each clean build.
- Pinned Terraform's state/backend operations to the reviewed AWS SSO profile, stripped ambient
  credentials from unrelated child processes and limited the Cloudflare token to Terraform
  plan/apply only.
- Bound the binary/human-readable Terraform plan, exact provider lock, synthesized CloudFormation
  template and CDK diff hashes into approval/apply verification; rejected unexpected artifact paths
  and symbolic-link plan/source/evidence substitutions.
- Kept the Cloudflare credential outside Terraform's input-variable model by using the
  provider-native environment variable and exposing it only to plan/apply child processes.
- Pinned the Node build/runtime and Cloudflared sidecar to readable versions plus full
  multi-platform manifest SHA-256 digests.
- Added a maintained-source PostgreSQL grammar gate for complete static parameterized queries.
- Added an exact production Host allowlist derived from the reviewed stack hostname and regression
  tests for host confusion and credential-environment isolation.
- Made each school Cognito OAuth client confidential, stores its generated secret only in the
  tenant-scoped Secrets Manager namespace, and authenticates backend code exchanges with
  `client_secret_basic` while retaining PKCE/state/nonce/browser binding.
- Local callbacks now re-read Cognito's live MFA/TOTP/WebAuthn enforcement and fail closed on drift;
  federated callbacks additionally require the signed Cognito identity to match the exact provider
  stored in the one-time transaction.
- Added regression evidence for the zero-task production activation boundary and the exact CDK
  outputs consumed by the deployment assistant.
- Rewrote the Setup Guide for Everyone as an assembly-style manual whose actions use the validated
  RC5 deployment commands, include exact screen/terminal locations and provide an expected result
  and stop condition for each operation.
- Updated all workspaces, internal dependencies, lockfile, SBOM, standards and controlled release
  documents to `1.0.0-rc.5`.

## 1.0.0-rc.4 - 2026-08-10

- Stages every newly configured Microsoft, Google, generic OIDC and SAML identity provider as
  disabled until an administrator explicitly enables it after controlled testing.
- Added a tenant-scoped, CSRF-protected provider Enable/Disable action with optimistic concurrency;
  enabling fails closed until at least one exact directory claim-to-role mapping exists.
- Reconfiguring an existing provider now withdraws it before the upstream Cognito change and leaves
  it disabled until its updated trust configuration is reviewed, mapped, tested and republished.
- Normalised PostgreSQL `bigint` row-version values at the administration API boundary so policy,
  module and provider concurrency checks receive real JSON numbers instead of driver strings.
- Added responsive provider status controls and a regression test for the provider publication gate.
- Rewrote the Setup Guide for Everyone as beginner guide revision 3 with explicit application,
  website, account, page, button, folder, file, terminal, command, expected-result, evidence and
  recovery instructions, plus complete local/website indexes and a 60-step tracker.
- Corrected current Cloudflare Security rules navigation and aligned the SSO setup procedure with
  the new disabled-by-default provider workflow.
- Corrected the repository `infra:synth` shortcut so CDK options reach the CDK CLI, and changed the
  unauthenticated CI synthesis to an account-agnostic regional template so it does not attempt an
  AWS Availability Zone lookup without credentials.
- Updated every workspace, lockfile, SBOM, controlled document and release artifact to `1.0.0-rc.4`.

## 1.0.0-rc.3 - 2026-08-09

- Aligned the SSO provider-secret name with the tenant-bounded ECS IAM policy and granted the
  missing `DescribeSecret` action, preventing production Entra/Google/OIDC setup failures.
- Limited immutable caching to Vite fingerprinted authentication assets; replaceable logos and other
  root assets now refresh on a short cache policy.
- Added optimistic-concurrency enforcement for the complete module-visibility update so concurrent
  administrators cannot silently overwrite one another.
- Corrected legacy-import conversion of string booleans, invalid default employment types, empty or
  non-positive capacities, and common prototype enum aliases before PostgreSQL writes.
- Added strict hostname, IANA timezone, AWS region, Cloudflare identifier and CIDR validation to
  fail early on deployment input errors.
- Derived live/readiness release metadata from the API package version and updated every workspace,
  lockfile, SBOM and controlled document to `1.0.0-rc.3`.
- Added regression tests for identity-secret isolation, static cache policy, production URL
  validation, legacy value conversion and the private AWS origin boundary.
- Added a plain-English, step-by-step deployment guide alongside refreshed technical manuals.

## 1.0.0-rc.2 - 2026-08-08

- Corrected Cognito passkey operation by enabling `ALLOW_USER_AUTH`, binding WebAuthn to the
  managed-login domain and adding a CSRF-protected, PKCE-bound self-service enrolment action.
- Marked the invitation-delivered initial administrator email verified so the forced-change first
  sign-in satisfies the BFF verified-identity invariant.
- Added the mandatory remote S3 Terraform backend declaration and corrected production runbook
  examples for CDK synthesis and the SES From-address argument.
- Declared the supported production topology as one school hostname per stack for this release.
- Reconciled directory-managed roles and category at every federated sign-in, removing stale
  provider grants and failing closed when no enabled mapping remains.
- Added a private one-shot legacy migration task that reads only KMS-encrypted, short-lived S3
  staging objects and supports both plan and transactional apply modes without database ingress.
- Bootstrap now creates and reports an explicitly dated initial academic year alongside the campus,
  eliminating manual private-database setup before class or legacy imports.

## 1.0.0-production-candidate - 2026-08-08

- Replaced the monolithic prototype with independent authentication, portal, API, contracts,
  database and infrastructure workspaces.
- Removed Supabase runtime access and direct browser-to-database communication.
- Added normalized PostgreSQL migrations with primary keys, composite tenant foreign keys, row-level
  policies, optimistic concurrency and hash-chained audit records.
- Added Cloudflare Tunnel, managed WAF, OWASP rules, rate limits and optional IP/country controls.
- Added Cognito managed login with passkeys, TOTP, Microsoft Entra ID, Google, OIDC and SAML
  federation plus directory claim-to-role mapping.
- Added opaque device-bound sessions, PKCE, state/nonce/browser binding, CSRF defense and step-up
  gates.
- Added KMS envelope encryption and ephemeral browser wrapping for selected sensitive fields.
- Rebuilt the responsive interface using Tailwind CSS while preserving every prototype module in the
  navigation and operations surface.
- Added AWS CDK infrastructure, one-shot migration task, school bootstrap, backup policy and
  security/quality documentation.

# RC6 changes from the supplied RC5 project

The source remains the supplied React/Tailwind/Fastify/PostgreSQL/AWS/Cloudflare project. Existing
public sign-in, branding, identity providers, sessions/recovery, school records, attendance, photo
handling, file controls, audit, infrastructure and legacy import paths are retained.

The main additions are shared metadata and record interfaces for roadmap modules; school
terms/periods/groups/dates; account-backed dashboard and appearance settings; a separate technician
client; guarded finance workflows and reports; event planning, templates and consent evidence;
parent/student workspaces; restricted care access; maintenance/alumni records; Insights and durable
Smart Alerts.

Important corrections include:

- executable RC5 migration extension qualification with exact SHA-256 compatibility receipts;
- transaction-local migration audit context for populated-school upgrades, serialised migration runs
  and additive repair migrations;
- nullable-ID uniqueness, people/account link uniqueness/category checks, tenant references and
  reference-display consistency;
- community account isolation even when broad staff grants were mistakenly attached, active-user
  checks and internal-form audience separation;
- guardian fee allocations and share-only portal balances, settled-receipt balance updates, repeated
  partial payment support, currency/overpayment checks and balanced immutable source journals;
- calendar term/period/no-class guards, protected approval transitions, preserved paper/portal
  consent evidence and case-specific care access;
- root/compiled-script location fixes, dependency-free setup, a fresh upgrade configuration path and
  corrected Cognito password/TOTP/WebAuthn provisioning order;
- global appearance application, dark contrast, cryptographic UUID compatibility, focus-contained
  navigation/dialogs, unique field labels and mobile dialog overflow repairs;
- cancellation and listener-cleanup repairs, stale key-exchange rejection, timed/hidden clinical
  view locking and print suppression, with real Web Crypto regression checks;
- Fastify/transitive runtime dependency fixes and updated AWS CDK tooling replacing the expired
  build-dependency exception.

Operational limits and incomplete requirements are explicit in `docs/RC6_ROADMAP_COVERAGE.md`. The
build is not asserted to provide all-data client encryption, a complete ERP, a native offline
medical app or formal ISO certification.

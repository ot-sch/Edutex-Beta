# Contributing to Edutex

Changes must be small enough to review, linked to a requirement or defect, and accompanied by an
explicit security and tenant-isolation impact assessment.

1. Create a short-lived branch and update tests with the implementation.
2. Add a new immutable SQL migration; never edit a migration already applied to any environment.
3. Run `npm run quality` and `npm audit --omit=dev --audit-level=high`.
4. For infrastructure changes, review both the CDK and Cloudflare plans. Production changes require
   a second authorised approver.
5. Update the risk register, standards matrix and runbooks when a control or operating procedure
   changes.

All request-derived values must be schema validated. SQL values are parameters; dynamic identifiers
come only from a source-controlled allowlist. Every tenant table requires a tenant key, composite
foreign keys where appropriate, row-level security and tests for cross-tenant denial.

See `docs/standards/CODEBASE_STANDARDS.md` and `docs/standards/DATABASE_STANDARDS.md` for the
normative rules.

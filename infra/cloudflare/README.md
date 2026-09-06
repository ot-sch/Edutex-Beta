# Cloudflare edge deployment

Release baseline: 1.0.0-rc.5 / 2026-08-12

This configuration creates the client hostname, points it to a remotely managed Cloudflare Tunnel,
deploys Cloudflare and OWASP managed WAF rules, applies optional country/IP restrictions, protects
the administration route and adds two edge rate limits. The AWS service has no public origin.

Use a dedicated Cloudflare API token with only Zone DNS, Zone WAF/Rulesets and Account Tunnel edit
permissions for the intended account and zone. Supply it to the provider process as
`CLOUDFLARE_API_TOKEN`. Never put it in a `.tfvars` file or Terraform state.

Before applying, import any existing phase entry-point rulesets. Cloudflare permits a single zone
entry-point ruleset per phase. Run `terraform plan` and have a second authorised operator approve
production changes. Exact managed-rule availability varies by Cloudflare plan; resolve plan errors
with the school account team rather than weakening the application rules.

Production state is deliberately configured as an empty S3 backend in `backend.tf`. Initialise it
with the approved encrypted, versioned, TLS-only state bucket, a per-client key and
`use_lockfile=true`; local state is not an approved production path. `deploy:plan` generates the
provider lock and binds its SHA-256 into `plan-record.json`; do not hand-edit or discard it between
plan and apply.

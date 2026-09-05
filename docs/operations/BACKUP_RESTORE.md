# Backup, restore and continuity runbook

Release baseline: 1.0.0-rc.5 / 2026-08-12

## Designed protection

- Aurora automated backups and AWS Backup continuous recovery; production retention 35 days.
- Production monthly archive to cold storage after 90 days, retained 2,555 days.
- KMS-encrypted production Backup Vault with Vault Lock retention bounds.
- DynamoDB point-in-time recovery for sessions/auth transactions (sessions are disposable security
  state; restoring them into production is normally prohibited).
- Versioned, KMS-encrypted S3 file bucket with noncurrent lifecycle.

Final RPO/RTO are business/contract decisions. Architecture configuration is not proof they are met.

## Quarterly isolated restore test

1. Approve test ticket, recovery point, target isolated account/VPC, synthetic access and disposal.
2. Restore Aurora and required S3 objects to new names/keys; do not overwrite production.
3. Deploy a temporary API with no public ingress and migration execution disabled.
4. Validate migration checksums, schema/extension/role versions and RLS ownership.
5. Reconcile tenant/table row counts and sampled relationship/financial constraints.
6. Verify per-tenant audit chain from first to last event and record any pre-existing break.
7. Confirm KMS decrypt only through the approved test role/context and test one restricted field
   with synthetic data.
8. Run login/session/permission/read/write/file smoke tests for two synthetic tenants.
9. Measure recovery point, restore duration, service validation duration and achieved RPO/RTO.
10. Export evidence, securely destroy temporary data/resources and record CAPA.

Do not restore expired production sessions: clear the session/auth-transaction tables and require
all users to authenticate again after disaster recovery. Review Cognito/IdP state separately because
it is outside PostgreSQL backup.

## Production recovery decision

- Prefer normal failover for isolated instance/AZ failure.
- Prefer point-in-time restore to a new cluster for corruption or destructive change; validate
  before cutover.
- Use application roll-forward when schema/data is sound and only code is defective.
- Never restore blindly over the only evidence copy. Preserve incident snapshots/logs first.
- Confirm DNS/Tunnel routing remains Cloudflare-only during any cutover.

## Required evidence

Recovery point, resource ARNs, operator/approver, commands/automation revision, start/end UTC times,
counts/checksums, audit-chain result, KMS result, application smoke result, achieved RPO/RTO,
exceptions, cleanup and corrective actions. Record the result in `app.backup_restore_tests` for the
relevant tenant where appropriate and in the ISMS evidence system.

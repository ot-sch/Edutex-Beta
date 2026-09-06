# Edutex 1.0.0-rc.6

RC6 expands the supplied RC5 project and repairs installation, migration, access, finance and
responsive UI defects. Existing feature paths are retained.

**Review build: the complete roadmap is not finished. Use an isolated evaluation environment with
synthetic records.** All-data client-side encryption remains unmet; selected fields are
browser-encrypted. A complete ERP, Google Classroom sync and a guaranteed non-capturable offline
medical app are not supplied. ISO certification and real-environment security/restore/device
acceptance have not been obtained.

## Start here

- [Technical setup and RC5 upgrade guide](docs/manuals/Edutex_RC6_Technical_Setup_Guide.md)
- [Setup Guide for Everyone](docs/manuals/Edutex_RC6_Setup_Guide_for_Everyone.md)
- [Roadmap coverage and release blockers](docs/RC6_ROADMAP_COVERAGE.md)
- [Verified checks and practical limits](quality/RELEASE_VERIFICATION.md)
- [Changes from RC5](docs/release/RC6_CHANGES.md)

From this directory:

```text
npm run setup -- check
npm run setup -- install
npm run quality
```

For a new-school evaluation, run the setup `configure` interview. For an existing RC5 school, run
`setup -- upgrade --from OLD_CONFIG --output NEW_CONFIG`, rehearse a restored database and follow
the reviewed plan/apply procedure. The upgrade retains cloud identities and skips a second school
bootstrap.

The public sign-in, protected school portal and separately built technician portal are in
`apps/auth-web`, `apps/portal-web` and `apps/technician-web`. `apps/api` owns server sessions and
data access; `packages/contracts` and `packages/database` supply shared validation, PostgreSQL/RLS
and numbered migrations. `infra/aws` and `infra/cloudflare` retain the private AWS and Cloudflare
Tunnel/WAF boundary.

The two current guides supersede the RC5 deployment instructions for this release. Historical
manuals, architecture/governance material and verification are retained as reference, with their
dated claims requiring re-assessment for RC6. The baseline project README is preserved in
`docs/manuals/rc5-reference/README_RC5.md`.

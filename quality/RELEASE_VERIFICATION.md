# RC6 release verification

Release: `1.0.0-rc.6`

Verification date: 5 September 2026

Disposition: **review build; isolated evaluation with synthetic data only**

The full roadmap is not complete. All-data browser encryption, several requested business and
integration workflows, organisational standards assurance and real-environment acceptance remain
outstanding. This record is local verification evidence, not certification or production approval.
The requirement-by-requirement assessment is in `docs/RC6_ROADMAP_COVERAGE.md`.

## Completed local checks

| Check                     | Result                                         | Scope of evidence                                                                                                                                                                                                                                                                                                 |
| ------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source documentation      | Pass                                           | 124 maintained implementation files and 1,334 implemented functions/callbacks checked.                                                                                                                                                                                                                            |
| Strict TypeScript         | Pass                                           | All workspaces and deployment scripts; unreachable code is now rejected explicitly.                                                                                                                                                                                                                               |
| Automated tests           | Pass                                           | 98 tests: 57 API/security/integration, 4 database, 3 browser cryptography, 8 AWS infrastructure, 26 deployment/SQL/artifact tests.                                                                                                                                                                                |
| PostgreSQL workflows      | Pass within test boundary                      | 28 integration cases run the real PostgreSQL engine through PGlite and actual API handlers. All 29 migrations apply; a populated RC5 upgrade is also exercised. Authentication and AWS services are substituted in this suite.                                                                                    |
| Lint and formatting       | Pass                                           | Repository rules with zero lint warnings and the supported source/documentation formatting gate.                                                                                                                                                                                                                  |
| Builds                    | Pass                                           | Contracts, database, public sign-in, protected school portal, technician portal, API, deployment tooling and AWS infrastructure compile.                                                                                                                                                                          |
| Publication artifact gate | Pass                                           | 71 generated text artifacts inspected; production client source maps remain disabled.                                                                                                                                                                                                                             |
| Runtime SBOM              | Generated                                      | 137 components in `quality/sbom.cdx.json`, generated from the lockfile with development dependencies omitted. The complete lockfile retains development and optional platform dependencies.                                                                                                                       |
| Dependency audit          | Earlier saved full audit: zero reported issues | The retained full and runtime audit results from this build session report no known vulnerabilities. A final refresh was not confirmed: automatic approval review rejected its status check because of an account usage limit. The earlier snapshots are dated evidence, not a guarantee about future advisories. |
| Guides                    | Rendered and reviewed                          | 41-page Setup Guide for Everyone and 10-page Technical Setup and Upgrade Guide; page images reviewed and no text outside page bounds detected. Command line breaks are explicit shell continuations.                                                                                                              |

The combined quality capture is retained in `quality/evidence/quality-run.log`. The final API,
deployment-script and AWS TypeScript builds and publication artifact check were also run explicitly
after that capture, all with exit code zero. This avoids interpreting an incomplete captured log as
proof that its remaining stages finished.

Current package-lock SHA-256:

```text
bf748760c4cbc6455ddc0a7e5d6d4db204919555492f1b275275c14be7b7adf1
```

The all-dependency SBOM attempt failed on missing optional WASM-platform dependency-tree entries.
The delivered runtime SBOM was generated successfully with `--package-lock-only --omit=dev`. This
does not assert that every optional target platform has been installed or exercised.

## Security and integrity scenarios exercised

- Tenant isolation under the non-owner application database role, including a platform manager.
- Current guardian links, unlinked-child denial and active-account checks at the database boundary.
- Community accounts remain isolated despite legacy or accidentally assigned staff grants.
- Parent fee allocations and share-only receipts, repeated partial payments, overpayment rejection
  and currency separation.
- Balanced invoice journals, duplicate-source rejection, immutable posted journals and separate
  creator/settlement actors.
- Account-owned preferences, published portal data, internal-form audience restrictions and named
  reference lookups under RLS.
- No-class calendar enforcement, paper/portal consent history and alert delivery deduplication.
- Real AES-GCM/ECDH/HKDF operations: authorised decryption, student/field rebinding rejection,
  expired key rejection, and a key response arriving after lock. Reopening requires a new exchange.
- Existing authentication, CSRF, hostname/origin, session, private-infrastructure, deployment-hash
  and historical-migration checks retained in the suite.

Medical views now invalidate pending work on hiding, session expiry, record teardown and the
one-minute viewing deadline. Restricted student notes and clinical dialogs have a five-minute
deadline and hidden-page locking. Print suppression is an additional UI measure. None of these
controls can guarantee that a device owner cannot capture or photograph visible information.

## Browser review and device limits

The earlier review used synthetic responses in Chrome at 320, 390, 768 and 1,440 CSS-pixel layouts.
It covered dashboard, appearance, navigation, record dialogs, finance, Insights, Smart Alerts,
family/student workflows and the separate technician screen. These fixtures are excluded from the
release archive and are not evidence that the actual AWS API was exercised in a browser.

On the final repeat pass, the browser blocked the existing preview address under its URL policy.
That restriction was not bypassed. The final lifecycle fixes were checked through strict
compilation, the cryptographic regressions and the other automated gates; a final live browser pass
remains. Physical iPhone/Android, Safari/Firefox, Windows/macOS/Linux combinations, screen readers,
keyboard audits and Add to Home Screen behaviour still require target-device acceptance. No claim
that every device or platform was tested is made.

## Checks still required before live school data

1. Complete the roadmap's encryption architecture, existing-data conversion, permitted search and
   reporting, key distribution/recovery/revocation and corresponding threat-model verification.
2. Finish the business/integration gaps listed in the roadmap assessment. Agree a feasible medical
   endpoint/offline requirement; the absolute no-capture condition cannot be delivered by a browser.
3. Build, scan and sign the actual ARM64 container. Docker image creation was not available here.
4. Rehearse actual RDS migrations/upgrades and restore with the matching identity/key material.
   Exercise IAM/SCP/boundaries, Cloudflare WAF/Tunnel/DNS/direct-origin isolation and network paths.
5. Test real Cognito/federation, TOTP/passkeys, account recovery, revocation and role/campus
   boundaries.
6. Test SES/SNS configuration and recipient rights with approved test destinations, provider
   failures, uncertain delivery, monitoring and operational recovery.
7. Complete device/accessibility, performance/load, resilience and independent security assessment.
8. Obtain school privacy, clinical, accounting and operational acceptance, and organisational
   standards assessments. No ISO certification is conferred by the source or guides.

No school cloud resources were deployed or changed in this work session.

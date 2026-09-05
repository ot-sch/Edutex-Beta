# Penetration-test readiness and rules of engagement

Release baseline: 1.0.0-rc.5 / 2026-08-12

## Entry criteria

Testing begins only after a successful production-like deployment, live SSO/MFA tests, two-tenant
isolation test, runtime/image/IaC scans, restore test, central logging validation and written owner
acceptance of known limitations. Use a dedicated test environment or explicitly approved isolated
production tenant containing synthetic data.

## Scope inventory

In scope when listed in the signed authorization:

- exact Edutex hostname and Cloudflare edge/WAF behavior;
- public auth bundle and protected portal/API routes;
- OAuth/OIDC/SAML relying-party logic, session/CSRF/step-up and admin configuration;
- tenant authorization, RLS and relational integrity through exposed application paths;
- file handling and restricted-field crypto protocol;
- supplied container/IaC/source review and AWS/Cloudflare configuration review.

AWS, Cloudflare, Microsoft, Google, school IdP, SES and npm infrastructure is not intrinsically
authorized. Test their Edutex configuration/integration only within provider policy and written
scope.

## Rules

- List tester names, source CIDRs, dates/times/timezone, contacts and emergency stop phrase.
- Do not use real student/staff data. Stop and notify immediately if encountered.
- Denial-of-service, phishing/social engineering, password spraying, physical tests, persistence,
  destructive deletion, supplier pivoting and data exfiltration beyond minimal proof require
  separate explicit authorization.
- Rate/volume stays below agreed limits. Coordinate WAF allow/challenge exceptions without removing
  origin or authorization controls.
- Use unique request markers and retain precise timestamps, request IDs and payload hashes.
- Do not send findings or secrets by ordinary email/chat. Use the approved encrypted channel.

## Required test themes

1. Cloudflare/origin bypass, host-header confusion, cache poisoning/deception, request smuggling and
   method/header normalization across Cloudflare/Tunnel/Fastify.
2. OAuth login CSRF, state/nonce/PKCE replay, browser-binding theft, code replay, mix-up, open
   redirect, IdP confusion and logout/session persistence.
3. Password/TOTP/passkey enrollment, recovery, downgrade, MFA fatigue/replay, step-up freshness and
   absent/forged `amr`/`acr`/custom assurance.
4. Session fixation, entropy, cookie flags, device/UA binding bypass, concurrent clients, expiry,
   disabled user and CSRF/Origin/Fetch Metadata bypass.
5. BOLA/BFLA/BOPLA and mass assignment across every module, role/category and two tenants; include
   valid foreign IDs stolen from the other tenant.
6. SQL/NoSQL/command/template/header/CSV injection, prototype pollution, ReDoS and malformed parser
   inputs at every boundary.
7. File MIME/extension/polyglot/metadata/pixel flood, object-key traversal, orphan cleanup and
   private download authorization.
8. Browser encryption key exchange, ECDH input validation, wrong tenant/key/record AAD, IV/tag
   tampering, retired keys, assurance gate and plaintext leakage.
9. Secrets/logs/errors/source maps/static assets, SSRF in IdP endpoints, dependency/container/IaC
   misconfiguration and excessive IAM.
10. Audit insertion/update/deletion, cross-tenant read, chain continuity, missing denial/security
    events, time correlation and evidence retention.

Map findings to OWASP ASVS 5.0.0 requirement identifiers and CWE where applicable. Report exploit
preconditions, affected roles/tenants, reproducibility, business impact and a safe remediation - not
only scanner severity.

## Evidence handling

Critical/high findings are reported immediately, not held for the final report. Evidence contains
the minimum data needed, is encrypted at rest/in transit, access logged and destroyed/returned on
the agreed date. The operating organisation preserves Cloudflare, Cognito, CloudTrail, application,
PostgreSQL and flow logs under legal/incident direction.

## Exit and retest

For every finding, assign owner, due date, root cause and affected control. Fix the systemic cause,
add a regression test and assess similar code. Critical/high findings block production unless the
authorized risk authority records a lawful, time-bounded acceptance. The original tester retests
material findings and issues a closure statement with residual observations.

No report may say “unhackable,” “100% secure,” “OWASP certified” or “ISO certified” unless a
separate recognized certification explicitly supports that exact claim.

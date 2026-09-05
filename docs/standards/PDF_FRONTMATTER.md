---
title: 'Edutex Production Engineering & Assurance Standard'
subtitle: 'AWS, PostgreSQL, Cloudflare, OWASP, ISO/IEC 27001 and ISO 9001'
author: 'Edutex Engineering'
date: 'Release candidate 5 · 12 August 2026'
lang: en-GB
documentclass: report
classoption:
  - oneside
  - openany
papersize: a4
fontsize: 10pt
geometry:
  - top=23mm
  - bottom=24mm
  - left=20mm
  - right=20mm
colorlinks: true
linkcolor: EdutexBlue
urlcolor: EdutexTeal
toccolor: EdutexBlue
toc-depth: 2
secnumdepth: 2
---

# Document control and assurance boundary

| Field                             | Controlled value                                                                                                      |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Document                          | Edutex Production Engineering & Assurance Standard                                                                    |
| Version                           | 1.0.0-rc.5                                                                                                            |
| Status                            | Production candidate; pre-certification and pre-penetration-test                                                      |
| Primary security framework        | ISO/IEC 27001:2022, including Amendment 1:2024                                                                        |
| Quality framework                 | ISO 9001:2015, including Amendment 1:2024                                                                             |
| Application verification baseline | OWASP ASVS 5.0.0 Level 2, with selected Level 3 controls for authentication, session, tenancy, cryptography and audit |
| Threat catalogues                 | OWASP Top 10:2025 and OWASP API Security Top 10:2023                                                                  |
| Owners                            | Engineering, Security, Data Engineering and Platform Operations                                                       |
| Required approval                 | Engineering Lead, Security Lead, Data Owner and Release Manager                                                       |
| Review                            | At least annually; every material architecture/framework change; after a major incident                               |

## Purpose

This manual defines the mandatory engineering, database, security, quality and operating rules for
the Edutex production candidate. It is both a working standard and an evidence index. The
source-controlled documents included in this manual remain authoritative where they give more
specific instructions.

The standards use **must** for a mandatory requirement, **should** for a requirement that needs a
documented and approved justification to deviate, and **may** for an option. A control is not
considered effective merely because it appears in source: environment configuration, live negative
testing, evidence retention and accountable operation are required.

## Assurance statement

The implementation is designed against the named frameworks; this manual does not declare Edutex
“certified”, universally “OWASP compliant”, penetration-test approved or unhackable. ISO
certification applies to a scoped organisational management system and requires auditable operating
evidence plus an accredited certification process. OWASP ASVS conformance requires verified
requirements and retained evidence in the deployed environment. Open items and residual risks in
this manual are release gates, not footnotes.

## Normative hierarchy

1. Applicable law, regulation, safeguarding duty and signed customer contract.
2. The organisation's approved information-security and quality policies.
3. This manual and its source-controlled standards/runbooks.
4. Approved architecture decisions, threat models and release-specific plans.
5. Implementation comments and local team conventions.

When requirements conflict, stop the change and obtain a documented decision from Security, Legal,
Privacy and the accountable service owner as applicable. No risk owner may accept a breach of law or
an absolute organisational policy.

## Release acceptance summary

Source checks in this candidate cover strict TypeScript compilation, unit/negative tests, lint,
format, production bundling, PostgreSQL migration parsing, Cloudflare Terraform parsing, AWS CDK
synthesis, secret-pattern scanning, runtime dependency audit and CycloneDX SBOM generation. These
checks are necessary but not sufficient for client data.

Before go-live, the target organisation must complete live two-tenant isolation tests, SSO and
directory-role mapping tests with each real provider, TOTP/passkey recovery tests, Cloudflare plan
validation, accessibility testing, container/provenance scanning, restore evidence, SIEM/on-call
integration, privacy/retention workflows, session inventory/revoke-all, independent penetration
testing and formal risk acceptance. The deployment runbook contains the stop conditions.

## Architecture control summary

| Boundary          | Required design                                                                                                                    |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Public edge       | Cloudflare DNS, Tunnel, WAF, managed rules, rate limits and reviewed IP/country policy                                             |
| AWS origin        | Private Fargate service; no public IP, load balancer or inbound application rule                                                   |
| Authentication    | School-isolated Cognito Plus; OAuth code + PKCE; TOTP and verified passkeys; Entra ID, Google, OIDC and SAML federation            |
| Browser session   | Independent opaque device token; server-side hash; CSRF, device binding, idle/absolute expiry; no Cognito token in browser storage |
| API               | Backend-for-frontend; schema validation; deny-by-default permissions; field allowlists; safe error contract                        |
| PostgreSQL        | Aurora PostgreSQL 16; RDS Proxy IAM/TLS runtime path; typed relational model; PK/FK/composite tenant integrity; RLS                |
| Restricted fields | Browser AES-256-GCM; recent high-assurance gate; tenant-bound KMS envelope key; ephemeral P-256 ECDH wrapping                      |
| Secrets           | Workload identity first; remaining credentials in AWS Secrets Manager; no browser/database secret or source credential             |
| Evidence          | Append-only tenant audit chain, protected operational logs, release evidence, risk/SoA records and restore/incident exercises      |

## How to use this manual

- Engineers apply the codebase, database and security standards during design and review.
- Release managers enforce every release and deployment gate; failed mandatory gates stop release.
- Security owners maintain the ASVS matrix, risk register and technical pre-Statement of
  Applicability with evidence links and named owners.
- Operators rehearse deployment, rollback, backup/restore and incident procedures without client
  data before enabling production traffic.
- Internal auditors sample both implementation and operating records; management review assigns
  corrective action and verifies closure.

\newpage

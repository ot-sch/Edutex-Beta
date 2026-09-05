# ISO/IEC 27001 technical pre-Statement of Applicability

Release baseline: 1.0.0-rc.5 / 2026-08-12

Reference baseline: ISO/IEC 27001:2022 and Amendment 1:2024.  
Primary objective: prepare Edutex evidence for the operating organisation’s Information Security
Management System (ISMS).

## Important boundary

This document is not a certified Statement of Applicability (SoA). ISO/IEC 27001 certification is
awarded to an organisation for a defined ISMS scope after risk treatment, internal audit, management
review and an accredited certification audit. Source code can supply technical evidence but cannot
establish organisational compliance by itself.

Annex A text is copyrighted; this document uses identifiers and short working labels, not the
standard’s full control wording. The organisation must reconcile this pre-SoA with its licensed
copy, legal obligations, risk assessment and customer contracts.

## Proposed ISMS scope

The design/build/deployment/operation/support of the Edutex multi-tenant school platform, including
Cloudflare edge services; AWS accounts, networks, compute, identity, database, storage, keys and
logs; source and delivery systems; personnel and suppliers with production access; school
onboarding, support, incident, continuity and data-lifecycle processes.

Explicit interfaces: school Microsoft/Google/SAML directories, email delivery, client endpoints,
penetration-test suppliers and AWS/Cloudflare shared-responsibility boundaries.

## Context and Amendment 1:2024

The ISMS owner must determine and document whether climate change is a relevant internal/external
issue and whether interested parties have climate-related requirements. Potential Edutex concerns
include data-centre region/energy commitments, severe-weather availability for schools, supplier
resilience and continuity dependencies. This is an organisational decision; no relevance conclusion
is asserted here.

## Applicability method

Status meanings: **Technical** is implemented in this repository; **Shared** combines implementation
and operating evidence; **Organisational** exists outside code; **Planned** is not yet complete.
Applicability and exclusions must trace to a risk, obligation or business requirement.

| Control         | Working label                              | Applies     | Status                | Rationale / evidence                                                                            |
| --------------- | ------------------------------------------ | ----------- | --------------------- | ----------------------------------------------------------------------------------------------- |
| A.5.1           | Security policies                          | Yes         | Shared                | Security/code/database standards; organisation must approve, communicate and review             |
| A.5.2           | Security roles                             | Yes         | Organisational        | Name ISMS owner, security owner, DPO/privacy lead, service owner and deputies                   |
| A.5.3           | Segregation of duties                      | Yes         | Shared                | Separate runtime/migrator roles and two-person production approval; staffing evidence required  |
| A.5.7           | Threat intelligence                        | Yes         | Planned               | Subscribe to AWS, Cloudflare, OWASP, NCSC/CISA and sector advisories; record triage             |
| A.5.8           | Security in projects                       | Yes         | Shared                | Threat/security impact and quality gates in contribution/change process                         |
| A.5.9           | Asset inventory                            | Yes         | Shared                | CDK/Terraform, SBOM and crypto inventory; CMDB ownership/lifecycle required                     |
| A.5.12 / A.5.13 | Classification and labelling               | Yes         | Shared                | Five handling classes in security architecture; labels/workflow training required               |
| A.5.14          | Information transfer                       | Yes         | Shared                | TLS/Tunnel and controlled exports; school transfer agreements and DLP required                  |
| A.5.15          | Access control                             | Yes         | Technical             | Permission model, RLS, field controls and Cloudflare admin network layer                        |
| A.5.16 / A.5.18 | Identity and access rights                 | Yes         | Shared                | Cognito/SSO, role mappings and refresh; joiner/mover/leaver + quarterly reviews required        |
| A.5.17          | Authentication information                 | Yes         | Shared                | Passkeys/TOTP, Secrets Manager, generated temporary password; factor-recovery process required  |
| A.5.19-A.5.22   | Supplier security                          | Yes         | Organisational        | AWS, Cloudflare, IdPs, npm and testers require due diligence, contracts and monitoring          |
| A.5.23          | Cloud services                             | Yes         | Shared                | AWS/Cloudflare IaC and responsibility boundaries; cloud exit/change procedure required          |
| A.5.24-A.5.28   | Incident/evidence lifecycle                | Yes         | Shared                | Incident runbook, immutable audit and log retention; exercise and forensics evidence required   |
| A.5.29 / A.5.30 | Security during disruption / ICT readiness | Yes         | Shared                | Multi-AZ design/backups; BCP, dependency failure exercise and proven RTO/RPO required           |
| A.5.31          | Legal/contract obligations                 | Yes         | Organisational        | Build jurisdiction-specific privacy, education, records and breach register                     |
| A.5.33          | Records protection                         | Yes         | Shared                | Retention/legal-hold schema, immutable audit and Vault Lock; schedule/jobs required             |
| A.5.34          | Privacy/PII                                | Yes         | Shared                | Classification, minimization, encryption, DSR tables; DPIA/ROPA/legal basis required            |
| A.5.35 / A.5.36 | Independent review/compliance              | Yes         | Planned               | Independent pen test, internal audit and accredited certification review                        |
| A.5.37          | Operating procedures                       | Yes         | Shared                | Deployment, incident, backup and penetration-test runbooks; train and exercise                  |
| A.6.1-A.6.8     | People controls                            | Yes         | Organisational        | Screening, terms, training, remote work, offboarding, NDAs and reporting are HR/ISMS evidence   |
| A.7.1-A.7.14    | Physical controls                          | Yes         | Organisational/shared | AWS/Cloudflare assurance plus office/device/media controls; inherit only with supplier evidence |
| A.8.1           | Endpoint devices                           | Yes         | Organisational        | Managed endpoint, disk encryption, EDR, patch and screen-lock baseline required                 |
| A.8.2 / A.8.3   | Privileged/access restriction              | Yes         | Shared                | IAM roles, private admin path, permissions; PAM/break-glass review evidence required            |
| A.8.4           | Source access                              | Yes         | Organisational        | Permanent repository branch/secret/code-owner controls must be enabled                          |
| A.8.5           | Secure authentication                      | Yes         | Technical/shared      | Cognito MFA/passkeys, SSO assurance, opaque sessions; live recovery/IdP tests required          |
| A.8.6           | Capacity                                   | Yes         | Shared                | ECS autoscaling, Aurora limits, body/rate limits; load tests and budgets required               |
| A.8.7           | Malware protection                         | Yes         | Partial               | Re-encoded images and minimal container; EDR/image scan and future upload AV required           |
| A.8.8           | Vulnerability management                   | Yes         | Shared                | Runtime audit and Dependabot; SAST/DAST/image/IaC scanning and SLAs required                    |
| A.8.9           | Configuration management                   | Yes         | Shared                | CDK/Terraform, strict production config; drift detection and approved baselines required        |
| A.8.10          | Information deletion                       | Yes         | Planned               | Retention/DSR model exists; deletion workers and verified erasure evidence required             |
| A.8.11 / A.8.12 | Masking and DLP                            | Yes         | Partial               | UI reveal control/log redaction; broader exports, lower environments and DLP required           |
| A.8.13 / A.8.14 | Backup and redundancy                      | Yes         | Shared                | PITR/versioning/multi-AZ/Vault Lock; quarterly restore evidence required                        |
| A.8.15-A.8.17   | Logging, monitoring, clock                 | Yes         | Shared                | UTC logs/audit/RDS/flow; SIEM alerting, NTP/config and access evidence required                 |
| A.8.20-A.8.23   | Network controls                           | Yes         | Technical/shared      | Private VPC, SG identity paths, Tunnel, WAF/filtering; egress and drift evidence required       |
| A.8.24          | Cryptography                               | Yes         | Shared                | KMS/AES-GCM/ECDH inventory; approved key policy, rotation exercise and owner required           |
| A.8.25-A.8.29   | Secure lifecycle/coding/testing            | Yes         | Shared                | Standards, strict build, reviews and OWASP matrix; permanent CI and independent tests required  |
| A.8.30          | Outsourced development                     | Conditional | Organisational        | Apply supplier controls if any development/support is outsourced                                |
| A.8.31          | Environment separation                     | Yes         | Organisational/shared | Parameterized environments; separate accounts/data/keys/pipelines must be deployed              |
| A.8.32          | Change management                          | Yes         | Shared                | Immutable migrations, reviewed plans, gates and rollback; ticket/approval evidence required     |
| A.8.33          | Test information                           | Yes         | Organisational        | Synthetic/anonymized data only; approvals and disposal evidence required                        |
| A.8.34          | Audit-test protection                      | Yes         | Organisational/shared | Pen-test scope/rate/stop rules and isolated tenant; audit access authorization required         |

## Required ISMS evidence pack

1. Approved ISMS scope, interested parties, legal/contract register and climate-relevance decision.
2. Asset/data/crypto/supplier inventories with owners, locations, classifications and lifecycle.
3. Risk methodology, risk assessment, treatment plan, final SoA and acceptance authority.
4. Access reviews, privileged access, joiner/mover/leaver and break-glass test records.
5. Secure-development training, change records, release evidence, SBOM and vulnerability results.
6. Backup/restore, continuity, incident and breach exercises with corrective actions.
7. Monitoring alerts, log access/retention, audit-chain checks and clock synchronization evidence.
8. Supplier assurance, penetration test, internal audit, management review and corrective action.

## RC5 implementation evidence added

- A.8.4/A.8.25-A.8.29: an AST release gate verifies an ownership/dependency/security overview on
  every maintained executable file and a meaningful attached comment on every implementation.
- A.8.9/A.8.32: deployment configuration is non-secret, schema/cross-field validated and reused
  across Cloudflare, AWS, migration and bootstrap; approved plan records bind exact SHA-256 values.
- A.8.2/A.8.3: preflight proves the selected short-lived AWS principal is in the exact approved
  account and rejects cross-account/region resource ARNs.
- A.8.13/A.8.24: preflight verifies state-bucket region, versioning, public blocking, owner
  enforcement, exact customer KMS encryption/bucket key and KMS rotation.
- A.8.31/A.8.32: production foundation deploys at zero application tasks; private idempotent
  migration and school bootstrap must succeed before service activation.

These are source/control-design evidence. The ISMS owner must still retain actual plan approvals,
identity logs, deployment receipt, configuration/drift results, competency records, incidents,
audits and management review.

## Certification gate

Do not market Edutex or its operator as ISO/IEC 27001 certified until the certificate scope, legal
entity, certification body and current validity can be independently verified. “Designed to support
an ISO/IEC 27001-aligned ISMS” is the accurate pre-certification statement.

References: <https://www.iso.org/standard/27001> and <https://www.iso.org/standard/88435.html>.

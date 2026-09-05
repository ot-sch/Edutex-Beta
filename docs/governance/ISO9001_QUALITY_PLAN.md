# ISO 9001 quality-management plan

Release baseline: 1.0.0-rc.5 / 2026-08-12

Reference baseline: ISO 9001:2015 and Amendment 1:2024. ISO 9001 remains a supporting priority while
ISO/IEC 27001 is the primary security-governance target.

This plan prepares software evidence; it does not certify the operating organisation. Reconcile it
with the organisation’s licensed standard and quality-management system (QMS).

## Quality scope and interested parties

Scope: design, development, deployment, onboarding, operation and support of Edutex. Interested
parties include schools, students/guardians, staff, regulators, operators, suppliers, testers and
support personnel. Determine and record climate-change relevance and interested-party requirements
under Amendment 1:2024.

## Quality objectives

| Objective                | Measure                                   | Target                              | Evidence owner       |
| ------------------------ | ----------------------------------------- | ----------------------------------- | -------------------- |
| Correct tenant isolation | Cross-tenant test pass rate               | 100%; zero accepted leakage         | Security Engineering |
| Reliable release         | Mandatory gate pass rate                  | 100% before production              | Release Manager      |
| Recoverability           | Quarterly restore success and RTO/RPO     | 100%; approved service target       | Service Owner        |
| Defect containment       | Escaped Sev-1/2 defects                   | Downward trend; Sev-1 = zero target | Engineering Lead     |
| Vulnerability response   | Remediation within policy                 | 100% or live approved exception     | Security Lead        |
| Accessible experience    | Critical WCAG failures on supported flows | Zero at release                     | Product/UX           |
| School onboarding        | First-time-right setup                    | ≥95%, with root cause on failures   | Customer Operations  |
| Support responsiveness   | Acknowledge priority incidents            | Within published SLA                | Support Lead         |

Targets are reviewed quarterly and after a significant incident. A target does not permit
concealment or reclassification of defects to improve metrics.

## Process controls

### Requirements and design

Every change traces to an approved user, legal, security, quality or operational requirement.
Acceptance criteria include negative/security behavior, mobile/accessibility behavior, data effects,
telemetry and rollback. Architecture/security review is required for new trust boundaries, data
classes, identity methods, suppliers or cryptography.

### Development and verification

The definition of done is in `CODEBASE_STANDARDS.md`. Peer review checks requirements, correctness,
tenant isolation, security, accessibility, tests, migration, operations and documentation. The
reviewer cannot be the only author of a critical control. Test evidence is attached to the immutable
source revision and container digest.

### Release and change control

Normal releases require approved change record, gate output, risk status, CDK/Terraform plans,
database rehearsal, rollback threshold, communications and two-person approval. Emergency releases
use the same technical controls where possible and receive retrospective review/CAPA within two
business days.

RC5 turns that sequence into four repeatable stages. The guided configuration is the controlled
input; the read-only preflight establishes readiness; the plan records source/configuration/plan
hashes and quality evidence; and apply checks approvals/window/hashes before executing a fixed
zero-task foundation → migration → bootstrap → activation sequence. Owner-only progress records
support traceability and recovery after interruption. A failed stage is a nonconforming output and
must be investigated—not edited around or reclassified as success.

### Supplier and externally provided services

Define requirements, service/security levels, data locations, incident notice, exit, audit evidence
and change monitoring for AWS, Cloudflare, IdPs, SES, npm and testing suppliers. A supplier update
is evaluated for product/service conformity before production adoption.

### Onboarding and service delivery

The school-bootstrap task validates inputs, creates an isolated Cognito pool and relational tenant,
and sends a forced-change temporary administrator credential. Operations verify domain ownership,
branding, login policy, role claims, module visibility, email delivery, synthetic user journeys and
support contacts before accepting the school into service.

## Controlled documented information

Documents carry owner, version/date, classification and review trigger. Source control is the master
for code/runbooks; the QMS records repository is the master for approvals, audit and customer
records. Published PDFs are derived snapshots, not the editable master. Retain superseded records
according to the legal/quality schedule and prevent unintended use.

Release evidence includes source revision, build/test output, runtime and full dependency scans,
SBOM, container digest/signature, migration checksums, infrastructure plans, approvals, smoke
results and known-risk decision.

## Nonconformity and corrective action

1. Contain the impact and protect people/data.
2. Record the nonconformity with objective evidence; do not silently patch production.
3. Determine root and contributing causes (technical, process, human, supplier).
4. Select corrective action proportionate to recurrence risk; assign owner/date.
5. Update code, tests, risk, standards, training and supplier controls as applicable.
6. Verify effectiveness after an appropriate period and close only with evidence.

Security incidents use the incident runbook as well as this CAPA process. Repeated minor defects are
an adverse trend and trigger systemic review.

## Internal audit and management review

Audit the complete lifecycle at least annually and risk-critical processes more often. Auditors must
be objective and not audit their own work. Management review considers objectives, customer
feedback, nonconformities/CAPA, audit results, supplier performance, resource adequacy,
risks/opportunities, security incidents, climate relevance and improvement decisions.

## Improvement backlog

Current mandatory improvements are: permanent CI security services; live tenant/SSO tests; session
inventory/revoke-all; automated retention/deletion; central SIEM alerting; quarterly restore
exercise; accessibility audit; signed image/provenance; and closure of independent penetration-test
findings.

References: <https://www.iso.org/standard/62085.html> and <https://www.iso.org/standard/88431.html>.
ISO states that ISO 9001:2015 remains current while a revision is expected in September 2026; the
QMS owner must perform a transition assessment when the new edition is published.

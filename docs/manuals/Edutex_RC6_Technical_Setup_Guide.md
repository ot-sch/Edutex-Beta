# Edutex RC6 - Technical Setup and Upgrade Guide

Version 1.0.0-rc.6 | 5 September 2026 | For the school's ICT deployment owner

## 1. Read this before choosing an environment

This is an RC6 review build based on the supplied RC5 project. It expands the modules and repairs
installation, migration, authorisation, accounting and responsive UI defects. It is not a
declaration that the entire roadmap is finished or that production acceptance has passed.

**Use synthetic records in an isolated evaluation environment. The roadmap's requirement to encrypt
all data in the browser before database storage is not met.** Selected restricted student fields,
clinical notes and child medical records use browser encryption; ordinary operational fields remain
readable to authorised database processing. A complete encrypted-record architecture, its migration
and its search/reporting design remain release blockers. Disk encryption and HTTPS do not satisfy
that requirement.

There is no ISO certification claim. The organisation still needs a defined scope, licensed
standards, a control assessment, operating evidence and the applicable independent assessment. Web
browsers cannot guarantee that displayed medical information is impossible to photograph or capture.
RC6 therefore supplies an online medical view, not the requested guaranteed non-exportable offline
app.

Read `docs/RC6_ROADMAP_COVERAGE.md` and `quality/RELEASE_VERIFICATION.md` before planning a live
upgrade. Those documents identify implemented behaviour, remaining development and checks that
require the real school environment. Preserve the existing RC5 installation until an authorised
release decision is recorded.

## 2. What is easier in RC6

The dependency-free setup entry point gives the operator one consistent command. It checks the
computer, installs locked dependencies and starts the existing guarded cloud interview, check, plan
and status stages. A separate upgrade interview copies approved school identifiers into a new file
and collects a fresh maintenance window. Upgrades skip creation of another tenant or identity pool.

Cloud credentials are not requested by the interview. AWS sign-in uses a named short-lived SSO
profile. The Cloudflare provider receives its scoped token only for the commands that need it.
Source and plan hashes, private infrastructure, MFA, migration transactions and human plan review
remain in place.

Application users need only the school's approved browser address. Node, Docker, Terraform and AWS
CLI belong on the ICT operator's machine; parents and teachers do not install them.

## 3. Architecture and files

| Component                             | Location and responsibility                                                          |
| ------------------------------------- | ------------------------------------------------------------------------------------ |
| Public sign-in                        | `apps/auth-web`; minimal public authentication client                                |
| School, parent and student workspaces | `apps/portal-web`; React and Tailwind, account-backed preferences                    |
| Technician console                    | `apps/technician-web`; separately built protected client at `/technician/`           |
| Application API                       | `apps/api`; Fastify, server sessions, authorisation and workflow transactions        |
| Shared validation                     | `packages/contracts`; request schemas, record metadata, metrics and alert vocabulary |
| Database                              | `packages/database`; migrations 0001-0029, tenant context, PostgreSQL RLS and audit  |
| Infrastructure                        | `infra/aws` and `infra/cloudflare`; private AWS services and Cloudflare edge         |
| Operator tooling                      | `scripts`; setup, reviewed deployment, bootstrap and bounded legacy import           |

The supported deployment remains one school, exact hostname and AWS stack per installation.
Cloudflare Tunnel is the public access path. The AWS application and database remain private; do not
add a public load balancer, task IP or direct database route to make a failed setup appear healthy.

The ZIP contains maintained source, lockfiles, database migrations, public RDS trust certificates,
documentation and verification evidence. Dependencies and build output are regenerated. The UI
review fixtures and their simulated accounts are excluded from the deliverable.

## 4. Prepare the operator computer

Extract the ZIP into a new directory. Open a terminal in `Edutex-production`, the directory
containing `package.json`. Keep operator configuration and deployment evidence in a private
directory outside that source tree.

Install Node.js 24 or newer, npm 11 or newer, AWS CLI v2, Terraform 1.10 or newer but below 2.0, and
Docker Engine 24 or newer with Buildx. Use vendor-supported installers. The Terraform configuration
requires Cloudflare provider 5.10 or newer but below 6.0; the exact selected provider lock is bound
into the reviewed plan.

```text
npm run setup -- check
npm run setup -- install
npm run quality
```

`check` reports missing tools and a stopped Docker engine without changing cloud resources. It is
not proof of AWS permissions. `install` runs `npm ci --ignore-scripts`, followed by the specific
Sharp rebuild required for photo processing. Do not replace the lockfile with a broad dependency
update while following a reviewed deployment.

The strict quality command checks source documentation, types, tests, lint, formatting, all
production builds and publication artifacts. Typed linting allows a 6 GiB Node heap; provide
sufficient workstation memory. Verify an ARM64 image build on the operator machine because the
production task architecture is ARM64. Docker was unavailable in this build environment, so image
creation, scanning and signing remain target checks.

The setup launcher avoids shell interpolation and resolves npm on Windows. Windows ACLs, Docker
Desktop, installed browsers and cloud deployment still require an actual Windows acceptance test. A
successful compilation here does not prove every operating system works.

## 5. Collect approved cloud values once

Ask the cloud owner to prepare the following worksheet. Record identifiers and ARNs, not secret
values, in the setup interview.

| Area            | Values and prerequisites                                                                                                                   |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| AWS             | Dedicated account ID, approved region, named SSO profile, required quotas and a ready `CDKToolkit` bootstrap stack                         |
| School          | Slug, legal name, campus, academic year and dates, IANA timezone, country and initial administrator                                        |
| Domain          | Exact lower-case school hostname, Cloudflare account ID, zone ID and named Tunnel ID                                                       |
| Edge security   | Purchased WAF capabilities, TLS policy, approved IP/country policies and administrative networks                                           |
| Tunnel secret   | Same-account, same-region Secrets Manager ARN with an `AWSCURRENT` version containing the actual Tunnel token                              |
| Terraform state | Private, versioned S3 bucket in the approved region; customer-managed KMS key ARN; S3 Bucket Key enabled; all public-access blocks enabled |
| State key       | `edutex/SCHOOL_SLUG/cloudflare.tfstate`, using the actual school slug                                                                      |
| Email           | Verified SES identity ARN, sender address and optional configuration-set name in the same account and region                               |
| Alert delivery  | Optional verified SES alert sender; SMS disabled unless destination registration, production access and spending controls are approved     |
| Change          | Approved change ID, release manager, security approver, start and end timestamps with UTC offsets                                          |

Configure AWS SSO using the school's approved permission set, then sign in:

```text
aws sso login --profile YOUR_PROFILE
```

The deployment assistant deliberately rejects ambient `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`,
`AWS_SESSION_TOKEN`, web identity/role overrides and `TF_VAR_cloudflare_api_token`. Remove
conflicting variables using your organisation's terminal procedure and use the named SSO profile.

Create the Cloudflare Tunnel and least-privilege API token through the approved cloud process. Store
the Tunnel token directly in Secrets Manager without putting it in source, command history,
screenshots or the setup JSON. Supply the provider token as `CLOUDFLARE_API_TOKEN` only in the
operator session running the Cloudflare plan/apply. Do not put either token in Terraform input
files. Clear the provider token when the work ends.

The current Setup Guide for Everyone retains the detailed numbered cloud and workstation
walkthrough. Its Step 17A addresses a missing CDK bootstrap without assuming the absent RC5
companion policy JSON exists. Use approved execution and boundary policies; do not substitute
administrator access. The historical manuals remain reference material; use the RC6 assistant for
this build. Do not combine an old apply receipt with new source.

## 6. Create a new-school evaluation configuration

Use a new empty evaluation account/environment and synthetic school details. Obtain valid cloud
identifiers first; placeholders do not create usable infrastructure.

```text
npm run setup -- configure --output ../edutex-operator/school/rc6.json
npm run setup -- check-cloud --config ../edutex-operator/school/rc6.json
```

The interview validates each answer and the account/region/hostname relationships. Configuration is
non-secret but still school-sensitive and is written with owner-only permissions where the operating
system supports them. Do not publish it with the source ZIP.

Cloud checks verify local tool versions and Buildx, AWS caller account, CDK bootstrap readiness,
Tunnel secret metadata, remote-state controls, KMS and SES prerequisites. They do not retrieve the
Tunnel secret value. A passing check is a prerequisite for planning, not a deployment or a
production acceptance decision.

## 7. Upgrade an existing RC5 school safely

Before any live change, close the release blockers, rehearse the upgrade in an isolated restored
environment, verify backups and agree a maintenance window. Retain the old ZIP, deployment
configuration, receipt, migration checksums, tenant ID, identity pool/client IDs and key/secret
ARNs. RC6 migrations are forward-only; an old application ZIP is not a database rollback.

Create the RC6 configuration from the actual RC5 configuration:

```text
npm run setup -- upgrade \
  --from ../edutex-operator/school/production.json \
  --output ../edutex-operator/school/rc6.json
npm run setup -- check-cloud --config ../edutex-operator/school/rc6.json
```

The new file has release `1.0.0-rc.6` and purpose `existing-school-upgrade`. It preserves the
school's cloud identity and uses fresh change information. It neither overwrites the old file nor
reruns new-school bootstrap. Use `configure` only for a genuinely new school.

Perform these data reviews in the restored rehearsal before planning the live change:

1. Resolve duplicate non-null account links in student, staff and guardian records through an
   approved identity review. Migration 0025 adds uniqueness/category checks and stops if duplicate
   links remain; it does not delete or merge people automatically.
2. Confirm each guardian account links to the correct guardian record and each student account to
   the correct student record. Confirm guardians' separate portal, medical, consent and
   communications rights.
3. Review default parent and student role changes. They receive community portal access only;
   inherited staff-module grants no longer confer staff access on community accounts. Do not restore
   broad staff roles as a workaround.
4. Review published forms. Explicit parent and student collection modes separate community forms
   from internal staff forms.
5. Allocate draft invoice fees explicitly to authorised guardians. Parent fee views show only that
   guardian's allocation and payments. Existing unallocated invoices do not become visible merely
   because two people share a family record.
6. Configure school periods, terms, groups and important dates before relying on new calendars or
   timetable alerts.

The migrator serialises concurrent migration runs and sets audit context for data-changing
migrations. Three RC5 extension references required exact source repairs in 0004, 0006 and 0009.
`migration-compatibility.ts` accepts only the recorded original/corrected SHA-256 pairs; migration
0012 repairs installed functions. Other changed historical checksums still stop the upgrade. Never
edit the migration ledger or invent a compatibility hash to force a run.

The supplied integration suite also upgrades a populated RC5 schema and checks preservation of the
existing tenant and administrator. This is useful evidence, but the school's real RDS instance,
extension versions and actual data must still be rehearsed.

## 8. Plan, review, then apply the same bytes

```text
npm run setup -- plan --config ../edutex-operator/school/rc6.json
```

Planning runs the quality gate, Terraform validation and saved plan, AWS synthesis and diff. It
saves human-readable evidence, the exact Terraform/provider lock and CloudFormation assembly, plus
source/configuration hashes. Review the printed evidence paths and `plan-record.json` SHA-256.
`PLAN READY` means a plan exists; nothing is approved merely because the command printed it.

Review both cloud diffs with the designated approver. Check school/account/hostname, private
networking, KMS and IAM scope, deletion/replacement proposals, desired application count, log
retention, SES/SNS access and purchased WAF features. For an upgrade, stop on unexpected replacement
of database, identity or cryptographic resources.

Long commands may wrap in the PDF. Use the complete command block from the matching Markdown guide
in the ZIP. A final backslash continues that same command onto the next line in Bash or zsh. The
following is the explicit apply pattern. Replace every uppercase placeholder with the approved
value; do not use a made-up hash.

```text
npm run deploy:apply -- \
  --config ../edutex-operator/school/rc6.json \
  --execute \
  --approval-id CHANGE_ID \
  --confirm-hostname SCHOOL_HOSTNAME \
  --confirm-record-sha256 APPROVED_SHA256
```

Use the same `--work-dir` on plan/apply/status if you choose a non-default evidence directory. Keep
source, lockfiles, configuration and evidence unchanged between approval and apply. A changed hash
requires a new plan and review.

Apply establishes the Cloudflare edge and private AWS foundation with application count zero, runs
private migrations, performs school bootstrap only for a new school, then activates the configured
service count. It records progress and task ARNs. An existing school experiences a maintenance
outage during the zero-task stage; schedule and communicate it.

Check status with:

```text
npm run setup -- status --config ../edutex-operator/school/rc6.json
```

Do not create another school when a task fails. Inspect the recorded ECS task ARN and its container
exit code/logs. An explicitly failed migration/bootstrap can be retried only through the assistant's
exact-task retry controls after correcting its cause. An interrupted operator terminal does not
prove that its cloud task failed. Preserve the work directory and use the same reviewed
configuration.

## 9. Authenticate and configure the school

After a successful evaluation deployment, follow the initial administrator invitation through the
approved hostname. Complete password/TOTP setup and test sign-out, a new sign-in and session
revocation. Keep a tested school recovery procedure and separate authorised recovery administrators.

RC6 creates the Cognito pool with required MFA/password first, configures TOTP and user-verified
WebAuthn as a multifactor factor, then enables the passkey first-factor option. This avoids
attempting passkey-first MFA before its factor configuration exists. Test passkey registration and
sign-in using actual supported authenticators and the managed-login relying-party domain. Current
AWS behaviour is described in
[Cognito MFA documentation](https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-settings-mfa.html).

Microsoft Entra ID, Google Workspace, generic OIDC and SAML configuration remain available. Stage
providers disabled; map exact trusted provider claims to narrowly scoped Edutex roles; test allowed,
unassigned, disabled and revoked users; then enable the provider. Google identity federation does
not import Google Classroom classes, coursework or assignments. Classroom synchronisation remains
unimplemented.

Enable modules intentionally and give each role only the work it needs. `manage` covers that
module's operations; high-impact operations also require recent MFA and workflow conditions. The
technician console requires authorised staff and recent MFA. Parent/student categories cannot
acquire staff-module access by receiving a broad staff role.

## 10. Enter school records in a usable order

Start with campus, academic year, terms, period times, rooms, staff/student/guardian accounts and
their verified links. Then create classes and memberships, groups and group managers, and important
dates. No-class dates can apply school-wide or to selected year levels. The database prevents
conflicting terms and overlapping periods and blocks attendance rolls on applicable no-class dates.

Use the resource search and named reference selectors to link records; staff should not have to type
UUIDs. Missing references usually mean the record has not been created, is outside the user's
permissions, or is not in the current school. Request the appropriate permission; do not broaden
database access.

Configure communications contacts, form collection mode and published learning records before
inviting parent and student test accounts. Account-backed dashboard and appearance preferences
persist after another device signs in; they are not stored in browser local storage.

For migration from the earlier prototype, the existing `legacy:plan` and `legacy:import` tools
remain bounded importers. They are not general accounting or all-module conversion tools. Map and
reconcile every source dataset separately, preserve encrypted fields and immutable IDs where
required, and review unmapped data. The RC5 handbook describes the existing importer contract.

## 11. Finance and event acceptance

Create a reviewed chart of accounts (or use the supplied school GL template), budget records and
required account references before posting workflows. RC6 supports purchase-order approval,
receipt/bill matching, invoice issue, manual payment settlement, balanced journal creation and bank
reconciliation. Creator/approver separation, row versions, currency checks and duplicate-source
guards apply.

For split fees, create guardian allocations while the invoice is draft. Their sum must equal the
invoice total before issue. A settled payment references the appropriate allocation and cannot
exceed its remaining share. Test partial payments, repeat attempts and denied access with two
guardian accounts from the same family. An unverified browser action does not mean funds were
received.

Purchase orders, supplier bills, budgets and payroll use AUD. Invoices, receipts and bank accounts
can name a currency, but FX conversion and international payroll are not implemented.

Payroll records support ordinary/overtime minutes, gross/tax review and payment references.
Automatic timetable-to-payroll calculations, award interpretation and government lodgement are not
supplied. Sibling/scholarship policy records do not automatically recalculate invoices. The 14 fixed
reports are review tools; GST output is a working paper, and the balance sheet is explicitly before
period closing. Automated card/direct-debit collection, bank transfers, FX, consolidation and a
complete statutory accounting engine remain outside this build.

For events, configure venues, risk templates, event templates, approval streams, staff
return-to-work considerations, student/staff participation, budget/GL links and emergency
arrangements. Template selection copies editable planning defaults. Approvals record decisions and
enforce the implemented emergency, supervision and risk conditions; they do not substitute for a
staff risk assessment.

Publish eligible event invitations to parents. Staff can generate paper consent forms and record a
referenced paper decision in the append-only consent history. Parent portal consent and paper
consent remain distinguishable. Use the pending-consent Smart Alert template after previewing its
actual time scope.

## 12. Insights, alerts and delivery

Insights offers KPI, bar and table tiles, colours, selected financial/headcount fields and daily
through yearly scopes including terms and a shared dashboard timeline. Choose a currency for
monetary tiles. Group managers can share dashboards with groups they manage. The server checks both
ownership/sharing and access to the underlying dataset; sharing a dashboard does not grant data
access.

Smart Alerts supports ten bounded data sources, all/any conditions, record/distinct-day counts where
supported, time windows, dashboard/email/SMS actions and group sharing. Choose recipients
explicitly. Save a disabled rule, preview its matches, check the source dates and recipients, then
enable it. The engine is not an arbitrary SQL or unlimited automation platform. Its 10,000-row scan
guard fails visibly; narrow a large window instead of accepting a partial result.

The worker polls approximately every minute and claims rules on their scheduled interval. Queue
deduplication prevents repeated delivery for the same rule/window/matched group/channel/recipient.
It rechecks owner permissions. A source privilege revocation stops evaluation or delivery.

Email requires a verified SES sender and production sending permissions. SMS requires SNS
configuration, valid E.164 guardian numbers, applicable registrations and approved spend. AWS
explains delivery prerequisites in its
[SNS SMS overview](https://docs.aws.amazon.com/sns/latest/dg/sms_sending-overview.html). Do not
enable live sends in synthetic tests. A provider acceptance receipt is not proof the recipient read
the message. Uncertain delivery is retained for operator review instead of automatic repeated sends.

Invoices are evaluated within the chosen source-date window. An older outstanding invoice outside
that window will not match; use an appropriate scope and reconcile with the debtor report. Staff SMS
numbers and arbitrary external email recipient entry are not supplied by this builder.

## 13. Medical privacy, retention and access

Restricted student fields and clinical notes use AES-GCM browser envelopes. Parent medical access
uses a child-scoped derived key after an explicit relationship check; it does not disclose the
school's general field key. Read access is audited. Staff event access requires the configured
participant/window conditions; nurse and assigned wellbeing access follow their module/case
permissions.

The online medical view clears on hiding, session expiry, record teardown and after its short access
deadline (currently 60 seconds). Late key responses cannot restore cleared key material; a new
exchange is needed after reopening. Other restricted student/clinical views lock on hiding and after
five minutes. Reopen it to reauthorise. Save changes before the deadline. There is no service-worker
cache or offline medical download. Print styling suppresses the medical workspace, but a browser
cannot stop every screenshot, device capture or camera. Treat the visible endpoint as part of the
school's privacy boundary.

Do not put medical narratives into ordinary free-text fields, alerts or form titles. This does not
repair the all-data encryption gap: ordinary records, indexes, operational analytics and some audit
metadata still depend on server-readable fields. Completing that requirement needs an explicit new
cryptographic data model, key lifecycle, existing-data conversion and tests, not a claim that
database-at-rest encryption is equivalent.

## 14. Verification and release decision

Retain the RC6 quality log and dependency audit with the build. The local integration suite uses
real PostgreSQL through PGlite, applies all 29 migrations, switches to the restricted application
role and tests workflow transactions and negative authorisation. Its HTTP identity is a test
adapter; it does not prove Cognito/RDS/IAM behaviour in AWS.

The browser review used synthetic records in Chrome at 320, 390 and 768 pixel widths and desktop
width. It inspected the dashboard, appearance, navigation, tables, insights, alerts, family/student
dialogs and technician client. Physical iPhone/Android, Safari, Firefox, Windows/macOS/Linux
combinations, keyboard/screen-reader audits and installed home-screen behaviour remain acceptance
checks. The final repeat browser pass was blocked by the review browser URL policy; the final
lifecycle fixes were checked with the compiler and cryptographic regression tests.

Before admitting client data, close the documented development blockers and run the actual cloud
plan, Docker build/scan/signing, RDS migration rehearsal, two-tenant and guardian isolation tests,
identity/factor recovery tests, WAF/direct-origin tests, SES/SNS tests, load tests, isolated
backup/restore and independent security assessment. Keep business, privacy and clinical owners
involved in their own acceptance scenarios.

If a migration or acceptance check fails, keep the application unavailable to ordinary users,
preserve the logs and investigate. Restoring a database is a controlled recovery into an isolated
verified environment with its matching application and key material. Do not drop new tables, edit
migration checksums or delete audit history as an improvised rollback.

## 15. Troubleshooting and handover

| Symptom                                   | Next step                                                                                               |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `node`/`npm` not found                    | Install the supported runtime, reopen the terminal and rerun the computer check.                        |
| Docker needs attention                    | Start the engine, confirm Buildx and ARM64 capability; rerun the check.                                 |
| Wrong AWS account or credentials rejected | Sign in with the approved SSO profile; remove conflicting static credential variables.                  |
| State/KMS/Tunnel preflight failure        | Correct the named prerequisite resource or policy; never disable the check.                             |
| Plan hash mismatch                        | Recreate and review a plan from the final source/configuration.                                         |
| Migration checksum mismatch               | Compare the exact release file and recorded ledger; only the three documented RC5 repairs are accepted. |
| Duplicate person-account link             | Correct identity links in the restored rehearsal under approved data stewardship; no automatic merge.   |
| 403 or recent-MFA prompt                  | Verify account category, module permission and fresh sign-in.                                           |
| Parent has no children or fees            | Verify the person-account link, guardian rights and explicit invoice allocations.                       |
| Medical view closes                       | Reopen online and reauthorise; it intentionally does not retain offline content.                        |
| Alert produces no match                   | Check source permission, selected time window, condition types and preview output.                      |
| Alert is blocked/uncertain                | Inspect the delivery record and provider evidence before considering a resend.                          |
| Record changed conflict                   | Reload, compare the latest row and reapply only the intended edit.                                      |

Hand over the exact ZIP checksum, configuration and plan/receipt paths, approved cloud inventory,
recovery contacts, key/secret inventory, backup evidence, role matrix, open roadmap items and
support ownership. Keep credentials outside this handover document.

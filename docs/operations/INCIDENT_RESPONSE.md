# Security incident response playbook

Release baseline: 1.0.0-rc.5 / 2026-08-12

## Severity and first response

| Severity | Example                                                                        | Acknowledge target | Initial action                                                |
| -------- | ------------------------------------------------------------------------------ | ------------------ | ------------------------------------------------------------- |
| Critical | Active cross-tenant disclosure, RCE, privileged takeover, key/DB exfiltration  | 15 minutes         | Incident commander; contain; legal/privacy; preserve evidence |
| High     | Exploitable auth bypass, leaked production secret, destructive integrity event | 1 hour             | Security lead; scope/contain; rotate/revoke as approved       |
| Medium   | Limited exploit with strong prerequisites, suspicious repeated control failure | 1 business day     | Triage, monitor and schedule treatment                        |
| Low      | Hardening issue with no demonstrated exposure                                  | 3 business days    | Record and prioritize                                         |

Targets must be reconciled with contracts and breach-notification law.

## Roles

Incident commander coordinates; security lead directs technical investigation; service owner
controls safe service changes; communications/legal/privacy determine notices; evidence custodian
maintains chain of custody; school liaison provides tenant communication. Name primary/deputy
contacts before launch and keep an offline contact copy.

## Workflow

1. **Detect and declare.** Record UTC time, reporter, request IDs, affected tenant/system, symptoms
   and severity. Open a restricted incident record.
2. **Preserve.** Protect Cloudflare logs, Cognito events, CloudTrail, application log groups, RDS
   logs, VPC flow logs, database audit rows, infrastructure state and relevant snapshots. Hash
   exports; document collector, source and time. Do not delete/rotate evidence blindly.
3. **Contain.** Prefer precise controls: disable tenant/user, delete affected session, block CIDR,
   disable provider/module, revoke tunnel/IdP secret, stop rollout or isolate tasks. Maintain a
   functional break-glass path and record every action.
4. **Investigate.** Build a UTC timeline, validate audit-chain continuity, determine initial access,
   persistence, tenants/data/actions affected and whether the vulnerability remains exploitable.
5. **Eradicate and recover.** Fix root cause, rotate affected secrets/keys, restore verified data,
   redeploy immutable artifacts and increase monitoring. Do not reuse a compromised image/task.
6. **Notify.** Legal/privacy determine regulator, school, individual, insurer and supplier
   obligations. Communicate known facts, impact, actions and next update; avoid speculation.
7. **Close and improve.** Complete root cause/CAPA, lessons learned, control/test/runbook/risk
   updates and effectiveness review. Retain evidence to the approved schedule.

## Scenario actions

### Session or account takeover

Disable user if needed, delete known sessions, request session-table query/revoke-all under
emergency procedure until product workflow exists, revoke Cognito tokens/factors, examine directory
changes and role mappings, require fresh phishing-resistant auth and notify the school.

### IdP secret exposure

Disable provider at Edutex and Cognito, rotate upstream credential into Secrets Manager, verify no
secret in logs/build/tickets, inspect CloudTrail/IdP use, update provider and test before
enablement.

### Tunnel token exposure

Rotate/revoke connector token in Cloudflare, update Secrets Manager, force new Fargate deployment,
remove unrecognized connectors and inspect tunnel/DNS/ruleset changes. The AWS origin must remain
without ingress throughout.

### Database or KMS concern

Restrict task role/network, snapshot and preserve logs, examine RDS Proxy/IAM/KMS decrypt events,
rotate roles/keys using a tested re-encryption plan, validate tenant/audit integrity and restore
only from a known-good point. KMS key deletion is never an improvised containment step.

### Cross-tenant access

Treat as critical. Disable affected function/tenant access, preserve exact identifiers and queries,
identify every reachable record, assess notifications, fix API + RLS + FK/test layers and run a full
two-tenant regression before recovery.

## Communications template fields

Incident ID; UTC start/detection; current severity; affected service/tenant/data categories; what is
known/unknown; containment; user action; service status; next update time; approved contact. Never
put secrets or unnecessary personal data in status messages.

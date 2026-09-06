# Security policy

Edutex handles school, staff and student information. Treat suspected disclosure, account takeover,
cross-tenant access, authentication bypass, authorization bypass, remote code execution,
cryptographic failure and audit-log integrity failures as urgent.

## Reporting

Do not open a public issue. Send the report through the private security channel configured by the
deploying organisation. Include the affected tenant, route or component, reproduction steps, impact,
request IDs and the smallest necessary evidence. Do not include real student information.

The operating organisation must publish its security contact and acknowledgement targets before
launch. The default targets are 4 hours for critical reports, one business day for high reports and
three business days for all others.

## Supported releases

Only the current production release receives security fixes. Deployments must use the immutable
container digest approved by the release pipeline. Runtime dependencies with a known high or
critical advisory block release unless the security owner records a time-bounded exception.

## Safe testing

Penetration testing requires a written scope, dedicated tenant, synthetic data, source IP list, test
window and emergency stop contact. Denial-of-service, social engineering, destructive data changes
and tests against third-party identity providers require separate approval.

## Disclosure handling

Preserve Cloudflare, Cognito, CloudTrail, VPC flow, application and PostgreSQL audit evidence. Never
rotate or delete evidence before the incident lead confirms collection. Follow
`docs/operations/INCIDENT_RESPONSE.md`.

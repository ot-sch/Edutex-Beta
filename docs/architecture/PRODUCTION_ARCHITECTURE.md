# Production architecture

Document owner: Platform Architecture  
Classification: Internal  
Version: 1.0.0-rc.5 / 2026-08-12

## Design objectives

Edutex uses a backend-for-frontend architecture with a private origin, strong tenant boundaries,
short trust chains and independently deployable public and protected clients. The browser has no AWS
credentials, database credentials, Cognito tokens or third-party client secrets.

![Edutex production request and data-service architecture](docs/assets/production-architecture.png)

## Trust boundaries

| Boundary                      | Crossing control                                                     | Data allowed                               |
| ----------------------------- | -------------------------------------------------------------------- | ------------------------------------------ |
| Internet to Cloudflare        | TLS, DDoS, WAF, OWASP managed rules, method/rate/IP/country policy   | Browser requests only                      |
| Cloudflare to AWS task        | Authenticated named Tunnel initiated outbound; no origin ingress     | Proxied HTTP on task loopback              |
| Browser to public auth bundle | Strict CSP, no third-party scripts, no protected assets              | School branding and approved methods       |
| Browser to protected bundle   | Valid opaque session required before every asset; private `no-store` | Authorized portal UI                       |
| API to Cognito/Secrets        | IAM + HTTPS, confidential exchange, live MFA/provider/JWT validation | Auth configuration and transient tokens    |
| API to PostgreSQL             | RDS Proxy, IAM token, TLS verify-full, runtime role                  | Parameterized SQL under tenant transaction |
| Provisioning to writer        | One-shot task, dedicated SG, Secrets Manager injection               | Schema, school bootstrap or legacy import  |
| API to KMS/S3/DynamoDB        | ECS task role and resource policies                                  | Minimum resource-specific operations       |

## Network topology

The VPC spans up to three availability zones. Fargate tasks run in private-with-egress subnets; the
database and RDS Proxy run in isolated subnets. The application security group has no inbound rule.
Only the service security group can reach the proxy. Only the one-shot migration/provisioning
security group can reach the Aurora writer directly. Database ingress is TCP 5432 from those exact
security groups and no CIDR.

The Cloudflare connector is a sidecar in the same task. It reaches the API on `127.0.0.1:8080` and
opens outbound sessions to Cloudflare. Terraform publishes only a proxied CNAME to the tunnel. A
catch-all tunnel ingress returns 404.

## Runtime components

| Component               | Scale and state                                        | Failure behavior                                                     |
| ----------------------- | ------------------------------------------------------ | -------------------------------------------------------------------- |
| Authentication web      | Static Vite bundle served by API                       | Public bundle remains minimal; no tenant data                        |
| Portal web              | Static Vite bundle behind session hook                 | Unauthenticated requests receive 401/redirect, never files           |
| Fastify API             | 0 during foundation; then 3-30 stateless Fargate tasks | Migration/bootstrap gate before activation; circuit-breaker rollback |
| Cloudflared             | Essential sidecar per task                             | Task replaced if tunnel process exits                                |
| DynamoDB session tables | On-demand, PITR, TTL, KMS                              | Authentication fails closed if unavailable                           |
| Aurora PostgreSQL       | Serverless v2 writer + production reader               | RDS backups/PITR; writes fail rather than bypass controls            |
| RDS Proxy               | IAM-only and TLS-required                              | Bounded pool absorbs connection churn                                |
| S3 files                | Private, versioned, KMS, TLS-only                      | Database metadata does not grant direct browser access               |
| Legacy migration task   | Explicit one-shot, private writer path                 | Reads only short-lived KMS S3 staging prefix                         |

## Tenant and authorization model

The verified request hostname resolves exactly one active tenant through a narrow security-definer
function. Authentication establishes an internal user from `(tenant_id, Cognito subject, provider)`.
Directory mappings assign normalized roles and categories by explicit provider claim rules.
Cognito's bounded multi-value representation is decoded before exact matching. Each federated
sign-in removes stale directory-managed role grants, applies current matches and fails closed when
no enabled provider mapping remains; explicit human assignments retain their assigning user.

Every request refreshes server-side identity state at most 60 seconds after the previous check. The
API checks the required permission; PostgreSQL receives tenant, user, permission and request values
with transaction-local `set_config`. Row-level policies require the tenant match and module action.
Composite foreign keys include `tenant_id`, so a valid identifier from one tenant cannot become a
relationship in another.

## Availability and recovery

Fargate spans application subnets and maintains at least three production tasks. Aurora has a reader
in production, automated backups and AWS Backup coverage. DynamoDB uses point-in-time recovery. S3
uses versioning. The backup vault is KMS encrypted and production Vault Lock enforces retention.
Recovery is not considered proven until the quarterly isolated restore test has recorded measured
RPO/RTO evidence.

## Architecture decisions

| Decision                                   | Rationale                                                           | Consequence                                                                     |
| ------------------------------------------ | ------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| One Cognito pool per school                | Tenant-specific login policy, branding and IdP isolation            | More control-plane objects and explicit onboarding                              |
| Opaque sessions instead of browser JWTs    | Immediate revocation and no token exposure to JavaScript            | DynamoDB is a critical dependency                                               |
| Normalized PostgreSQL core                 | Enforced relationships, queryable constraints and stable migrations | Dynamic form schemas remain bounded JSONB                                       |
| Separate auth and portal bundles           | Reduces unauthenticated attack surface and protected code delivery  | Client code is still not a secret after authorized delivery                     |
| Cloudflare Tunnel instead of public origin | Eliminates direct-origin bypass                                     | Cloudflare and tunnel availability enter the dependency chain                   |
| Browser field encryption for selected data | Limits plaintext exposure in database compromise                    | Does not protect against an authorized browser, XSS or compromised API/KMS role |
| One school/hostname per production stack   | Global callback/base URL and one Tunnel ingress remain unambiguous  | Repeat the complete stack/state/evidence set for each client                    |
| Private S3-staged legacy task              | Moves an offline export without browser or database ingress         | Only four core collections are automated; staging expires after eight days      |

## Deployment boundary

CDK and Terraform are both required. CDK owns AWS resources; Terraform owns Cloudflare resources.
Neither tool may own the same DNS, tunnel or AWS object. Production applies require a stored plan,
immutable source revision and two-person approval.

RC5's assistant is the orchestration boundary: one validated non-secret configuration feeds both
tools; preflight proves the AWS/state/KMS/SES prerequisites; the plan record hashes source,
configuration and Terraform plan; and apply creates the AWS foundation with zero application tasks.
Only successful private migration and school bootstrap jobs permit activation at the approved
minimum of three tasks. Deterministic ECS client tokens and atomic progress records prevent an
interrupted operator terminal from becoming a duplicate one-shot job. A stopped failed job can be
replaced only through the explicitly approved exact-ARN retry option; predecessor ARNs remain in a
bounded evidence history and completed stages cannot be retried.

The supported RC5 production unit is one AWS stack, exact hostname and school. Relational tenant
controls remain as defence in depth and for isolation testing; adding a second client hostname to a
stack is unsupported while `PUBLIC_BASE_URL` and Tunnel ingress are stack-global.

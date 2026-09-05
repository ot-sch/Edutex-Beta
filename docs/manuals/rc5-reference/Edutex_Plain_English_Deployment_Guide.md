---
title: 'Edutex Setup Guide for Everyone'
subtitle: 'Release candidate 5 · assembly-manual edition'
author: 'Edutex Engineering'
date: '12 August 2026'
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
  - left=18mm
  - right=18mm
colorlinks: true
linkcolor: EdutexBlue
urlcolor: EdutexTeal
toccolor: EdutexBlue
toc-depth: 2
secnumdepth: 2
---

# Read this one page before doing anything

This manual sets up **Edutex 1.0.0-rc.5 for one school**. It is written like furniture assembly:
collect the labelled parts, complete one numbered action, compare the result, and stop if it does
not match.

There is **no paper deployment worksheet and no hidden website form**. When this guide says “answer
the setup questions”, you type each answer into the **Terminal panel at the bottom of Visual Studio
Code**. RC5 creates the file for you. Do not create or edit `production.json` by hand.

## The four commands that do the deployment

| Command                | Plain-English job                                                           | Can change production? |
| ---------------------- | --------------------------------------------------------------------------- | ---------------------- |
| `npm run deploy:new`   | Asks one setup question at a time and saves non-secret answers              | No                     |
| `npm run deploy:check` | Checks your computer and approved AWS prerequisites                         | No; read-only          |
| `npm run deploy:plan`  | Tests/builds RC5 and creates Cloudflare/AWS plans for approval              | No production apply    |
| `npm run deploy:apply` | Applies the approved plan, migrates, creates the school, then starts Edutex | **Yes**                |

## What “Terminal” means in this manual

The Terminal is a text panel inside Visual Studio Code—not an AWS page and not a Cloudflare page. To
open it at any time:

1. Look at the very top of the Visual Studio Code window.
2. Click the menu named **Terminal**.
3. Click **New Terminal**.
4. Look at the bottom of the Visual Studio Code window. A panel with a blinking cursor appears.
5. Click once next to the blinking cursor. That is where commands in grey boxes are typed.
6. Type or paste **one complete command**, then press the keyboard **Enter/Return** key once.
7. Never type the decorative `$` used by some other manuals; this manual does not show one.

## Stop rules

Stop immediately—do not “try something”—if:

- anyone asks you to paste a password, API token, Tunnel token, private key, recovery code or AWS
  access key into `production.json`, source code, a ticket, chat, screenshot or ordinary text file;
- a command says `failed`, `error`, `NOT ACCEPTED`, `access denied`, `wrong account`, `invalid`,
  `destroy`, or exits without the exact success line shown in its step;
- the AWS account ID, region, school hostname or change ID is not exactly the approved value;
- a plan shows a public AWS load balancer/IP, public database access, an unexpected deletion, a
  second school/hostname, or weaker WAF/MFA/RLS/TLS/IAM controls;
- source/configuration/plan bytes change after approval;
- the current time is outside the approved maintenance window; or
- migration/bootstrap does not report container exit code zero.

Call the named Cloud/Security or Release owner. Preserve the terminal output and `work` folder. Do
not delete evidence, open network access, disable a security check or manually start another ECS
task.

\newpage

# Parts list: collect these before Step 1

Do not start assembly with a missing part.

**Assurance boundary:** RC5 maps technical controls and evidence to OWASP ASVS/Top 10 and supports
ISO/IEC 27001 and ISO 9001 management systems. Source alone is not “100% compliant” or certified;
approval also requires live controls, retained evidence, audit, management review, independent
penetration testing and any claimed accredited certification.

## People

| Label | Person you need            | What that person must provide/approve                                               |
| ----- | -------------------------- | ----------------------------------------------------------------------------------- |
| P1    | Release Manager            | RC5 ZIP/checksum, release approval and exact change ID/window                       |
| P2    | AWS Cloud Owner            | Dedicated account, SSO role, CDK bootstrap, state bucket/KMS, SES and permissions   |
| P3    | Cloudflare/Edge Owner      | Zone, Tunnel, plan entitlement, restricted temporary API token and edge approval    |
| P4    | Security Approver          | Reviews plan, IAM/network/WAF, stop rules and evidence                              |
| P5    | School Data/Identity Owner | School details, initial admin, login methods, directory claims/roles and acceptance |
| P6    | Deployment Operator        | Follows this manual on the managed workstation                                      |
| P7    | Independent Tester         | Tests the deployed target and reports vulnerabilities independently                 |

P2/P3/P4 are skilled roles even though this manual uses plain language. “Easy to follow” does not
mean an unapproved person should receive production administrator access.

## Accounts and cloud parts

- Dedicated production AWS account ID (12 digits).
- Approved AWS region, such as `ap-southeast-2`.
- IAM Identity Center start URL, Identity Center region, account permission-set/role and approved
  CLI profile name.
- Stable modern CDK bootstrap stack named `CDKToolkit` in that account/region.
- Customer-managed symmetric KMS key for Terraform state; key enabled and automatic rotation on.
- General-purpose S3 state bucket in the same region, versioning on, `BucketOwnerEnforced`, all four
  public-access blocks on, bucket-wide TLS-only deny policy, default SSE-KMS using that exact key
  and S3 Bucket Key on.
- Verified Amazon SES domain/email identity in the same region/account, an approved From address,
  and the configuration-set name if one is used.
- Cloudflare account ID, DNS zone ID, school zone and plan with the WAF/rate features in RC5.
- Remotely managed Cloudflare Tunnel name/UUID and its token stored as `AWSCURRENT` in AWS Secrets
  Manager.
- A short-lived, resource-scoped Cloudflare API token available from the approved password manager
  only for plan/apply.

## School and approval parts

- Permanent lower-case school slug, for example `northview-college`.
- Exact school legal/display name and exact HTTPS hostname (without `https://` or `/`).
- First campus name; academic year label/start/end; IANA time zone; two-letter country code.
- Named initial administrator’s individual email and full name.
- Approved whole-site IP CIDRs/countries and administration IP CIDRs—or a documented decision that a
  list is intentionally empty.
- Release Manager name, Security Approver name, approved change ID and window start/end in ISO date
  format with numeric UTC offset.

## Workstation

Use one organisation-managed, encrypted, patched workstation with EDR, screen lock and no unapproved
browser extensions. It must already have:

- Visual Studio Code;
- Bash terminal (macOS/Linux, or Ubuntu 24.04 under WSL 2 on Windows);
- Node.js 24 or later and npm 11 or later;
- AWS CLI v2;
- Terraform 1.10 or later;
- Docker Engine/Desktop 24 or later with buildx; and
- `unzip`, `shasum` or `sha256sum`.

If a tool is missing, stop and ask workstation support to install it from the official vendor
package. Do not copy an installer/script from a forum, file-sharing site or random search result.

\newpage

# Part A — prepare the cloud parts (Cloud/Edge owners)

The Deployment Operator may observe these steps and copy **identifiers**, but P2/P3 must make the
security decisions. If the organisation already has an approved equivalent, inspect it instead of
creating a duplicate.

## Step 1 — confirm the dedicated AWS account and region

**Where you are:** a web browser on the managed workstation.

1. Open a new browser tab.
2. Go to `https://console.aws.amazon.com/`.
3. Sign in through the organisation’s AWS access portal with MFA. Do not sign in as the AWS root
   user.
4. In the AWS console, look at the top-right corner. Click the current **Region** name.
5. Click the approved region. All AWS resource steps below stay in this region.
6. Click the account/user menu at the top-right and record the displayed 12-digit **Account ID** in
   the approved change record. An account ID is an identifier, not a password.

**Expected result:** the top bar shows the approved role/account and region.

**Stop if:** this is a development/test/shared account, the account ID differs, or you used
root/static credentials.

## Step 2 — inspect or create the Terraform-state KMS key

**Where you are:** AWS Console in the approved account/region.

1. Click the search box at the top of AWS Console.
2. Type `Key Management Service`, then click **Key Management Service**.
3. In the left menu, click **Customer managed keys**.
4. If the approved state key already exists, click its alias and continue at action 10.
5. Otherwise click **Create key**.
6. Select **Symmetric**, then **Encrypt and decrypt**. Keep key material origin **KMS** and choose
   the organisation-approved regional/multi-region setting. Click **Next**.
7. Enter an alias that identifies purpose/environment, for example
   `alias/edutex-production-terraform-state`. Do not put a school secret in the description.
8. Select only the approved key administrators and usage roles. Apply the organisation’s reviewed
   key policy/permissions boundary; do not grant everyone, wildcard principals or public access.
9. Review the account ID, principals and policy, then click **Finish**.
10. On the key detail page, confirm **Key state** is `Enabled`, **Key spec** is `SYMMETRIC_DEFAULT`,
    and origin is `AWS_KMS`.
11. Open the **Key rotation** or **Key material and rotations** tab.
12. In **Automatic key rotation**, click **Edit**, select **Enable**, keep the approved period, then
    click **Save**.
13. Return to the key detail/overview page and copy the full **ARN** beginning `arn:aws:kms:` into
    the approved non-secret change record.

**Expected result:** enabled customer-managed key, automatic rotation enabled, ARN account/region
matching Step 1. AWS’s current console rotation procedure is documented at
<https://docs.aws.amazon.com/kms/latest/developerguide/rotating-keys-enable.html>.

**Stop if:** the key is AWS-managed, disabled, pending deletion, asymmetric/imported, in another
account/region, has rotation off, or its policy is not approved.

## Step 3 — inspect or create the encrypted Terraform-state S3 bucket

**Where you are:** AWS Console, same account/region.

1. Use the top search box, type `S3`, then click **S3**.
2. In the left menu, click **General purpose buckets** (or **Buckets** if that is the label shown).
3. If an approved dedicated state bucket exists, click its name and continue at action 10.
4. Otherwise click **Create bucket**.
5. Choose **General purpose**. Enter a globally unique lower-case name approved by P2, for example
   `edutex-production-terraform-state-<account-id>` with the real account ID in place of the words.
6. Choose the same AWS Region as Step 1.
7. Under **Object Ownership**, select **ACLs disabled (recommended)** / **Bucket owner enforced**.
8. Under **Block Public Access settings**, tick **Block all public access** and leave all four
   individual boxes selected.
9. Under **Bucket Versioning**, select **Enable**.
10. Under **Default encryption**, choose **Server-side encryption with AWS Key Management Service
    keys (SSE-KMS)**.
11. Choose **Enter AWS KMS key ARN** and paste the exact customer-key ARN from Step 2. Do not choose
    `aws/s3`.
12. Set **Bucket Key** to **Enable**.
13. Add only approved non-secret tags. Click **Create bucket**.
14. Click the bucket name, then click **Properties**. Confirm **Bucket Versioning: Enabled** and
    default encryption names the exact KMS key with Bucket Key enabled.
15. Click **Permissions**. Confirm **Object Ownership: Bucket owner enforced** and all four **Block
    public access** values are `On`.
16. Still on **Permissions**, scroll to **Bucket policy** and click **Edit**. Paste the exact block
    below into the editor. Before saving, replace both occurrences of
    `REPLACE_WITH_YOUR_EXACT_BUCKET_NAME` with the bucket name shown at the top of this AWS page.
    Remove no quotes, commas or braces.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DenyInsecureTransport",
      "Effect": "Deny",
      "Principal": "*",
      "Action": "s3:*",
      "Resource": [
        "arn:aws:s3:::REPLACE_WITH_YOUR_EXACT_BUCKET_NAME",
        "arn:aws:s3:::REPLACE_WITH_YOUR_EXACT_BUCKET_NAME/*"
      ],
      "Condition": {
        "Bool": {
          "aws:SecureTransport": "false"
        }
      }
    }
  ]
}
```

17. Ask P4 to compare the two resource names with the bucket name and confirm the statement is a
    `Deny`, the principal is exactly `"*"`, the action is `s3:*`, and the condition is exactly
    `aws:SecureTransport` = `false`. This statement does not make the bucket public; it denies every
    non-TLS request. Click **Save changes** only after that comparison.
18. Reopen **Bucket policy**, confirm the deny covers the bucket and `/*`, then copy only the bucket
    **name** into the approved change record.

**Expected result:** the bucket has encryption, key, bucket-key, versioning, ownership, public-block
and TLS-only safeguards. The RC5 check re-reads them through AWS APIs. AWS’s current console
instructions are at
<https://docs.aws.amazon.com/AmazonS3/latest/userguide/default-bucket-encryption.html> and
<https://docs.aws.amazon.com/AmazonS3/latest/userguide/manage-versioning-examples.html>.

**Stop if:** any control differs, the key ARN is wrong, or existing objects/state belong to another
school/environment without an approved separate key prefix.

## Step 4 — confirm the CDK bootstrap stack

**Where you are:** AWS Console.

1. Use the search box, type `CloudFormation`, then click **CloudFormation**.
2. In the left menu click **Stacks**.
3. Search for the exact stack name `CDKToolkit`.
4. Click it. Confirm the status is `CREATE_COMPLETE`, `UPDATE_COMPLETE` or
   `UPDATE_ROLLBACK_COMPLETE` and that P2 has reviewed its execution policy/trust/asset encryption.
5. If it does not exist, stop. P2 must bootstrap the account/region using the organisation’s
   approved modern CDK bootstrap pipeline, permissions boundaries and execution policies. The
   beginner operator must not improvise an AdministratorAccess bootstrap.

**Expected result:** one stable `CDKToolkit` stack in the exact account/region.

**Stop if:** absent, in progress/failed, unreviewed, or a custom bootstrap name/qualifier is
expected; RC5 currently checks the default stable stack name.

## Step 5 — confirm Amazon SES is ready

**Where you are:** AWS Console.

1. Search for `Amazon Simple Email Service`, then click **Amazon Simple Email Service**.
2. Confirm the top-right region is still the approved region.
3. In the left menu under **Configuration**, click **Verified identities**.
4. Find the approved school domain or From email. Click it.
5. Confirm **Verification status** is `Verified`/`Successful`, and DKIM/domain DNS checks are green.
6. Copy the identity **ARN** beginning `arn:aws:ses:` into the approved change record.
7. Record the exact From address, for example `no-reply@school-domain.edu`.
8. In SES, open **Account dashboard** and confirm the account has production sending access if real
   invitations will be sent; record the sending decision/limits.
9. Under **Configuration sets**, confirm the approved configuration set exists, or record that the
   organisation deliberately uses none.

**Expected result:** same account/region, identity successful, approved From address/configuration.
The current AWS identity-status location is documented at
<https://docs.aws.amazon.com/ses/latest/dg/view-verified-domains.html>.

**Stop if:** status is pending/failed, SES is in the wrong region/account, sending is sandboxed when
production delivery is required, or the From address is not covered.

## Step 6 — create the Cloudflare Tunnel shell (do not publish a route manually)

**Where you are:** Cloudflare dashboard in a browser, signed in with MFA.

1. Open `https://dash.cloudflare.com/` and select the approved Cloudflare account.
2. In the left navigation, click **Networking**, then **Tunnels**.
3. Click **Create a tunnel**.
4. Choose **Cloudflared** if asked for the connector type.
5. Enter an unambiguous name such as `edutex-production-northview-college` using the real school
   slug. Click **Create Tunnel**.
6. Do **not** install cloudflared on the workstation and do not manually add a public route. RC5
   configures the route and the AWS Fargate sidecar runs the connector.
7. On the Tunnel detail page, copy the **Tunnel ID** (UUID such as
   `12345678-abcd-4abc-8abc-123456789abc`) into the approved change record.
8. Also record the exact Tunnel name/account, but not its token.

**Expected result:** one named, remotely managed Tunnel; it can be inactive before AWS exists.
Cloudflare’s current dashboard path is documented at
<https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/get-started/create-remote-tunnel/>.

**Stop if:** a duplicate/production route exists unexpectedly, the account is wrong, or someone
proposes exposing an AWS IP/load balancer.

## Step 7 — move the Tunnel token directly into AWS Secrets Manager

**Where you are:** two browser tabs—Cloudflare Tunnel and AWS Secrets Manager. P2/P3 perform this
together. The token must not be typed in the VS Code Terminal.

1. In Cloudflare, open **Networking → Tunnels**, click the Tunnel, open **Overview**, then click
   **Add a replica**.
2. The page shows an install command containing `--token eyJ...`. Treat the entire `eyJ...` value as
   a password. Copy only that token using the approved secure clipboard/password-manager process.
3. Immediately switch to the AWS tab. Go to `https://console.aws.amazon.com/secretsmanager/`, in the
   same account/region as Step 1.
4. Click **Store a new secret**.
5. Select **Other type of secret**.
6. Select the **Plaintext** tab. Paste only the Tunnel token. Do not add quotes, `--token`, the
   Docker command or explanatory text.
7. Choose the approved encryption key. If using a customer key, confirm the future ECS execution
   role is explicitly permitted to decrypt it; otherwise use the approved Secrets Manager key
   decision.
8. Click **Next**. For **Secret name**, enter `edutex/production/cloudflare/tunnel-token` unless the
   approved naming standard specifies a stricter name compatible with RC5.
9. Add a non-secret description and approved tags. Do not place token fragments in tags.
10. Click **Next**. Configure the approved rotation process; a Tunnel-token rotation normally
    requires coordination with the running connector.
11. Click **Next**, review account/region/name, then click **Store**.
12. Open the new secret’s detail page. Copy only its **Secret ARN** into the approved change record.
13. Do not click **Retrieve secret value**. Clear the secure clipboard and close the Add-replica
    screen.

**Expected result:** the secret detail page exists; its ARN matches the account/region; current
version has stage `AWSCURRENT`. AWS’s console flow is documented at
<https://docs.aws.amazon.com/secretsmanager/latest/userguide/create_secret.html>.

**Stop if:** the token appeared in a terminal, normal file, screenshot, chat, ticket, browser
history field or logs. Revoke/rotate it and treat the exposure under the incident process.

## Step 8 — record Cloudflare account ID, zone ID and policy inputs

**Where you are:** Cloudflare dashboard.

1. Select the school’s DNS zone/domain.
2. On the zone **Overview** page, find the 32-character **Zone ID** and copy it into the approved
   change record.
3. Find the 32-character **Account ID** and copy it too.
4. Confirm the exact intended hostname, for example `portal.northview.edu.au`. Do not include
   `https://`, a path or trailing slash.
5. P3 records approved whole-site IP CIDRs, country codes and administration IP CIDRs. A single
   address must include `/32` for IPv4 or `/128` for IPv6.
6. P3 confirms whether the purchased plan exposes Bot Management score fields. Record `no` unless
   this is explicitly confirmed.
7. Confirm the plan permits Cloudflare Managed WAF, OWASP managed WAF, custom rules and the rate
   limits in `infra/cloudflare/main.tf`. Do not plan to weaken RC5 to fit a smaller plan.

**Expected result:** two 32-character IDs, one Tunnel UUID and approved policy lists.

**Stop if:** zone/account/tunnel belong to different customers, or plan entitlements are unknown.

## Step 9 — create the short-lived Cloudflare plan/apply API token

**Where you are:** Cloudflare dashboard. Do this near the approved deployment window.

1. For a user token, click the profile icon → **My Profile** → **API Tokens**. For an organisation-
   approved account token, use **Manage Account** → **API Tokens**.
2. Click **Create Token**, then **Create Custom Token**.
3. Name it with school/change/expiry, for example `Edutex northview CHG-8451 temporary deploy`.
4. Add only the permissions required by the reviewed Terraform resources: exact account Tunnel edit,
   exact zone DNS edit and exact zone WAF/Rulesets/rate-limit edit/read permissions exposed by the
   current Cloudflare token builder.
5. Under resource scope, include only the approved account and school zone—not all accounts/zones.
6. Add the shortest practical TTL covering plan review/apply. If the organisation has fixed egress
   IPs, restrict client source IP too.
7. Click **Continue to summary**. P3/P4 compare permissions/resources/TTL, then click **Create
   Token**.
8. Cloudflare shows the token once. Copy it directly into the approved enterprise password manager
   entry. Do not place it in this guide, change record, JSON, tfvars, source or terminal history.
9. Close the one-time token page.

**Expected result:** one short-lived least-privilege token in the password manager. Current
Cloudflare steps are at
<https://developers.cloudflare.com/fundamentals/api/get-started/create-token/>.

**Stop if:** it is a Global API Key, has all-account/all-zone resources, excessive TTL, or cannot be
stored by the approved secret process.

\newpage

# Part B — place and verify the RC5 package

The example school slug in command boxes is `northview-college`. Before typing a command, replace
that exact example with the real permanent slug. Do not replace other punctuation, quotes or spaces.

## Step 10 — create the private working folders

**Where you are:** Visual Studio Code, with the bottom Terminal open.

1. Click inside the Terminal panel.
2. Type this command and press Enter:

```bash
mkdir -p "$HOME/Edutex-Deployments/download" "$HOME/Edutex-Deployments/release" "$HOME/Edutex-Deployments/schools/northview-college/work"
```

3. Type this command and press Enter:

```bash
chmod -R 700 "$HOME/Edutex-Deployments"
```

4. Type this command and press Enter:

```bash
ls -ld "$HOME/Edutex-Deployments" "$HOME/Edutex-Deployments/schools/northview-college/work"
```

**Expected result:** each line begins with `drwx------` (owner can access; others cannot).

**Stop if:** `Permission denied`, path spelling differs, or this is a shared/network-synchronised
folder not approved for confidential infrastructure evidence.

## Step 11 — put the ZIP and checksum into Download

**Where you are:** the workstation’s file manager—Finder on macOS or Files inside the Linux/WSL
environment according to IT policy.

1. Download these two separate release files from the approved handover location:
   `Edutex-production-1.0.0-rc.5.zip` and `Edutex-production-1.0.0-rc.5.zip.sha256`.
2. Do not open the ZIP yet.
3. Move both files into your private `Edutex-Deployments/download` folder.
4. Return to the VS Code Terminal and type:

```bash
cd "$HOME/Edutex-Deployments/download"
ls -l Edutex-production-1.0.0-rc.5.zip Edutex-production-1.0.0-rc.5.zip.sha256
```

**Expected result:** exactly two filenames and non-zero ZIP size.

**Stop if:** a filename contains `(1)`, the checksum arrived inside the same ZIP only, or either
file came from chat/unapproved storage.

## Step 12 — verify the ZIP checksum

**Where you are:** VS Code Terminal, currently in `.../download`.

### Linux or Windows WSL

```bash
sha256sum --check Edutex-production-1.0.0-rc.5.zip.sha256
```

### macOS

```bash
EXPECTED="$(awk '{print $1}' Edutex-production-1.0.0-rc.5.zip.sha256)"
ACTUAL="$(shasum -a 256 Edutex-production-1.0.0-rc.5.zip | awk '{print $1}')"
test "$EXPECTED" = "$ACTUAL" && echo "CHECKSUM OK" || echo "CHECKSUM FAILED"
```

**Expected result:** Linux/WSL prints `...zip: OK`; macOS prints `CHECKSUM OK`.

**Stop if:** `FAILED`, no output or command error. Delete neither file; quarantine them and contact
P1 through the approved release channel.

## Step 13 — test and extract the ZIP

**Where you are:** same Terminal.

1. Test the archive without extracting:

```bash
unzip -t Edutex-production-1.0.0-rc.5.zip
```

2. Confirm the final line says no errors. Then extract:

```bash
unzip -q Edutex-production-1.0.0-rc.5.zip -d "$HOME/Edutex-Deployments/release"
```

3. Confirm the expected root files exist:

```bash
ls "$HOME/Edutex-Deployments/release/Edutex-production/package.json" "$HOME/Edutex-Deployments/release/Edutex-production/README.md"
```

**Expected result:** both exact file paths print.

**Stop if:** extraction asks to overwrite a previous release. Move the previous complete workspace
to the controlled archive through change management; do not mix releases.

## Step 14 — open the correct folder in Visual Studio Code

**Where you are:** Visual Studio Code.

1. At the top, click **File** → **Open Folder…**.
2. Browse to `Edutex-Deployments` → `release` → `Edutex-production`.
3. Select the `Edutex-production` folder itself, then click **Open**.
4. If Visual Studio Code asks whether you trust the authors, compare the verified checksum and
   approved handover, then choose **Yes, I trust the authors** only if both passed.
5. In the left **Explorer**, confirm you see `apps`, `docs`, `infra`, `packages`, `scripts`,
   `package.json` and `README.md` at the top level.
6. Click **Terminal** → **New Terminal**.
7. Type:

```bash
pwd
```

**Expected result:** the path ends exactly `/Edutex-Deployments/release/Edutex-production`.

**Stop if:** it ends in `download`, `schools`, `apps`, `infra`, a previous RC, or the ZIP itself.

## Step 15 — prove the release number and source-documentation coverage

**Where you are:** VS Code Terminal at repository root.

1. Type:

```bash
node -p "require('./package.json').version"
```

2. Confirm it prints `1.0.0-rc.5`.
3. Type:

```bash
npm ci --ignore-scripts
```

4. Wait until the cursor returns. Type:

```bash
npm rebuild sharp
npm run source:docs
```

**Expected result:** the last line says that 83 maintained files and 731 implemented functions are
documented. Package installation/rebuild returns without an npm error.

**Stop if:** the release is different, lockfile installation changes requirements, or the
documentation gate reports even one missing function comment.

\newpage

# Part C — connect the Terminal to the correct AWS account

## Step 16 — open the AWS CLI SSO setup wizard

**Where you are:** VS Code Terminal. P2 supplies the SSO Start URL, Identity Center region, 12-digit
account and exact permission-set/role name.

1. Type:

```bash
aws configure sso
```

2. At `SSO session name`, type a descriptive non-secret name such as `edutex-production` and press
   Enter.
3. At `SSO start URL`, paste the P2-approved `https://...awsapps.com/start` URL and press Enter.
4. At `SSO region`, type the region that hosts **IAM Identity Center**. This may differ from the
   Edutex workload region; use P2’s value.
5. At `SSO registration scopes`, press Enter to accept `sso:account:access` unless P2 specifies an
   approved alternative.
6. The browser opens. Confirm the organisation, sign in and complete MFA. Approve only the expected
   AWS CLI/botocore access request, then return to the Terminal.
7. Select/type the exact 12-digit production account.
8. Select/type the exact approved deployment permission set/role.
9. At `CLI default client Region`, type the Edutex workload region from Step 1.
10. At `CLI default output format`, type `json`.
11. At `CLI profile name`, type the approved profile name, for example `edutex-production-deployer`.
    Record this exact spelling; RC5 will ask for it.

**Expected result:** AWS CLI says the profile was configured and shows an example command. Current
AWS instructions are at <https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-sso.html>.

**Stop if:** a prompt asks for AWS Access Key ID/Secret Access Key. That is not the SSO wizard.

## Step 17 — sign in and compare the account ID

**Where you are:** same Terminal.

1. Replace the sample profile name if yours differs, then type:

```bash
aws sso login --profile edutex-production-deployer
```

2. Complete the browser MFA/authorization and return to the Terminal.
3. Type:

```bash
aws sts get-caller-identity --profile edutex-production-deployer --output json
```

4. Compare the `"Account"` value character-for-character with Step 1.
5. Confirm the `"Arn"` names the approved role/session, not root or an unexpected user.

**Expected result:** exact account/role. Do not screenshot or paste the response into public chat.

**Stop if:** any mismatch or `AccessDenied`; ask P2 to fix the SSO assignment/profile.

\newpage

# Part D — answer the RC5 setup questions

## Step 18 — understand exactly where the answers go

You fill the deployment answers in **the same VS Code Terminal panel** used in Steps 15–17.

- Do not open AWS/Cloudflare and type answers into a “worksheet”.
- Do not create a JSON file.
- Do not paste all answers at once.
- RC5 prints one question, you type one answer, then press Enter.
- Some prompts show a default in square brackets. Pressing Enter without typing selects that
  default.
- `NOT ACCEPTED` means the answer format is wrong. Read the message, obtain/correct the approved
  value and answer that same question again.
- `Ctrl+C` cancels safely before deployment. You can rerun the interview later.

## Step 19 — start the interview

**Where you are:** VS Code Terminal at the RC5 repository root.

1. Confirm the school folder already exists:

```bash
ls -ld "$HOME/Edutex-Deployments/schools/northview-college"
```

2. Start the interview:

```bash
npm run deploy:new -- --output "$HOME/Edutex-Deployments/schools/northview-college/production.json"
```

3. The Terminal must print `Edutex 1.0.0-rc.5 production configuration interview`.
4. Keep the AWS/Cloudflare change record beside you. Answer prompts using the table below.

**Expected result:** first prompt is `AWS region`.

**Stop if:** it asks for a password/token/private key, says output already exists unexpectedly, or
the release number differs.

## Step 20 — answer every interview prompt in order

All typing happens at the blinking Terminal cursor. Samples show format only; use approved real
values. Never use the sample/example values in production.

| Terminal question                      | Where the real answer comes from | Format/example                                          | Stop if                             |
| -------------------------------------- | -------------------------------- | ------------------------------------------------------- | ----------------------------------- |
| AWS region                             | AWS top-right region / P2        | `ap-southeast-2`                                        | It differs from KMS/S3/SES          |
| AWS account ID                         | Step 1 / STS result              | exactly 12 digits                                       | Shared/wrong account                |
| School slug                            | P5/change record                 | `northview-college`                                     | Temporary, spaces/capitals          |
| Edutex hostname                        | P3/P5 DNS approval               | `portal.northview.edu.au`                               | Contains `https://`, `/`, capitals  |
| SES configuration set                  | Step 5                           | `edutex-transactional`, or Enter only for approved none | Does not exist                      |
| Approved change ID                     | P1’s change system               | `CHG-2026-8451`                                         | Draft/unapproved                    |
| Release manager                        | Approved change                  | full person name                                        | Self/unidentified                   |
| Security/cloud approver                | Approved change                  | different full person name                              | Not authorised                      |
| Maintenance window start               | Approved change                  | `2026-09-12T20:00:00+10:00`                             | No numeric offset                   |
| Maintenance window end                 | Approved change                  | later ISO time                                          | At/before start                     |
| AWS CLI profile                        | Step 16                          | `edutex-production-deployer`                            | Not configured/tested               |
| Cloudflare Tunnel token secret ARN     | Step 7 AWS secret detail         | begins `arn:aws:secretsmanager:`                        | You have token value, not ARN       |
| Terraform state bucket                 | Step 3                           | bucket name only                                        | Includes `s3://` or wrong account   |
| Terraform state KMS key ARN            | Step 2                           | begins `arn:aws:kms:`                                   | Alias/wrong key/account/region      |
| Cloudflare account ID                  | Step 8                           | 32 hexadecimal characters                               | Wrong customer                      |
| Cloudflare zone ID                     | Step 8                           | 32 hexadecimal characters                               | Wrong domain                        |
| Cloudflare Tunnel ID                   | Step 6                           | UUID with hyphens                                       | Token/name instead of UUID          |
| Whole-site allowed IP ranges           | P3 network decision              | comma list such as `203.0.113.0/24` or Enter            | Plain IP without prefix             |
| Whole-site allowed countries           | P3 decision                      | comma list `AU,NZ`, or Enter                            | Lower-case/not approved             |
| Administration IP ranges               | P3 decision                      | comma CIDRs; `/32` for one IPv4                         | Empty without accepted risk         |
| Enable Cloudflare Bot Management rule? | P3 plan confirmation             | `yes` or default `no`                                   | “yes” guessed                       |
| School legal/display name              | P5 approved name                 | `Northview College`                                     | Nickname/typo                       |
| First campus name                      | P5                               | `Main Campus` or approved name                          | Temporary placeholder               |
| Academic year name                     | P5                               | `2027 School Year`                                      | Wrong calendar                      |
| Academic year start                    | P5                               | `2027-01-27`                                            | Not `YYYY-MM-DD`                    |
| Academic year end                      | P5                               | `2027-12-17`                                            | Before start                        |
| School time zone                       | P5                               | `Australia/Melbourne`                                   | Abbreviation such as `AEST`         |
| School country code                    | P5                               | `AU`                                                    | Not two upper-case letters          |
| Initial administrator email            | P5 named person                  | individual school address                               | Shared inbox unless approved        |
| Initial administrator name             | P5                               | full display name                                       | Unknown person                      |
| Verified SES identity ARN              | Step 5                           | begins `arn:aws:ses:`                                   | Wrong region/account/pending        |
| Invitation From address                | Step 5                           | plain email only                                        | `Name <email>` form                 |
| Production application task count      | Capacity approval                | default `3`, maximum `30`                               | Less than 3/unapproved higher value |

**Expected result:** after the final answer, RC5 prints `CREATED:` followed by the exact
`.../production.json` path and a `NEXT:` check command.

**Stop if:** the interview exits with a validation stack/message. Photographing the screen is not
needed; copy the non-secret error text into the controlled incident/change record if authorised.

## Step 21 — review the created non-secret file without editing it

**Where you are:** VS Code.

1. In the Terminal type:

```bash
code "$HOME/Edutex-Deployments/schools/northview-college/production.json"
```

2. A new editor tab opens. Do not type in it.
3. P1/P2/P3/P5 compare every displayed identifier/name/date/list with the approved record.
4. Confirm there is no property/value containing an actual password, API token, Tunnel token, client
   secret, private key, recovery code or session token. The Secrets Manager **ARN** is expected and
   is not the secret value.
5. Close the editor tab using its `×` without saving.
6. In Terminal, verify permissions:

```bash
ls -l "$HOME/Edutex-Deployments/schools/northview-college/production.json"
```

**Expected result:** Linux/WSL/macOS permission text begins `-rw-------`.

**Stop if:** any answer is wrong. Do not edit the JSON. Obtain approval, then rerun Step 19 with
`--replace` appended and complete every prompt again; a replacement requires a new plan.

\newpage

# Part E — run the read-only check

## Step 22 — run RC5 preflight

**Where you are:** VS Code Terminal at repository root; Docker Desktop/Engine is running; AWS SSO
login from Step 17 is active.

1. Type this as one command:

```bash
npm run deploy:check -- --config "$HOME/Edutex-Deployments/schools/northview-college/production.json" --work-dir "$HOME/Edutex-Deployments/schools/northview-college/work"
```

2. Do not close the Terminal while checks run.
3. Read each `[RC5]` label. It should check Node, npm, AWS CLI, Terraform, Docker, buildx, AWS
   caller, `CDKToolkit`, Tunnel-secret metadata/current stage, state bucket region/encryption/public
   block/ownership/versioning/TLS-only policy, KMS key/rotation, SES identity, production sending
   and any named SES configuration set.

**Expected result:** final line exactly begins `CHECK PASSED for` and ends with the school hostname.

**Stop if:** any command fails. Use the troubleshooting table in Step 45; do not continue to plan.

## Step 23 — save the check result

**Where you are:** organisation’s controlled change/evidence system.

1. Select/copy only the non-secret Terminal output from the start of `deploy:check` through
   `CHECK PASSED`.
2. Attach/save it to the approved change record using the organisation’s confidential evidence
   classification.
3. Record operator, timestamp, RC5 version, exact hostname/account/region.
4. Do not attach AWS SSO cache files or secret values.

**Expected result:** P1/P4 can independently see that preflight passed before planning.

\newpage

# Part F — create and approve the production plan

## Step 24 — place the Cloudflare token in Terminal memory without echo/history

**Where you are:** VS Code Terminal. P3 retrieves the short-lived token from the approved password
manager. The token is never placed in a command line.

1. Type this exact command and press Enter:

```bash
read -r -s -p "Paste the temporary Cloudflare token, then press Enter: " CLOUDFLARE_API_TOKEN
```

2. The cursor waits. Paste the token once. **Nothing should appear on screen.** Press Enter.
3. Type these exact two commands:

```bash
printf '\n'
export CLOUDFLARE_API_TOKEN
```

4. Do not run `echo $CLOUDFLARE_API_TOKEN` and do not take a screenshot.

**Expected result:** the Terminal returns to a prompt without printing the token.

**Stop if:** the token appears visibly. Clear/close the Terminal, revoke token with P3, record the
incident and create a replacement.

## Step 25 — run the plan

**Where you are:** same Terminal, source unchanged, Docker running, AWS SSO active, temporary token
in memory.

1. Type:

```bash
npm run deploy:plan -- --config "$HOME/Edutex-Deployments/schools/northview-college/production.json" --work-dir "$HOME/Edutex-Deployments/schools/northview-college/work"
```

2. Leave the workstation connected to power/network. This can take many minutes because it compiles,
   tests, audits, builds an image asset, validates Terraform and asks AWS for a read-only diff.
3. Do not type into the Terminal while a command is running.
4. The quality gate must report source-documentation, TypeScript, tests, lint, formatting and build
   success. Runtime audit must not report a blocking high/critical production dependency.
5. Terraform must validate and produce a saved plan. CDK must synthesize and produce a diff.

**Expected result:** final block begins `PLAN READY:` and says `STOP HERE` for human review.

**Stop if:** there is no `PLAN READY`, any mandatory gate fails, or plans contain unexplained
errors.

## Step 26 — remove the Cloudflare token from this Terminal

**Where you are:** same Terminal after `PLAN READY` or after a failed plan.

1. Type:

```bash
unset CLOUDFLARE_API_TOKEN
```

2. Let the original token expire/revoke it according to P3’s decision if plan review will be long.

**Expected result:** command prints nothing. This does not erase every theoretical process/memory
copy; it removes the variable from future child commands in this Terminal.

## Step 27 — open the two human-readable plans

**Where you are:** VS Code Terminal.

1. Open the Cloudflare plan:

```bash
code "$HOME/Edutex-Deployments/schools/northview-college/work/cloudflare-plan.txt"
```

2. Open the AWS diff:

```bash
code "$HOME/Edutex-Deployments/schools/northview-college/work/aws-cdk-diff.txt"
```

3. In the left Explorer or top tabs, switch between the two files. Do not edit/save them.
4. P3/P4 review the Cloudflare plan for exact proxied CNAME/Tunnel/hostname, Cloudflare and OWASP
   managed WAF, custom rules, health/scanner/method blocks, rate limits and exact IP/country/admin
   semantics.
5. P2/P4 review AWS diff/template/IAM for no public ALB/IP/inbound app rule, database only through
   exact security groups, private tasks, encryption, backups/retention, narrow secret/KMS grants,
   immutable Node/Cloudflared image digests and `ApplicationDesiredCount` default zero.
6. Everyone reviews all deletes/replacements. A desired, explained `create` is not the same as an
   unexplained `destroy`.

**Expected result:** two independent reviewers approve the exact plan or reject it with reasons.

**Stop if:** a reviewer has not inspected actual files, permissions/plan features are unavailable,
or a control is weakened to avoid a provider-plan error.

## Step 28 — record the exact approval binding

**Where you are:** controlled change system and `plan-record.json` open in VS Code.

1. Open:

```bash
code "$HOME/Edutex-Deployments/schools/northview-college/work/plan-record.json"
```

2. Record the release, change ID, hostname and every SHA-256 field exactly: `configurationSha256`,
   `sourceSha256`, `terraformPlanSha256`, `terraformProviderLockSha256`, `terraformPlanTextSha256`,
   `cloudFormationTemplateSha256`, `cloudFormationAssemblySha256` and `cloudFormationDiffSha256`.
   The provider-lock hash binds the exact Cloudflare provider build selected by `terraform init`;
   the assembly hash binds the CDK asset manifest/deployment assembly; the source hash deliberately
   excludes Terraform's generated `.terraform.lock.hcl`. Also copy the 64-character
   `PLAN RECORD SHA-256` printed by the plan command into the change record.
3. P1 and P4 independently approve those values and the two plan files. Record names/timestamps and
   the approved maintenance/rollback decision.
4. Close files without saving.
5. From now until apply, do not run formatter, update dependencies, edit source/config, replace the
   plan or move pieces into the source tree.

**Expected result:** the change record names exact hashes and two approvals, not “latest plan”.

**Stop if:** anything changes. Repeat plan and approval; never edit `plan-record.json`.

\newpage

# Part G — apply the approved plan

## Step 29 — perform the final four checks at the start of the window

**Where you are:** VS Code Terminal and controlled change record.

1. Confirm wall clock is between the exact ISO start/end values in `production.json`.
2. Confirm incident/on-call, P1/P2/P3/P4 and rollback contacts are available.
3. Confirm the approved hostname/change ID/hashes still match Step 28.
4. Refresh AWS SSO:

```bash
aws sso login --profile edutex-production-deployer
```

5. Repeat Step 24 with a fresh approved Cloudflare token and keep it hidden.

**Expected result:** active short-lived AWS and Cloudflare credentials, exact approved window.

**Stop if:** outside window, an approver withdrew approval, plan/config/source changed or incident
coverage is unavailable.

## Step 30 — type the apply command with two deliberate confirmations

**Where you are:** VS Code Terminal. Replace the sample approval ID/hostname with the exact approved
values. This is the only command in this guide that mutates production.

```bash
npm run deploy:apply -- --config "$HOME/Edutex-Deployments/schools/northview-college/production.json" --work-dir "$HOME/Edutex-Deployments/schools/northview-college/work" --execute --approval-id CHG-2026-8451 --confirm-hostname portal.northview.edu.au --confirm-record-sha256 64_CHARACTER_HASH_COPIED_FROM_THE_APPROVED_CHANGE_RECORD
```

Before pressing Enter, point at and read aloud with the second operator:

1. `production.json` path contains the correct school slug;
2. `work` path is the approved work folder;
3. `--execute` is present;
4. approval ID is exact; and
5. hostname is exact; and
6. the final value is the real 64-character plan-record hash approved in Step 28, not the displayed
   words `64_CHARACTER_HASH_COPIED_FROM_THE_APPROVED_CHANGE_RECORD`.

Then press Enter once.

**Expected result:** RC5 repeats preflight and hash checks before any mutation.

**Stop if:** it says confirmation/window/hash mismatch. Do not change a hash/progress file to make
it pass.

## Step 31 — watch the fixed apply sequence

**Where you are:** same Terminal. Do not run a second apply in another terminal.

The labels must appear in this order:

1. **Approved Cloudflare plan apply** — applies the exact binary plan.
2. **AWS private foundation deployment (application stopped)** — creates/updates infrastructure with
   application task count zero.
3. **migration ECS task start/completion/result** — private one-shot PostgreSQL migrations.
4. **school-bootstrap ECS task start/completion/result** — creates the tenant, school-isolated
   Cognito pool, confidential OAuth client, backend-only client secret in tenant-scoped AWS Secrets
   Manager, first administrator and relational defaults.
5. **AWS application activation** — changes desired count to the approved value (at least three).
6. **Edutex service stabilization** — waits for ECS service stability.
7. `DEPLOYMENT COMPLETE: <exact hostname>` — writes the receipt.

**Expected result:** exact completion line, no failed container, no public-origin workaround.

**Stop if:** any stage fails. The app remains zero/stopped until the activation stage. Preserve the
screen and follow Part H; do not manually create a school or rerun ECS.

## Step 32 — remove temporary credentials and inspect the receipt

**Where you are:** Terminal after completion.

1. Remove the Cloudflare variable:

```bash
unset CLOUDFLARE_API_TOKEN
```

2. Open the receipt:

```bash
code "$HOME/Edutex-Deployments/schools/northview-college/work/deployment-receipt.json"
```

3. Compare release/change/hostname/hashes and confirm migration/bootstrap task ARNs, stack ID,
   cluster and service names are present. Do not edit.
4. Save the entire owner-only `work` folder to the approved encrypted evidence repository according
   to retention policy—not email/chat.
5. On this dedicated workstation, end cached AWS SSO sessions when operational follow-up is done:

```bash
aws sso logout
```

6. P3 revokes the temporary Cloudflare token or confirms automatic expiry.

**Expected result:** one immutable evidence set and no longer-needed active deployment token.

\newpage

# Part H — if the Terminal closes or a stage fails

## Step 33 — do not start over

If power/network/Terminal fails, RC5 has already recorded completed stages and one-shot task ARNs.

1. Do not delete `work`.
2. Do not delete/recreate the CloudFormation stack/Tunnel/state.
3. Do not run `aws ecs run-task` manually.
4. Do not edit `deployment-progress.json`.
5. Reopen the exact verified RC5 folder in Visual Studio Code.
6. Open a new Terminal and sign into the same approved AWS profile.

## Step 34 — display local progress

```bash
npm run deploy:status -- --config "$HOME/Edutex-Deployments/schools/northview-college/production.json" --work-dir "$HOME/Edutex-Deployments/schools/northview-college/work"
```

**Expected result:** it lists `plan-record.json`, `deployment-progress.json` and receipt as present
or not present, then names completed stages such as `cloudflare, foundation, migration`.

**Stop if:** progress says it belongs to different inputs or files are malformed/missing after a
stage was known to complete. Preserve evidence and escalate.

## Step 35 — resume only after correction and renewed approval

**Where you are:** first, the organisation's AWS log viewer/change record with P2/P4; only return to
the VS Code Terminal after they approve the exact recovery.

1. Read the final red error line in the Terminal. Copy the text to the approved confidential
   incident/change record. Do not include tokens, passwords, cookies or secret values.
2. P2 opens **AWS Console → Elastic Container Service → Clusters**, opens the cluster named in
   `aws-stack-outputs.json`, chooses **Tasks**, selects the exact failed task ARN recorded in
   `deployment-progress.json`, and reads that task's **Logs** tab/linked CloudWatch log stream.
3. P2/P3/P4 identify and fix the cause without opening public access, disabling RLS/WAF/MFA/TLS or
   editing a plan/progress file.
4. If source, configuration or either plan must change, do **not** resume. Repeat Steps 19–28 with a
   new change/plan, then obtain approval for those new bytes.
5. If the failure happened before a migration/bootstrap task was started—or the existing recorded
   task is still running—do not request a retry. Wait for the exact task result. After a temporary
   external fault is corrected, obtain continuation approval and rerun the ordinary Step 30 command.
6. If the error explicitly says `migration failed:` or `school-bootstrap failed:`, locate the full
   ARN printed after `--confirm-failed-task-arn`. Two operators compare that ARN, character for
   character, with the matching `migrationTaskArn` or `bootstrapTaskArn` in
   `deployment-progress.json`.
7. P4 records approval for **one replacement attempt of that exact stopped task ARN**. Do not use an
   ARN from the AWS list, memory, a different school or an older change.
8. Return to the VS Code Terminal. Sign into the same approved AWS profile and perform Step 24 again
   with a fresh hidden Cloudflare token.
9. Start with the exact Step 30 apply command. If the migration task failed, append these two items
   to the end, replacing the sample ARN by the exact ARN from the error/progress file:

```bash
--retry-failed-task migration --confirm-failed-task-arn arn:aws:ecs:REGION:ACCOUNT_ID:task/CLUSTER/FAILED_TASK_ID
```

10. If the school-bootstrap task failed, append these two items instead:

```bash
--retry-failed-task bootstrap --confirm-failed-task-arn arn:aws:ecs:REGION:ACCOUNT_ID:task/CLUSTER/FAILED_TASK_ID
```

11. Before Enter, the second operator confirms: original Step 30 path/change/hostname/hash values
    are unchanged; task kind matches the failed stage; ARN exactly matches progress; current time is
    inside the approved window. Press Enter once.
12. RC5 rechecks approved hashes, proves the exact recorded predecessor failed, records its ARN in
    `failedTaskArns`, creates only one replacement with a new idempotency token and resumes.
13. If the replacement also fails, stop. Its ARN is now the current task ARN. A further attempt
    requires a new diagnosis and new exact-ARN approval. RC5 hard-stops after ten recorded failures
    and requires a formal deployment incident.

**Expected result:** interrupted successful work resumes without duplication, or exactly one
approved failed task is replaced; the process eventually prints `DEPLOYMENT COMPLETE`.

**Stop if:** ARN/kind does not match, the task actually succeeded/is still running, approved bytes
changed, the window closed, or anyone proposes deleting/editing the progress file.

\newpage

# Part I — verify the assembled system before client data

Completion means infrastructure exists; it does not mean production acceptance.

## Step 36 — verify Cloudflare Tunnel and DNS

**Where you are:** Cloudflare dashboard.

1. Go to **Networking → Tunnels** and click the named Tunnel.
2. Confirm status is **Healthy** and connectors correspond to expected Fargate tasks/locations.
3. Open the school zone → **DNS Records**. Find the exact hostname.
4. Confirm type `CNAME`, target ends `.cfargotunnel.com`, and proxy cloud is orange/**Proxied**.
5. Confirm no A/AAAA/CNAME record reveals an AWS load balancer/public IP.

**Expected result:** healthy outbound Tunnel and Cloudflare-only DNS target.

**Stop if:** degraded/down, unexpected connector, grey-cloud DNS or exposed origin.

## Step 37 — verify WAF and network restrictions

**Where you are:** Cloudflare school zone.

1. Open **Security → WAF → Managed rules** (or current **Security Settings** view).
2. Confirm the Cloudflare Managed Ruleset and Cloudflare OWASP Core Ruleset execute only for the
   exact Edutex hostname; RC5 sets OWASP paranoia level 3 by disabling only level 4.
3. Open custom/security rules and confirm Edutex site geography/IP, admin network (when configured),
   method, scanner and private health-path rules are enabled.
4. Open rate limiting and confirm authentication and API rules are enabled.
5. From approved and denied test networks/countries, run documented synthetic requests. Confirm
   expected allow/block/challenge and inspect Security Events.
6. Test `/health/live` from the internet; Cloudflare should block it even though ECS internal health
   remains healthy.

**Expected result:** plan and live Cloudflare policy match; security events contain tests.

**Stop if:** a required ruleset is unavailable/disabled, exclusions appeared, or a deny case reaches
the app. Current Cloudflare managed-rule navigation is documented at
<https://developers.cloudflare.com/waf/managed-rules/deploy-zone-dashboard/>.

## Step 38 — perform the first administrator sign-in safely

**Where you are:** managed browser/device assigned to the named initial administrator.

1. The administrator opens the SES/Cognito invitation in their school mailbox. Support never asks
   them to send the temporary password.
2. In a browser, type `https://` followed by the exact Edutex hostname.
3. Choose **Username and password** if shown, enter their exact email and temporary password.
4. When prompted, create a unique organisation-policy password in their password manager. Do not
   reuse/share it.
5. Enrol TOTP: open the organisation-approved authenticator, scan the displayed QR, type the current
   code and securely store recovery information under policy.
6. When the portal loads, open the account/user menu and click **Register a passkey**.
7. Complete Cognito managed-login WebAuthn using an organisation-approved hardware/platform
   authenticator with user verification. Do not enrol a passkey on a shared/unmanaged device.
8. Sign out, then test both password+TOTP and passkey according to policy. Keep a permitted recovery
   path; do not remove TOTP merely because passkey works.

**Expected result:** independent device-bound session, required TOTP for password and verified
passkey sign-in; logout invalidates the current session. The callback succeeds only while Cognito's
live MFA/TOTP/passkey configuration still matches the policy in Edutex.

**Stop if:** email is wrong/unverified, temporary credential is shared, TOTP can be skipped for
password, tokens appear in browser storage/URL, or sessions appear on another client.

## Step 39 — choose login methods and modules in Edutex Administration

**Where you are:** authenticated Edutex portal as an authorised administrator.

1. In the portal navigation, open **Administration**.
2. In **Authentication → Allowed sign-in methods**, select only methods approved by P5/P4.
3. If **Username and password** is enabled, confirm **Authenticator policy** is locked to **Required
   for password sign-in**.
4. In **Sessions → Device security**, enter approved idle/absolute/step-up limits; never lengthen
   them merely to avoid user complaints without risk approval.
5. Click the page’s **Save authentication policy** action. Wait for the success message saying new
   sign-ins use the policy immediately.
6. In the module/home visibility section, enable only school-approved modules and save. Hidden UI is
   not authorization; server permissions still apply.
7. Open a private/incognito sign-in window and confirm only selected methods/buttons appear and
   protected `/app` assets are unavailable before authentication.

**Expected result:** school controls the home/login choices, and password always has TOTP.

**Stop if:** no success message, stale-row conflict, an unselected method appears, or hidden module
data remains accessible without permission.

## Step 40 — add an external identity provider (Microsoft, Google, OIDC or SAML)

**Where you are:** Edutex **Administration** with P5 identity engineer present. First create the
approved enterprise application in Microsoft Entra/Google/IdP using the exact callback/logout URLs
from the school’s Cognito/technical identity plan. Never guess redirect URLs or claims.

1. In **Connected identity providers**, click **Add provider**.
2. Select **Provider type**: Microsoft Entra ID, Google Workspace, OpenID Connect or SAML 2.0.
3. Enter a permanent lower-case **Provider key**, reviewed display name and button label.
4. For Microsoft/OIDC, enter the exact HTTPS issuer URL. For SAML, enter the approved HTTPS metadata
   URL. For Google/Microsoft/OIDC, enter exact client ID and one-time client secret.
5. Enter the minimal approved scopes and exact attribute mapping. Map verified email/subject and the
   dedicated group/role/assurance claims required by policy; do not map an untrusted display name to
   privilege.
6. Click **Configure provider** once.
7. Wait for `Identity provider staged as disabled...`. The provider list must show **Disabled**.
8. Confirm the client secret field is cleared/not returned. Edutex stores it in tenant-scoped AWS
   Secrets Manager.

**Expected result:** provider exists but is disabled; it cannot be published accidentally.

**Stop if:** it appears Enabled immediately, secret is returned/displayed, metadata/issuer is not
HTTPS/approved, or IdP signature/claim design is unresolved.

## Step 41 — add exact claim-to-role mappings before enabling SSO

**Where you are:** same Administration page, **Directory authorisation → Claim-to-role mappings**.

1. Click **Add mapping**.
2. Select the exact identity provider.
3. Enter the approved **Claim name** and **Exact claim value**. Copy case/spacing/identifier exactly
   from the verified IdP token/assertion design; no wildcard/substring guess.
4. Select the least-privileged Edutex role.
5. Select the matching category: Student, Teacher, Corporate staff, IT staff, Executive staff,
   Parent/guardian or Contractor.
6. Enter the approved priority according to the reviewed mapping design; avoid conflicting matches.
7. Click **Add mapping** and confirm it appears in the list.
8. Repeat for each approved group/category. Explicitly include negative/no-match/conflicting-group
   test cases in the plan.

**Expected result:** at least one exact provider-scoped mapping exists. A provider cannot be enabled
without one.

**Stop if:** the claim source is not signed/verified, nested/dynamic/group-overage behavior is not
tested, or a broad group would grant administrator privilege.

## Step 42 — test then publish SSO

1. During an approved identity test window, click **Enable** on the staged provider. RC5 checks its
   current row version and exact mapping.
2. Enable the corresponding Microsoft/Google/SAML family switch in **Allowed sign-in methods** and
   save. Generic OIDC uses the provider’s own status.
3. In a separate private window, test one synthetic user for each mapped category, plus no-match,
   disabled user, conflicting groups, absent MFA assurance and removed-group cases.
4. Confirm every user receives only the intended Edutex role/category and a separate device session.
5. Remove a directory group, sign in again and confirm stale directory-managed permission is
   removed.
6. On any failure, immediately return to Administration, click **Disable** for the provider and turn
   off its sign-in-method switch; preserve evidence.
7. Only after all positive/negative tests pass may P5/P4 record publication acceptance.

**Expected result:** exact claims map to exact least privilege; no match fails closed; stale grants
are removed on subsequent federation.

## Step 43 — execute the security/quality acceptance pack

P4/P7 must run and retain evidence for every applicable item—not simply tick this list:

- direct AWS origin discovery/connection fails;
- Cloudflare/TLS/header/cache/request-smuggling/host-header tests pass;
- unauthenticated users cannot download protected portal JavaScript/assets;
- password+TOTP, passkey, OAuth state/nonce/PKCE/browser binding, logout, expiry, recovery, disabled
  user, step-up and per-device revoke behavior pass;
- two live synthetic tenants/users cannot read, link or mutate one another at API and PostgreSQL RLS
  layers;
- parameterized SQL/mass-assignment/IDOR/injection/upload/SSRF/XSS/CSRF/rate-limit negative tests
  pass;
- selected sensitive fields are AES-GCM ciphertext in browser-to-database flow, keys require recent
  assurance and KMS tenant context, and plaintext/keys do not appear in logs/database;
- S3 is private and upload content/type/size/pixel/re-encoding controls work;
- audit chain verifies, security logs/alerts reach on-call, clocks correlate and incident exercise
  completes;
- isolated restore meets approved RPO/RTO without overwriting production;
- mobile, desktop, keyboard, screen reader, zoom and supported-browser tests pass;
- SAST, DAST, dependency, secret, container, IaC and live cloud-configuration scans pass or have an
  authorised time-bound treatment permitted by policy; and
- independent penetration-test findings are remediated/retested before client data/go-live.

**Expected result:** P1/P4/P5 sign target acceptance with objective evidence and residual-risk
owner.

**Stop if:** any cross-tenant, auth bypass, public origin, secret leak, integrity failure or
mandatory high/critical issue exists. Those are release blockers, not waivable convenience defects.

## Step 44 — complete ISO/quality governance and handover

1. ISMS owner maps actual evidence to the licensed ISO/IEC 27001:2022+Amd 1:2024 requirements,
   completes risk assessment/treatment and final Statement of Applicability.
2. QMS owner records requirements, competence, verification, nonconformity/CAPA, supplier controls,
   release acceptance, quality objectives and customer feedback under ISO 9001:2015+Amd 1:2024.
3. Conduct objective internal audits and management reviews; close findings with effectiveness
   evidence.
4. Retain approved ZIP/hash, source/lock/SBOM/image digest/signature, plans/hashes/receipt, tests,
   restore, monitoring, SSO, privacy/legal, penetration-test and approvals under records policy.
5. Provide school support/on-call contacts, incident/privacy notification route, backup/restore
   owner, identity owner and planned review/patch dates.
6. Claim certification only when a current accredited certificate’s organisation/scope/validity
   actually covers the service. Otherwise say “designed to support an ISO-aligned ISMS/QMS”.

**Expected result:** accountable operational service with controlled evidence—not merely running
code.

\newpage

# Part J — error finder

## Step 45 — match the exact message before asking for help

| What you see                                                       | Most likely meaning                        | Exact safe action                                                          |
| ------------------------------------------------------------------ | ------------------------------------------ | -------------------------------------------------------------------------- |
| `output file already exists`                                       | Interview already ran                      | Review it; use `--replace` only after approved changed input               |
| `NOT ACCEPTED`                                                     | Current answer format invalid              | Read reason; obtain correct approved value; answer same prompt             |
| `Secret-like property/value`                                       | Credential or unsafe name entered          | Remove it from workflow; store secret in approved manager; rerun interview |
| `placeholder value`                                                | Example/sample still used                  | Replace by rerunning interview with real approved data                     |
| `AWS profile resolved account ... not approved`                    | Wrong SSO profile/account                  | Stop; `aws sso logout`; P2 fixes assignment/profile; sign in again         |
| `CDK bootstrap stack readiness` fails                              | `CDKToolkit` missing/unstable              | P2 performs approved bootstrap/remediation; rerun read-only check          |
| Tunnel secret has no `AWSCURRENT`                                  | Secret created without current value/stage | P2/P3 correct Secrets Manager version; never paste token in Terminal       |
| State bucket region/encryption/public/ownership/versioning failure | One mandatory state protection differs     | P2 corrects bucket/KMS policy/config, then reruns check                    |
| KMS rotation failure                                               | Customer key rotation off/unsupported      | P2 selects suitable symmetric AWS-origin key and enables rotation          |
| SES verification failure                                           | Identity not `SUCCESS` in exact region     | Finish DNS verification/production sending; do not bypass invitations      |
| Cloudflare token missing                                           | Hidden environment variable not set        | Repeat Step 24 with a fresh scoped token                                   |
| Terraform `403`/permission error                                   | Token scope/resource/TTL wrong             | P3 revokes/fixes token; never broaden without review                       |
| WAF/rate resource unsupported                                      | Purchased plan lacks feature               | Stop and upgrade/approve architecture; do not delete security rule         |
| quality/source-doc/test/audit failure                              | Release/source/dependency not releasable   | Engineering fixes in a new reviewed RC; new plan/approval                  |
| plan hash mismatch                                                 | Source/config/plan changed                 | Generate and approve a completely new plan                                 |
| outside maintenance window                                         | Current time not approved                  | Stop; schedule/approve new window; regenerate config/plan as required      |
| migration/bootstrap container exit non-zero                        | Data/provisioning failed                   | Preserve ARN/logs/progress; follow exact-ARN retry in Step 35              |
| ECS service not stable                                             | Runtime/tunnel/health/config problem       | Keep evidence; use CloudWatch/ECS incident process; do not open origin     |
| SSO provider cannot enable                                         | No exact mapping/stale row                 | Refresh, create approved mapping, retest; do not bypass gate               |
| stale row-version conflict                                         | Another admin changed config               | Refresh, compare both changes, reapply only the intended reviewed change   |

When reporting an error, provide release, school slug, timestamp, failed `[RC5]` label, sanitized
message, account/region/hostname identifiers and evidence path. Never provide secrets, cookies,
authorization headers, temporary passwords, full student data or decrypted values.

\newpage

# Final assembly checklist

Do not mark an item complete from memory.

- [ ] Correct RC5 ZIP and separately delivered SHA-256 verified before extraction.
- [ ] Correct `Edutex-production` folder open; release prints `1.0.0-rc.5`.
- [ ] Source documentation gate covers 83 files/731 functions.
- [ ] One school/hostname/account/region/Cloudflare zone/tunnel/evidence set only.
- [ ] AWS SSO short-lived role/account compared through STS; no static access key/root use.
- [ ] `CDKToolkit` stable and reviewed.
- [ ] State bucket region/versioning/ownership/public block/TLS-only policy/exact KMS/Bucket Key
      verified.
- [ ] KMS key enabled/rotating; SES identity and production sending/configuration set successful;
      Tunnel token only in Secrets Manager.
- [ ] `production.json` created by Terminal interview, reviewed, owner-only and secret-free.
- [ ] `deploy:check` ended `CHECK PASSED`.
- [ ] Hidden short-lived Cloudflare token used only for plan/apply and removed/revoked.
- [ ] `deploy:plan` ended `PLAN READY`; two plan files, provider lock and exact hashes independently
      approved.
- [ ] Source/config/plan unchanged and apply ran inside exact approved window.
- [ ] Foundation ran at zero app tasks; migration and school bootstrap each succeeded before
      activation.
- [ ] `DEPLOYMENT COMPLETE` and receipt preserved in encrypted controlled evidence.
- [ ] Cloudflare Tunnel/DNS/WAF/rates/IP/country/admin policy verified live; no public AWS origin.
- [ ] Initial admin changed temporary password, enrolled required TOTP and approved passkey.
- [ ] Cognito OAuth client is confidential; its client secret exists only at the tenant-scoped
      Secrets Manager name and backend IAM can read only that exact suffix.
- [ ] Login methods/session limits/modules configured and negative-tested.
- [ ] Every external provider staged disabled, exact mappings approved, positive/negative tests
      passed and failed providers disabled.
- [ ] Cross-tenant/RLS, encryption, logs/alerts, restore, accessibility, resilience and independent
      penetration tests passed or release remains blocked.
- [ ] Privacy/legal/records, ISO 27001 ISMS and ISO 9001 QMS evidence/audits/reviews completed.
- [ ] Client/data owner, security owner and release authority signed go-live acceptance.

# Official pages used for screen locations

Console labels can change after this guide. At each release, P2/P3 verifies the current official
page before changing a security decision:

- AWS CLI IAM Identity Center:
  <https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-sso.html>
- AWS KMS automatic rotation:
  <https://docs.aws.amazon.com/kms/latest/developerguide/rotating-keys-enable.html>
- S3 default SSE-KMS/Bucket Key:
  <https://docs.aws.amazon.com/AmazonS3/latest/userguide/default-bucket-encryption.html>
- S3 versioning:
  <https://docs.aws.amazon.com/AmazonS3/latest/userguide/manage-versioning-examples.html>
- SES verified identities: <https://docs.aws.amazon.com/ses/latest/dg/view-verified-domains.html>
- Secrets Manager create secret:
  <https://docs.aws.amazon.com/secretsmanager/latest/userguide/create_secret.html>
- Cloudflare create remote Tunnel:
  <https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/get-started/create-remote-tunnel/>
- Cloudflare Tunnel tokens: <https://developers.cloudflare.com/tunnel/advanced/tunnel-tokens/>
- Cloudflare API tokens:
  <https://developers.cloudflare.com/fundamentals/api/get-started/create-token/>
- Cloudflare managed WAF dashboard:
  <https://developers.cloudflare.com/waf/managed-rules/deploy-zone-dashboard/>

# Tiny glossary

| Word               | Meaning in this manual                                                            |
| ------------------ | --------------------------------------------------------------------------------- |
| Browser            | Chrome/Edge/Safari/approved app used for AWS, Cloudflare and Edutex websites      |
| Visual Studio Code | Desktop code/file application containing Explorer, editor tabs and Terminal       |
| Terminal           | Bottom text panel where one command or interview answer is typed                  |
| Repository root    | Open folder ending `release/Edutex-production`, containing `package.json`         |
| Identifier/ARN     | Non-secret name/ID pointing to a cloud resource; still treat as internal metadata |
| Secret/token       | Credential that grants access; never belongs in JSON/source/chat/evidence         |
| Plan               | Proposed changes, reviewed before apply                                           |
| Apply              | The mutating action that creates/changes production                               |
| Hash/SHA-256       | Fingerprint proving bytes are unchanged                                           |
| State              | Terraform’s confidential record of managed Cloudflare resources                   |
| RLS                | PostgreSQL row-level security independently restricting rows by tenant            |
| CIDR               | IP address/range plus prefix, such as `/32` for one IPv4 address                  |
| Slug               | Permanent lower-case hyphenated school identifier                                 |
| ARN                | AWS resource identifier beginning `arn:aws:`; not the secret value behind it      |

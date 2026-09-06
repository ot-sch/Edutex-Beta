# RC5 Cloudflare policy graph. This file connects a single school hostname to an outbound-only
# Tunnel and places geographic/IP, administrator, method, scanner, health, managed-WAF and
# rate-limit controls in front of the private AWS service. Terraform receives identifiers from the
# validated deployment JSON and receives its short-lived API token only through the provider-native
# CLOUDFLARE_API_TOKEN child-process environment variable.

# Derive Cloudflare Rules language fragments from already validated lists. When both whole-site IP
# and country lists are present, a source is admitted if it is on either approved list; identity and
# application authorization remain mandatory after this edge decision.
locals {
  ip_set                 = join(" ", var.allowed_ip_cidrs)
  country_set            = join(" ", [for code in var.allowed_country_codes : format("\"%s\"", code)])
  admin_ip_set           = join(" ", var.admin_ip_cidrs)
  restrict_ips           = length(var.allowed_ip_cidrs) > 0
  restrict_countries     = length(var.allowed_country_codes) > 0
  restrict_admin_network = length(var.admin_ip_cidrs) > 0

  site_denial_expression = local.restrict_ips && local.restrict_countries ? format(
    "(http.host eq \"%s\" and not ip.src in {%s} and not ip.src.country in {%s})",
    var.hostname,
    local.ip_set,
    local.country_set,
    ) : local.restrict_ips ? format(
    "(http.host eq \"%s\" and not ip.src in {%s})",
    var.hostname,
    local.ip_set,
    ) : local.restrict_countries ? format(
    "(http.host eq \"%s\" and not ip.src.country in {%s})",
    var.hostname,
    local.country_set,
  ) : "false"
}

# Publish only a proxied CNAME to the Cloudflare Tunnel UUID. No AWS IP address or load balancer is
# created or disclosed by this record.
resource "cloudflare_dns_record" "application" {
  zone_id = var.zone_id
  name    = var.hostname
  content = "${var.tunnel_id}.cfargotunnel.com"
  type    = "CNAME"
  proxied = true
  ttl     = 1
  comment = "Edutex private origin through Cloudflare Tunnel"
}

# Route the exact hostname through the remote Tunnel to cloudflared on Fargate loopback port 8080.
# The terminal 404 ingress rule fails closed for every hostname not explicitly listed above it.
resource "cloudflare_zero_trust_tunnel_cloudflared_config" "application" {
  account_id = var.account_id
  tunnel_id  = var.tunnel_id
  config = {
    ingress = [
      {
        hostname = var.hostname
        service  = "http://127.0.0.1:8080"
        origin_request = {
          http_host_header = var.hostname
          connect_timeout  = 10
          tcp_keep_alive   = 30
        }
      },
      { service = "http_status:404" },
    ]
  }
}

# Apply school-specific admission policy before a request reaches the managed rules or origin. The
# optional admin CIDR rule narrows both the admin UI and API; method/scanner/health rules are always
# active. Bot Management is opt-in because its fields depend on the purchased Cloudflare plan.
resource "cloudflare_ruleset" "custom_waf" {
  zone_id     = var.zone_id
  name        = "Edutex production access and application rules"
  description = "Fail-closed network policy before requests reach the private AWS origin."
  kind        = "zone"
  phase       = "http_request_firewall_custom"

  rules = concat(
    local.restrict_ips || local.restrict_countries ? [{
      ref         = "edutex_site_geography_and_ip_policy"
      action      = "block"
      expression  = local.site_denial_expression
      description = "Block sources outside the school IP/country policy"
      enabled     = true
    }] : [],
    local.restrict_admin_network ? [{
      ref         = "edutex_admin_network_policy"
      action      = "block"
      expression  = format("(http.host eq \"%s\" and (starts_with(http.request.uri.path, \"/app/admin\") or starts_with(http.request.uri.path, \"/api/v1/admin\")) and not ip.src in {%s})", var.hostname, local.admin_ip_set)
      description = "Restrict administration UI to approved networks"
      enabled     = true
    }] : [],
    concat([
      {
        ref         = "edutex_reject_unexpected_methods"
        action      = "block"
        expression  = format("(http.host eq \"%s\" and not http.request.method in {\"GET\" \"HEAD\" \"OPTIONS\" \"POST\" \"PUT\" \"PATCH\" \"DELETE\"})", var.hostname)
        description = "Reject HTTP methods not used by Edutex"
        enabled     = true
      },
      {
        ref         = "edutex_block_scanner_paths"
        action      = "block"
        expression  = format("(http.host eq \"%s\" and (lower(http.request.uri.path) contains \"/.env\" or lower(http.request.uri.path) contains \"/.git\" or lower(http.request.uri.path) contains \"/wp-admin\" or lower(http.request.uri.path) contains \"/phpmyadmin\"))", var.hostname)
        description = "Block common secret and unrelated product probes"
        enabled     = true
      },
      {
        ref         = "edutex_block_public_health_probes"
        action      = "block"
        expression  = format("(http.host eq \"%s\" and starts_with(http.request.uri.path, \"/health/\"))", var.hostname)
        description = "Keep container health endpoints private to AWS"
        enabled     = true
      },
      ], var.enable_bot_management ? [{
        ref         = "edutex_managed_challenge_automation"
        action      = "managed_challenge"
        expression  = format("(http.host eq \"%s\" and cf.bot_management.score lt 30 and not cf.bot_management.verified_bot)", var.hostname)
        description = "Challenge likely automated traffic while allowing verified bots"
        enabled     = true
    }] : []),
  )
}

# Execute Cloudflare's managed rules followed by the OWASP managed rules at paranoia level 3. A
# target-account Terraform plan is mandatory because managed rule entitlements vary by plan.
resource "cloudflare_ruleset" "managed_waf" {
  zone_id     = var.zone_id
  name        = "Edutex managed WAF deployments"
  description = "Cloudflare managed and OWASP managed rulesets."
  kind        = "zone"
  phase       = "http_request_firewall_managed"

  rules = [
    {
      ref         = "edutex_cloudflare_managed_rules"
      action      = "execute"
      expression  = format("(http.host eq \"%s\")", var.hostname)
      description = "Cloudflare Managed Ruleset"
      enabled     = true
      action_parameters = {
        id = "efb7b8c949ac4650a09736fc376e9aee"
      }
    },
    {
      ref         = "edutex_owasp_core_rules"
      action      = "execute"
      expression  = format("(http.host eq \"%s\")", var.hostname)
      description = "Cloudflare OWASP Core Ruleset"
      enabled     = true
      action_parameters = {
        id = "4814384a9e5d4991b9815dcfc25d2f1f"
        overrides = {
          # Cloudflare enables PL1-PL4 by default. Disabling only PL4 sets PL3.
          categories = [{ category = "paranoia-level-4", enabled = false }]
        }
      }
    },
  ]
}

# Throttle authentication initiation more strictly than ordinary APIs. These source-based edge
# limits complement, and never replace, account/session/tenant-aware limits inside Fastify.
resource "cloudflare_ruleset" "rate_limits" {
  zone_id     = var.zone_id
  name        = "Edutex abuse rate limits"
  description = "Edge throttles complement the per-session and API limits at the origin."
  kind        = "zone"
  phase       = "http_ratelimit"

  rules = [
    {
      ref         = "edutex_auth_start_rate_limit"
      action      = "block"
      expression  = format("(http.host eq \"%s\" and starts_with(http.request.uri.path, \"/api/v1/auth/\"))", var.hostname)
      description = "Limit authentication transactions by source"
      enabled     = true
      ratelimit = {
        characteristics     = ["cf.colo.id", "ip.src"]
        period              = 60
        requests_per_period = 20
        mitigation_timeout  = 600
      }
    },
    {
      ref         = "edutex_api_rate_limit"
      action      = "managed_challenge"
      expression  = format("(http.host eq \"%s\" and starts_with(http.request.uri.path, \"/api/\"))", var.hostname)
      description = "Challenge abusive API clients at the edge"
      enabled     = true
      ratelimit = {
        characteristics     = ["cf.colo.id", "ip.src"]
        period              = 60
        requests_per_period = 600
        mitigation_timeout  = 60
      }
    },
  ]
}

# RC5 Cloudflare input contract. Every non-secret value is generated from the deployment assistant's
# cross-field-validated JSON. Terraform repeats format/duplicate/CIDR validation as an independent
# boundary. The scoped API token is read by the provider from `CLOUDFLARE_API_TOKEN`; it is not a
# Terraform input value and must never be written to tfvars, plans or state.

# Exact Cloudflare account that owns the named Tunnel.
variable "account_id" {
  description = "Cloudflare account identifier."
  type        = string
  validation {
    condition     = can(regex("^[0-9a-fA-F]{32}$", var.account_id))
    error_message = "account_id must be the 32-character Cloudflare account identifier."
  }
}

# Exact DNS zone that owns the school hostname and WAF entry-point rulesets.
variable "zone_id" {
  description = "Cloudflare zone identifier for the client domain."
  type        = string
  validation {
    condition     = can(regex("^[0-9a-fA-F]{32}$", var.zone_id))
    error_message = "zone_id must be the 32-character Cloudflare zone identifier."
  }
}

# Single supported production hostname; it must match school bootstrap and CDK parameters.
variable "hostname" {
  description = "Exact school hostname, for example portal.school.example."
  type        = string
  validation {
    condition     = length(var.hostname) <= 253 && can(regex("^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$", var.hostname))
    error_message = "hostname must be a complete lower-case DNS name with valid labels."
  }
}

# UUID only—not the connector token—of the remotely managed Tunnel configured in main.tf.
variable "tunnel_id" {
  description = "UUID of the remotely managed Cloudflare Tunnel."
  type        = string
  validation {
    condition     = can(regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$", var.tunnel_id))
    error_message = "tunnel_id must be the Cloudflare Tunnel UUID."
  }
}

# Optional whole-site source networks. An empty list does not turn off application authentication.
variable "allowed_ip_cidrs" {
  description = "Optional whole-site allowlist. Leave empty to rely on country and identity controls."
  type        = list(string)
  default     = []
  validation {
    condition     = length(distinct(var.allowed_ip_cidrs)) == length(var.allowed_ip_cidrs) && alltrue([for cidr in var.allowed_ip_cidrs : can(cidrhost(cidr, 0))])
    error_message = "allowed_ip_cidrs must contain unique valid IPv4 or IPv6 CIDR ranges."
  }
}

# Optional whole-site Cloudflare geolocation countries, expressed as ISO alpha-2 codes.
variable "allowed_country_codes" {
  description = "Optional ISO 3166-1 alpha-2 source countries accepted by the school."
  type        = list(string)
  default     = []
  validation {
    condition     = length(distinct(var.allowed_country_codes)) == length(var.allowed_country_codes) && alltrue([for code in var.allowed_country_codes : can(regex("^[A-Z]{2}$", code))])
    error_message = "Country codes must be unique upper-case ISO alpha-2 codes."
  }
}

# Optional narrower networks allowed to reach administration paths before identity checks.
variable "admin_ip_cidrs" {
  description = "Optional network allowlist for the protected administration path."
  type        = list(string)
  default     = []
  validation {
    condition     = length(distinct(var.admin_ip_cidrs)) == length(var.admin_ip_cidrs) && alltrue([for cidr in var.admin_ip_cidrs : can(cidrhost(cidr, 0))])
    error_message = "admin_ip_cidrs must contain unique valid IPv4 or IPv6 CIDR ranges."
  }
}

# Explicit plan-dependent switch; false is the portable fail-safe default.
variable "enable_bot_management" {
  description = "Enable the Bot Management score rule when the selected Cloudflare plan exposes cf.bot_management fields."
  type        = bool
  default     = false
}

# Return the final proxied hostname for go-live evidence; this value is not confidential.
output "application_hostname" {
  value       = cloudflare_dns_record.application.name
  description = "Cloudflare-only Edutex hostname."
}

# Return only the Cloudflare Tunnel CNAME target so operators can prove DNS never names an AWS origin.
output "tunnel_target" {
  value       = cloudflare_dns_record.application.content
  description = "Private tunnel DNS target; this is not a public AWS origin."
}

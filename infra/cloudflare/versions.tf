# Pin the Terraform core/provider compatibility boundary reviewed for RC5. The exact provider lock
# selected during init is hashed into the approved plan record; changing it requires a new plan.
terraform {
  required_version = ">= 1.10.0, < 2.0.0"
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = ">= 5.10.0, < 6.0.0"
    }
  }
}

# The provider reads `CLOUDFLARE_API_TOKEN` directly from its child-process environment. Keeping the
# block empty prevents the credential becoming part of Terraform's input-variable/plan model.
provider "cloudflare" {}

terraform {
  required_version = "~> 1.9"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.0"
    }
  }

  # Remote state: separate storage account in an existing shared
  # "tfstate" resource group (funjibly-tfstate-rg), not in rg-backstage -
  # state must survive even if the infra it describes gets destroyed.
  # Auth is Azure AD only (the storage account has shared-key access
  # disabled entirely) via `use_azuread_auth` - whoever/whatever runs
  # Terraform authenticates as itself (your `az login`, or the CI service
  # principal's ARM_* env vars) and needs the "Storage Blob Data
  # Contributor" role on this storage account to read+write+lock state,
  # or "Storage Blob Data Reader" to only ever read it (e.g. for a
  # plan-only CI job - see .github/workflows/deploy.yml).
  backend "azurerm" {
    resource_group_name  = "funjibly-tfstate-rg"
    storage_account_name = "backstagetf"
    container_name       = "tfstate"
    key                  = "azure-container-apps.tfstate"
    use_azuread_auth     = true
  }
}

provider "azurerm" {
  # Pinned explicitly so `terraform apply` always targets this subscription
  # regardless of which subscription the local `az` CLI context is set to.
  subscription_id = var.subscription_id

  features {}
}

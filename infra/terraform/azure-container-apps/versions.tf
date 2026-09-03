terraform {
  required_version = "~> 1.9"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 5.0"
    }
  }

  # Local state on purpose for this single-environment personal deployment.
  # Revisit with a remote azurerm backend (storage account + container, native
  # blob leasing for locking) if this ever becomes a shared/team deployment.
}

provider "azurerm" {
  # Pinned explicitly so `terraform apply` always targets this subscription
  # regardless of which subscription the local `az` CLI context is set to.
  subscription_id = var.subscription_id

  features {}
}

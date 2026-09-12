terraform {
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 3.0"
    }
  }
  backend "azurerm" {
    # Values passed via -backend-config in CI: resource_group_name,
    # storage_account_name, container_name, key (per-service state file)
  }
}

provider "azurerm" {
  features {}
}

resource "azurerm_container_app" "this" {
  name                         = var.service_name
  container_app_environment_id = var.container_apps_environment_id
  resource_group_name          = var.resource_group_name
  revision_mode                = "Single"

  secret {
    name  = "ghcr-pat"
    value = var.ghcr_pat
  }

  registry {
    server               = "ghcr.io"
    username              = var.ghcr_username
    password_secret_name  = "ghcr-pat"
  }

  template {
    container {
      name   = var.service_name
      image  = var.image
      cpu    = 0.25
      memory = "0.5Gi"
    }
  }

  ingress {
    external_enabled = true
    target_port      = var.container_port
    traffic_weight {
      percentage      = 100
      latest_revision = true
    }
  }
}

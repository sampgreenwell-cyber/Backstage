resource "azurerm_resource_group" "backstage" {
  name     = var.resource_group_name
  location = var.location
  tags     = var.tags
}

resource "azurerm_log_analytics_workspace" "backstage" {
  name                = "log-${var.app_name}"
  resource_group_name = azurerm_resource_group.backstage.name
  location            = azurerm_resource_group.backstage.location
  sku                 = "PerGB2018"
  retention_in_days   = 30
  tags                = var.tags
}

resource "azurerm_container_app_environment" "backstage" {
  name                       = "cae-${var.app_name}"
  resource_group_name        = azurerm_resource_group.backstage.name
  location                   = azurerm_resource_group.backstage.location
  log_analytics_workspace_id = azurerm_log_analytics_workspace.backstage.id
  logs_destination           = "log-analytics"
  tags                       = var.tags
}

locals {
  # Azure Container Apps' external-ingress FQDN is deterministic:
  # <app-name>.<environment default_domain> - so this can be computed from
  # the environment (created earlier in this graph) without waiting on the
  # container app resource itself.
  app_base_url = "https://${var.app_name}.${azurerm_container_app_environment.backstage.default_domain}"
}

resource "azurerm_container_app" "backstage" {
  name                         = var.app_name
  resource_group_name          = azurerm_resource_group.backstage.name
  container_app_environment_id = azurerm_container_app_environment.backstage.id
  revision_mode                = "Single"

  # GHCR pull credential. This is the only secret Terraform manages -
  # DATABASE_URL and any other app secrets are added manually in the portal
  # after the first apply (see lifecycle block below).
  secret {
    name  = "ghcr-pat"
    value = var.ghcr_pat
  }

  registry {
    server               = "ghcr.io"
    username             = var.ghcr_username
    password_secret_name = "ghcr-pat"
  }

  template {
    min_replicas = var.min_replicas
    max_replicas = var.max_replicas

    container {
      name   = var.app_name
      image  = var.container_image
      cpu    = var.container_cpu
      memory = var.container_memory

      # Backstage requires app.baseUrl/backend.baseUrl to match its real
      # public URL (see app-config.production.yaml) - auth callbacks, CORS,
      # and links break otherwise. Frozen by the ignore_changes below once
      # set, same as the rest of `env` - see that comment for why.
      env {
        name  = "APP_BASE_URL"
        value = local.app_base_url
      }
    }
  }

  ingress {
    external_enabled = true
    target_port      = var.container_port
    transport        = "http"

    traffic_weight {
      latest_revision = true
      percentage      = 100
    }
  }

  tags = var.tags

  lifecycle {
    # DATABASE_URL and other secrets/env vars get added by hand in the Azure
    # portal after this first apply. Both `secret` and the container's `env`
    # list are managed by Terraform as complete lists, so without these
    # ignores the next `terraform apply` (e.g. to roll out a new image tag)
    # would silently delete anything added outside Terraform.
    #
    # Trade-off: once applied, Terraform will also stop noticing changes you
    # make to the ghcr-pat secret itself. To rotate that PAT later, either
    # remove this ignore temporarily and re-apply, or update it directly in
    # the portal/CLI to match what's already running.
    ignore_changes = [
      secret,
      template[0].container[0].env,
    ]
  }
}

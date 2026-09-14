terraform {
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 3.0"
    }
  }
  backend "azurerm" {
    use_azuread_auth = true
  }
}

module "service" {
  source                        = "git::https://github.com/sampgreenwell-cyber/terraform-modules.git//container-app-service?ref=v1.0.0"
  service_name                  = var.service_name
  image                         = var.image
  container_apps_environment_id = var.container_apps_environment_id
  resource_group_name           = var.resource_group_name
  ghcr_pat                      = var.ghcr_pat
  ghcr_username                 = var.ghcr_username
  container_port                = var.container_port
}
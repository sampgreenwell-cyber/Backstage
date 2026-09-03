output "resource_group_name" {
  description = "Name of the resource group holding all Backstage infrastructure."
  value       = azurerm_resource_group.backstage.name
}

output "container_app_environment_id" {
  description = "ID of the Container Apps managed environment."
  value       = azurerm_container_app_environment.backstage.id
}

output "container_app_name" {
  description = "Name of the deployed Container App."
  value       = azurerm_container_app.backstage.name
}

output "container_app_url" {
  description = "Public HTTPS URL of the Backstage Container App."
  value       = "https://${azurerm_container_app.backstage.ingress[0].fqdn}"
}

output "container_app_latest_revision_fqdn" {
  description = "FQDN of the latest active revision (useful for debugging revision-specific issues)."
  value       = azurerm_container_app.backstage.latest_revision_fqdn
}

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

output "postgres_server_fqdn" {
  description = "Hostname of the Postgres Flexible Server, for DATABASE_URL."
  value       = azurerm_postgresql_flexible_server.backstage.fqdn
}

output "postgres_admin_login" {
  description = "Admin login for the Postgres Flexible Server, for DATABASE_URL."
  value       = azurerm_postgresql_flexible_server.backstage.administrator_login
}

output "postgres_admin_password" {
  description = "Generated admin password for the Postgres Flexible Server. Not wired into the Container App by Terraform - build DATABASE_URL from it and set it manually (see README). Retrieve with: terraform output -raw postgres_admin_password"
  value       = random_password.postgres_admin.result
  sensitive   = true
}

output "backend_auth_secret" {
  description = "Generated value for backend.auth.keys[0].secret. Not wired into the Container App by Terraform (see the comment on random_password.backend_auth_secret in main.tf) - set it manually as BACKEND_AUTH_SECRET, same as DATABASE_URL. Retrieve with: terraform output -raw backend_auth_secret"
  value       = random_password.backend_auth_secret.result
  sensitive   = true
}

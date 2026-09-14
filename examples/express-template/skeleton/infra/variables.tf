variable "service_name" {
  type = string
}
variable "image" {
  type = string
}
variable "container_port" {
  type    = number
  default = 8080
}
variable "resource_group_name" {
  type    = string
  default = "rg-platform-services"
}
variable "container_apps_environment_id" {
  type = string
}
variable "ghcr_pat" {
  type      = string
  sensitive = true
}
variable "ghcr_username" {
  type = string
}

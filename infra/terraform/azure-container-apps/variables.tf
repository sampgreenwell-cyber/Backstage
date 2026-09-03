variable "subscription_id" {
  description = "Azure subscription ID to deploy into."
  type        = string
  default     = "ad459e83-6ba1-44f5-8be3-f4a8fa27b4a2"
}

variable "resource_group_name" {
  description = "Name of the resource group that will hold all Backstage infrastructure."
  type        = string
  default     = "rg-backstage"
}

variable "location" {
  description = "Azure region for the resource group and all resources within it."
  type        = string
  default     = "eastus"
}

variable "app_name" {
  description = "Base name used to derive the Container App, environment, and Log Analytics workspace names."
  type        = string
  default     = "backstage"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,30}[a-z0-9]$", var.app_name))
    error_message = "app_name must be lowercase alphanumeric/hyphens, start with a letter, 3-32 characters (Azure Container App naming rules)."
  }
}

variable "container_image" {
  description = "Full GHCR image reference (repository:tag) to deploy, e.g. ghcr.io/<owner>/backstage:latest. Change this and re-apply to roll out a new image."
  type        = string
  default     = "ghcr.io/sampgreenwell-cyber/backstage:latest"
}

variable "container_port" {
  description = "Port the Backstage backend listens on inside the container (matches backend.listen in app-config.production.yaml)."
  type        = number
  default     = 7007
}

variable "container_cpu" {
  description = "vCPU cores allocated per replica. Must be one of Container Apps' supported CPU/memory pairs (e.g. 0.25/0.5Gi, 0.5/1Gi, 0.75/1.5Gi, 1.0/2Gi)."
  type        = number
  default     = 0.5
}

variable "container_memory" {
  description = "Memory allocated per replica. Must pair validly with container_cpu (see container_cpu description)."
  type        = string
  default     = "1Gi"
}

variable "min_replicas" {
  description = "Minimum number of replicas. Set to 0 to allow scale-to-zero when idle."
  type        = number
  default     = 1
}

variable "max_replicas" {
  description = "Maximum number of replicas Container Apps may scale out to."
  type        = number
  default     = 3
}

variable "ghcr_username" {
  description = "GitHub username that owns the GHCR personal access token used to pull the private image."
  type        = string
  default     = "sampgreenwell-cyber"
}

variable "ghcr_pat" {
  description = "GitHub personal access token (read:packages scope) used as the GHCR pull secret. Pass via TF_VAR_ghcr_pat or -var, never commit it to a .tfvars file."
  type        = string
  sensitive   = true

  validation {
    condition     = length(var.ghcr_pat) > 0
    error_message = "ghcr_pat must not be empty. Supply it via the TF_VAR_ghcr_pat environment variable or -var on the command line."
  }
}

variable "tags" {
  description = "Tags applied to every resource this module creates."
  type        = map(string)
  default = {
    project    = "backstage"
    managed_by = "terraform"
  }
}

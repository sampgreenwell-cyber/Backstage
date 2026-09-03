# Backstage on Azure Container Apps

Deploys the Backstage backend Docker image (published to GHCR) as an Azure
Container Apps Environment + Container App.

## What this creates

- Resource group (`rg-backstage` by default)
- Log Analytics workspace (required by Container Apps for logging)
- Container Apps managed Environment
- Container App with external HTTPS ingress on the backend's port (7007),
  pulling the private image from `ghcr.io` using a GHCR PAT

## What this deliberately does NOT manage

`DATABASE_URL` and any other runtime secrets/connection strings are **not**
set by this module. Add them by hand in the Azure Portal (Container App →
Secrets, and Container App → Containers → Environment variables) after the
first apply. A `lifecycle.ignore_changes` block on the container app makes
sure future `terraform apply` runs (e.g. to roll out a new image tag) won't
wipe out what you add manually. See the comment on that block in `main.tf`
for the trade-off this creates for rotating the GHCR PAT itself.

## Prerequisites

- Terraform >= 1.9 (you have 1.15.8 installed — fine)
- `az login` with access to subscription `ad459e83-6ba1-44f5-8be3-f4a8fa27b4a2`
  (already the case in this environment)
- A GHCR PAT (`backstage3`) with at least `read:packages` scope
- The image already pushed to `ghcr.io/sampgreenwell-cyber/backstage:<tag>`

## Usage

```bash
cd infra/terraform/azure-container-apps
terraform init

# Never put the PAT in a .tfvars file that could get committed.
export TF_VAR_ghcr_pat="ghp_..."

terraform plan -out=tfplan
terraform apply tfplan
```

Override any variable with `-var` or `-var-file`, e.g. to deploy a specific
image tag:

```bash
terraform apply -var='container_image=ghcr.io/sampgreenwell-cyber/backstage:v1.2.3'
```

## After the first apply

1. Grab the app's URL: `terraform output container_app_url`
2. In the Azure Portal, open the Container App → **Secrets**, add a secret
   (e.g. `database-url`) with your Postgres connection string.
3. Under **Containers → Environment variables**, add `DATABASE_URL`
   referencing that secret (and any other runtime env vars/secrets you need).
4. **Heads up on app config**: `app-config.production.yaml` currently
   hardcodes `app.baseUrl` and `backend.baseUrl` to `http://localhost:7007`.
   Once this is running behind the Container Apps FQDN, those need to point
   at the real public URL (from step 1) or auth callbacks, CORS, and links
   rendered in the UI will be broken. That's an app-config/image change, not
   something this Terraform module can fix — happy to wire it up (e.g. via
   an env-var-driven override) if you want.

## State

This module uses local state (`terraform.tfstate` in this directory) since
it's a single personal deployment. If it ever becomes a shared/team
deployment, migrate to a remote `azurerm` backend (storage account +
container) for locking and durability.

## CI/CD

`.github/workflows/deploy.yml` builds the backend image, pushes it to GHCR,
and runs `terraform plan` for visibility on every push/PR to `main`. It does
**not** run `terraform apply` - because this module uses local state (see
above), an ephemeral GitHub Actions runner has no record of what's already
deployed, so an apply from CI isn't safe until this module moves to a
remote backend. Until then, `terraform apply` stays a manual step you run
from this directory, typically with `-var="container_image=..."` pointing
at the SHA tag the workflow just pushed.

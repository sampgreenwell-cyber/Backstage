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

`DATABASE_URL`, `BACKEND_AUTH_SECRET`, and any other runtime secrets are
**not** set by this module. Add them by hand in the Azure Portal (Container
App → Secrets, and Container App → Containers → Environment variables)
after the first apply. A `lifecycle.ignore_changes` block on the container
app makes sure future `terraform apply` runs (e.g. to roll out a new image
tag) won't wipe out what you add manually. See the comment on that block in
`main.tf` for the trade-off this creates for rotating the GHCR PAT itself.

`random_password.backend_auth_secret` generates a value for you (so you
don't have to invent one), exposed via `terraform output -raw
backend_auth_secret` - but it is **not** wired into the Container App by
this module. Set it the same manual way as `DATABASE_URL`.

**Do not "temporarily lift" the `secret`/`env` entries in `ignore_changes`
to add a new Terraform-managed secret or env var once anything has been
added manually.** Both are full-replacement lists in the Azure API: a plan
with the guard lifted reflects *only* what's in this module's config, so it
silently proposes deleting anything added outside Terraform (confirmed the
hard way while building this module - it nearly deleted a manually-added
`DATABASE_URL`). If Terraform needs to manage a new secret/env var going
forward, wire it in at the same time as everything else currently live
(check `az containerapp show` first), or just set it manually via
`az containerapp secret set` / `--set-env-vars`, same as `DATABASE_URL`.

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

1. Grab the app's URL: `terraform output container_app_url`. `app.baseUrl`
   and `backend.baseUrl` are set automatically (via `APP_BASE_URL`, computed
   by Terraform from the Container App's own FQDN) - no manual step needed
   for that.
2. In the Azure Portal, open the Container App → **Secrets**, add:
   - `database-url` - your Postgres connection string
   - `backend-auth-secret` - the value from
     `terraform output -raw backend_auth_secret`
3. Under **Containers → Environment variables**, add (each referencing the
   matching secret above):
   - `DATABASE_URL`
   - `BACKEND_AUTH_SECRET`
4. Save - this creates a new revision and restarts the app.

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

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

`.github/workflows/deploy.yml`, on every push/PR to `main`:

1. Builds the backend image and pushes it to GHCR, tagged with the short
   git SHA (plus `:latest` on `main`).
2. Runs `terraform plan` for visibility - never `terraform apply` (see
   below for why).
3. **On push to `main` only**: runs `az containerapp update --image
   ghcr.io/.../backstage:<sha>` to point the live Container App at that
   exact image. This is what actually deploys each push - Terraform is not
   involved in routine deploys at all.

Two things worth understanding about that split:

- **Why `terraform apply` doesn't run in CI**: this module uses local state
  (see above), so an ephemeral GitHub Actions runner has no record of what
  infrastructure already exists - an apply from CI would either fail
  (resources already exist) or drift against real state. `terraform apply`
  stays a manual step you run from this directory for infra-only changes
  (CPU/memory, scaling, ingress, etc).
- **Why routine deploys go through `az containerapp update` instead**:
  unlike Terraform (which needs state to know what changed), swapping the
  image is a single idempotent API call that needs no state at all - it's
  the same fix as a manual `az containerapp update --image ...`, just run
  automatically on every push to `main`. This is also *why* pushing to
  `:latest` alone was never enough to trigger a redeploy: Container Apps
  only creates a new revision when the image *reference* string changes,
  and `:latest` never changes even though its content does. Tagging with
  the git SHA and pointing `az containerapp update` at that exact tag is
  what fixes it for good - no more manual `az containerapp update`
  workarounds needed after a push.

Because routine deploys now bypass Terraform, `template[0].container[0].image`
is in `azurerm_container_app.backstage`'s `ignore_changes` (see `main.tf`) -
otherwise a later infra-only `terraform apply` would silently roll the
running app back to whatever `var.container_image` defaults to.

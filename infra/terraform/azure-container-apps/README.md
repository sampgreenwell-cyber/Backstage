# Backstage on Azure Container Apps

Deploys the Backstage backend Docker image (published to GHCR) as an Azure
Container Apps Environment + Container App.

## What this creates

- Resource group (`rg-backstage` by default)
- Log Analytics workspace (required by Container Apps for logging)
- Container Apps managed Environment
- Container App with external HTTPS ingress on the backend's port (7007),
  pulling the private image from `ghcr.io` using a GHCR PAT
- Azure Database for PostgreSQL Flexible Server (the production database):
  Burstable `B_Standard_B1ms`, PostgreSQL 16, 32 GB storage (auto-grow
  off), 7-day backups, no HA or geo-redundant backup, plus an
  `AllowAzureServices` firewall rule and a generated admin password. See
  [Database](#database) below.

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
- The "Storage Blob Data Contributor" role on the `backstagetf` storage
  account (see State below) - without it, `terraform init`/`plan`/`apply`
  can't read or lock state. Run this on any new machine you run Terraform
  from (needs a one-time role assignment from someone who already has
  Owner/User Access Administrator on it):
  ```bash
  az role assignment create --assignee <your-object-id> \
    --role "Storage Blob Data Contributor" \
    --scope "/subscriptions/ad459e83-6ba1-44f5-8be3-f4a8fa27b4a2/resourceGroups/funjibly-tfstate-rg/providers/Microsoft.Storage/storageAccounts/backstagetf"
  ```
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
   - `database-url` - the Postgres connection string, built from the
     Terraform outputs as shown in [Setting DATABASE_URL](#setting-database_url)
   - `backend-auth-secret` - the value from
     `terraform output -raw backend_auth_secret`
3. Under **Containers → Environment variables**, add (each referencing the
   matching secret above):
   - `DATABASE_URL`
   - `BACKEND_AUTH_SECRET`
4. Save - this creates a new revision and restarts the app.

## Database

The production database is the Flexible Server above, replacing the
previous free-tier Neon instance (which suspends its compute once the
monthly allowance runs out).

- **Region**: `eastus2` (`var.postgres_location`), not `eastus` like the
  rest of the module. Azure returns "Provisioning is restricted in this
  region" for Flexible Server in `eastus` on this subscription. Both are
  in Virginia, so app-to-database latency is a few ms.
- **Cost**: about $16/month in eastus2 (checked 2026-09 via the Azure
  retail prices API): B1ms compute $0.017/hr ≈ $12.41, plus 32 GB ×
  $0.115/GB ≈ $3.68. Backup storage is free up to the provisioned storage
  size.
- **Connection limit**: B1ms allows only ~50 connections, and Backstage
  opens a knex pool per plugin database. If the logs show `too many
  connections` or `remaining connection slots are reserved`, cap
  `backend.database.knexConfig.pool.max` in `app-config.production.yaml`.
- **Network**: public endpoint, TLS enforced (server default), and the
  `AllowAzureServices` (0.0.0.0) rule so the Container App - which has no
  static outbound IP - can connect. That rule admits any Azure-hosted
  source, so the generated password and TLS are the real protection.

### Setting DATABASE_URL

Terraform does not set it (see "What this deliberately does NOT manage").
Build it from the outputs:

```bash
FQDN=$(terraform output -raw postgres_server_fqdn)
USER=$(terraform output -raw postgres_admin_login)
PASS=$(terraform output -raw postgres_admin_password)
DATABASE_URL="postgresql://$USER:$PASS@$FQDN:5432/postgres?sslmode=verify-full"
```

`/postgres` is only the bootstrap database: Backstage creates and uses its
own `backstage_plugin_*` databases on first start, so a fresh server needs
no manual schema setup. The password is alphanumeric, so no URL-encoding
is needed.

Then store it as the `database-url` secret and point the `DATABASE_URL` env
var at it. `--set-env-vars` only touches that one variable, and changing
the template creates a new revision, so no separate restart is needed:

```bash
az containerapp secret set -n backstage -g rg-backstage \
  --secrets database-url="$DATABASE_URL"
az containerapp update -n backstage -g rg-backstage \
  --set-env-vars DATABASE_URL=secretref:database-url
```

Once `DATABASE_URL` already references the secret, rotating it later only
needs the `secret set` plus a restart of the active revision, because a
secret change on its own doesn't create a revision:

```bash
az containerapp revision restart -n backstage -g rg-backstage \
  --revision $(az containerapp revision list -n backstage -g rg-backstage \
    --query "[?properties.active].name | [0]" -o tsv)
```

(Before this change, `DATABASE_URL` held the old Neon URL as a plain env
var value rather than a secret reference.)

### Temporary workstation access

For `psql` from your machine, add a rule for your IP **with the CLI, not
Terraform** (so it never lands in state), and delete it when you're done:

```bash
PG=$(terraform output -raw postgres_server_fqdn | cut -d. -f1)
MYIP=$(curl -s https://api.ipify.org)
az postgres flexible-server firewall-rule create -g rg-backstage -n "$PG" \
  --rule-name tmp-operator-verify --start-ip-address "$MYIP" --end-ip-address "$MYIP"

psql "$DATABASE_URL" -c "select version();"

az postgres flexible-server firewall-rule delete -g rg-backstage -n "$PG" \
  --rule-name tmp-operator-verify --yes
```

## State

Remote, in a storage account dedicated to Terraform state (`backstagetf`,
container `tfstate`) in `funjibly-tfstate-rg` - a separate resource group
from `rg-backstage` on purpose, so state survives even if this module's
own infrastructure gets destroyed. That storage account:

- Has shared-key access disabled entirely (`allowSharedKeyAccess: false`)
  - everything is Azure AD auth (`use_azuread_auth = true` in the backend
  block, see `versions.tf`), no storage key to manage, rotate, or leak.
- Has blob versioning and 30-day soft-delete enabled, as a backstop against
  state corruption or an errant delete.
- Grants **Storage Blob Data Contributor** (read + write + lock) to human
  operators, and **Storage Blob Data Reader** (read-only, no lock/write) to
  the CI service principal (`sp-backstage-deploy`) - see CI/CD below for
  why that split matters.

This is a genuinely separate storage account from the one another repo
already uses in the same resource group (`funjiblytfstate`) - Terraform's
azurerm backend addresses state as storage account → container → blob
key, so reusing the existing account with just a new container/key would
have worked equally well; a second account was chosen here for harder
isolation (its own access policy, independent of whatever the other
project's state storage needs).

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

- **Why `terraform apply` doesn't run in CI**: state is remote now, so CI
  *can* see real state - but `sp-backstage-deploy` only has the read-only
  **Storage Blob Data Reader** role on the state storage account (see
  State above), not Contributor. It can `plan` (with `-lock=false`, since
  Reader can't take the write lock a normal plan acquires) but has no
  write/lock access to actually apply anything, even if a step were added.
  That's an enforced RBAC boundary now, not just an omitted workflow step -
  upgrading that role is a prerequisite before CI could ever apply.
  `terraform apply` stays a manual step you run from this directory for
  infra-only changes (CPU/memory, scaling, ingress, etc).
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

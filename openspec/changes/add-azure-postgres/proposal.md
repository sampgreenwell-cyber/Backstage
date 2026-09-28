# Proposal

## Why

Production Backstage is down: its database is a free-tier Neon Postgres instance that has exhausted its monthly compute allowance, so Neon has suspended the compute and every `DATABASE_URL` connection fails. Moving to Azure Database for PostgreSQL Flexible Server on the Burstable B1ms tier — the cheapest workable managed Postgres in Azure — puts the database next to the Container App, under the same Terraform module and subscription, with no monthly usage cutoff.

## What Changes

- Add an Azure Database for PostgreSQL Flexible Server (Burstable `B_Standard_B1ms`, PostgreSQL 16, 32 GB storage, auto-grow off, 7-day backup retention, no HA, no geo-redundant backup) to `infra/terraform/azure-container-apps/`, in `rg-backstage` but in region **`eastus2`**. Azure returns "Provisioning is restricted in this region" for Flexible Server in `eastus` on this subscription, so the server's region is a separate `postgres_location` variable. The Container App stays in `eastus`.
- Generate the server's admin password with `random_password` (same pattern as `backend_auth_secret`) and expose it, plus the server FQDN, as `terraform output`s.
- Add a firewall rule allowing Azure services (so the Container App can connect over the server's public endpoint with SSL).
- Manually repoint the live Container App's `database-url` secret at the new server (not via Terraform — the `secret`/`env` `ignore_changes` guard stays untouched).
- Start with a fresh, empty database; Backstage creates its per-plugin databases and re-ingests the catalog from `catalog.locations` on startup.
- Update the module README with the new resources, the connection-string format, and the manual cut-over steps.

**Not a breaking change for app code**: the app still reads `DATABASE_URL`; only its value changes. Data in Neon (user settings, scaffolder history, UI-registered entities) is **not** carried over.

### Out of scope

- Migrating data from Neon (impossible while Neon's compute is suspended; can be done manually later with `pg_dump` after Neon's reset if wanted)
- Private networking (VNet integration / private endpoints)
- High availability, geo-redundant backups, read replicas
- Microsoft Entra ID (AAD) authentication for Postgres
- Backstage app code changes, or `app-config.production.yaml` changes beyond SSL settings if strictly needed
- Deleting the Neon project

## Outcome

1. The live Container App's `DATABASE_URL` points at the Azure Flexible Server (B1ms); Backstage starts, loads the catalog, and GitHub sign-in works.
2. The server is defined in Terraform in `rg-backstage`; `plan` → `apply` → `plan` ends with no changes.
3. The database is fresh — no data is migrated from Neon.

## Capabilities

### New Capabilities
- `production-database`: The managed PostgreSQL database backing production Backstage — how it is provisioned (Terraform, cheapest tier), secured (SSL, firewall, generated credentials), and connected to the Container App (manually set `DATABASE_URL`).

### Modified Capabilities
_None — no existing specs in `openspec/specs/`._

## Impact

- **Code**: `infra/terraform/azure-container-apps/{main.tf,variables.tf,outputs.tf,README.md}`. No changes to `packages/`, `plugins/`, or `versions.tf` providers.
- **Infrastructure**: new `azurerm_postgresql_flexible_server` + firewall rule + `random_password` in `rg-backstage` (~$15–20/month, to be verified). Container App gets a new revision when its `database-url` secret is updated.
- **CI**: `.github/workflows/deploy.yml`'s `terraform plan` will show the new resources until the manual apply, and afterwards must be able to *read* the server during refresh — depends on `sp-backstage-deploy`'s (unverified) role on `rg-backstage`.
- **Data**: Neon data is abandoned for now (not deleted).

## Stop Points

During implementation, stop and ask the user before continuing when any of these is reached:

1. Before any `terraform apply` — show the plan output and wait. `apply` is the user's manual step; do not run it without explicit instruction.
2. If a plan shows any **change** or **destroy** on existing resources.
3. Before touching the Container App's `secret`/`env` or its `ignore_changes` block in Terraform.
4. Before running any state-changing `az` command (firewall rule add/remove, `az containerapp secret set`, revision restart) — show the exact command first.
5. Before adding a Terraform provider or bumping provider versions.
6. If B1ms or PostgreSQL 16 is unavailable in `eastus`, or pricing is materially above ~$20/month — before choosing a different SKU, version, or region.
7. When requirements conflict (e.g. README guidance vs. what the plan needs).

## Open Questions

- ~~CI service principal role~~: resolved. `sp-backstage-deploy` has Contributor on `rg-backstage`, so it can read the server during plan refresh.
- ~~Region~~: resolved. `eastus` is restricted for Flexible Server on this subscription, and the user chose `eastus2` for the database only.
- **Exact current pricing** for B1ms + 32 GB storage + backup in `eastus` — to be confirmed before apply.

# Design

## Context

See proposal.md — Why. Current state relevant to the approach:

- `app-config.production.yaml` sets `backend.database` to `client: pg`, `connection: ${DATABASE_URL}`, with no `ssl` block and no `pluginDivisionMode` override. Backstage therefore uses its default per-plugin database mode: on startup it creates one database per plugin (`backstage_plugin_catalog`, `backstage_plugin_scaffolder`, …), which needs a role with `CREATEDB`.
- `packages/backend/src/index.ts` installs `plugin-search-backend-module-pg`, which uses Postgres's built-in full-text search — no server extensions need allow-listing.
- `infra/terraform/azure-container-apps/main.tf` has no database resources. It already uses `random_password.backend_auth_secret`, exposed as a sensitive output, for a secret the operator sets manually. The Container App's `lifecycle.ignore_changes` covers `secret`, `env`, `image`, and the probes; the README forbids lifting that guard.
- Providers are `azurerm ~> 5.0` and `random ~> 3.0` (`versions.tf`). State is remote in `backstagetf`. CI runs `init`/`validate`/`plan -lock=false` as `sp-backstage-deploy` and never applies.
- The live app is currently down (Neon compute suspended), so cut-over speed matters more than zero-downtime choreography.

Constraints (from the interview): additive-only plan; no Terraform writes to the Container App's `secret`/`env`; cheapest tier (B1ms, 32 GB, no auto-grow, 7-day backups, no HA or geo-backup); TLS stays enforced; PostgreSQL 16; CI plan stays green with existing SP permissions; no new providers.

## Goals / Non-Goals

**Goals:**
- Add the Flexible Server and its firewall rule to the existing module with the fewest resources possible.
- Give the operator everything needed to build `DATABASE_URL` from `terraform output`.
- Document a manual, repeatable cut-over that fits the module's "Terraform provisions, human sets secrets" model.

**Non-Goals:**
- Managing `DATABASE_URL` through Terraform, or any Key Vault integration.
- Tuning Backstage connection pooling up front (see Risks — handled only if observed).
- Creating databases or roles inside Postgres through Terraform (Backstage creates its own).

## Decisions

### D1. Resources: `azurerm_postgresql_flexible_server` + one firewall rule + generated credentials
Add to `main.tf`:
- `random_password.postgres_admin`: `length = 32`, `special = false`. Alphanumeric-only avoids percent-encoding in the `postgresql://` URL, and 32 alphanumeric characters is still strong enough.
- `random_string.postgres_suffix`: short lowercase suffix. Flexible Server names are globally unique DNS labels (`<name>.postgres.database.azure.com`), so a bare `psql-backstage` risks colliding with someone else's server. The name becomes `psql-${var.app_name}-${suffix}`.
- `azurerm_postgresql_flexible_server.backstage`: `sku_name = "B_Standard_B1ms"`, `version = "16"`, `storage_mb = 32768`, `auto_grow_enabled = false`, `backup_retention_days = 7`, `geo_redundant_backup_enabled = false`, no `high_availability` block, `public_network_access_enabled = true`, password authentication on and Entra ID auth off, `administrator_login = "backstageadmin"` (Azure reserves `admin`, `postgres`, etc.), `tags = var.tags`.
- `azurerm_postgresql_flexible_server_firewall_rule.allow_azure_services`: `0.0.0.0`–`0.0.0.0`, Azure's convention for "allow Azure services".

Exact attribute names must be checked against the **azurerm 5.x** provider docs during implementation (several arguments were renamed across 3.x → 4.x → 5.x). If the docs disagree with this list, follow the docs and don't change provider versions.

*Alternatives considered*: `azurerm_postgresql_server` (Single Server) is retired. A Terraform-managed `azurerm_postgresql_flexible_server_database` is unnecessary because Backstage creates its own databases. A non-admin application role would need a Postgres provider (a new dependency, excluded by the no-new-providers constraint), so Backstage connects as the admin login.

### D1a. Database region is `eastus2`, separate from the Container App
`az postgres flexible-server list-skus --location eastus` returns "Provisioning is restricted in this region" and no SKUs for this subscription. `eastus2`, centralus, westus2, and others offer B1ms + v16. Add a `postgres_location` variable (default `"eastus2"`) and set the server's `location` from it instead of the resource group's location. The server stays in `rg-backstage`, since a resource group can hold resources in several regions.

*Alternatives considered*: a support request to lift the eastus restriction takes days while the app is down. Moving the whole deployment to another region means recreating the Container App and its environment, which breaks the additive-only constraint. eastus2 is the closest region with capacity (both are in Virginia).

### D2. `zone` is ignored after create
Azure picks an availability zone when none is specified, and later plans then show drift on `zone`. Add `lifecycle { ignore_changes = [zone] }` on the server so `plan → apply → plan` converges (spec: "Terraform converges"). This is a new `ignore_changes` on a new resource, not the Container App's guard.

### D3. Network: public endpoint + "Allow Azure services" rule
The Consumption-plan Container Apps environment has no guaranteed static outbound IP, and private networking is out of scope. So the cheapest way to let the app connect is the "Allow Azure services" rule. **Trade-off**: this admits connections from any Azure-hosted source, not only this subscription. Mitigations are enforced TLS, a 32-character generated password, and a non-default admin name. Operator workstation access is a temporary `az postgres flexible-server firewall-rule create` rule, deleted after verification and never added to Terraform, so Terraform doesn't drift or delete it by surprise.

### D4. Connection string and TLS
`DATABASE_URL = postgresql://backstageadmin:<password>@<fqdn>:5432/postgres?sslmode=verify-full`. The server keeps its default `require_secure_transport = ON`. The Azure server certificate chains to a public root CA already trusted by Node, so no `ssl.ca` block or `app-config.production.yaml` change is expected. Connecting to the `postgres` maintenance database is only for bootstrapping; Backstage creates and uses its own `backstage_plugin_*` databases. `verify-full` rather than `require`: node-postgres currently treats `require` as `verify-full` but warns it will drop to libpq semantics (encrypt without verifying the certificate) in pg v9, so the stricter mode is pinned explicitly. Verified working against the server during the smoke test.

### D5. Outputs
Add `postgres_server_fqdn` (non-sensitive), `postgres_admin_login` (non-sensitive), and `postgres_admin_password` (sensitive) to `outputs.tf`. Don't add a composed `database_url` output: the value would duplicate the password in another output, and the README pattern is for the operator to assemble secrets and set them by hand.

### D6. Cut-over is manual, following the README
`az containerapp secret set -n backstage -g rg-backstage --secrets database-url=<url>` then restart or activate a revision. This matches how `DATABASE_URL` is managed today. Terraform never touches the Container App.

## Risks / Trade-offs

- **[B1ms connection limit]** B1ms allows a small `max_connections` (≈50, some reserved). Backstage opens a knex pool **per plugin database**, and about 10 plugins are installed, so under load the total could approach that limit. → Watch for `too many connections` / `remaining connection slots are reserved` in the logs during verification. If it appears, **stop and ask** before capping pools (`backend.database.knexConfig.pool.max`) in `app-config.production.yaml`, since that is outside the agreed boundary.
- **[Cross-region app ↔ database]** The Container App (eastus) and database (eastus2) are in different regions, which adds a few milliseconds per round trip and a small inter-region data-transfer charge. → Accepted: Backstage's DB traffic is light, and both regions are in the same metro area.
- **[Burstable CPU credits]** B1ms throttles once CPU credits run out, for example during a large catalog ingestion right after first boot. → Acceptable for this workload. Startup may be slower the first time.
- **[CI SP lacks read on the server]** If `sp-backstage-deploy` can't read `Microsoft.DBforPostgreSQL/flexibleServers`, the CI plan refresh fails after apply. → Check the role assignment before apply. If it's insufficient, stop and ask (granting RBAC is a user decision).
- **[Allow-Azure-services exposure]** See D3.
- **[SKU/version unavailable in eastus]** → Run `az postgres flexible-server list-skus --location eastus` before apply. If B1ms or version 16 is missing, stop and ask.
- **[Data loss vs. Neon]** User settings, scaffolder history, and UI-registered entities are not carried over. → Accepted. They can be dumped from Neon after its reset if wanted.

## Migration Plan

1. Implement the Terraform changes; `terraform fmt -check`, `validate`, `plan`, and confirm the plan is additive only (**stop point** before apply).
2. User runs `terraform apply` (about 5–10 minutes to provision).
3. `terraform plan` → no changes.
4. Temporary firewall rule for the operator IP → `psql` smoke test → delete the rule (**stop point** before each `az` write).
5. `az containerapp secret set` for `database-url` → new revision (**stop point**).
6. Verify revision health, logs, `backstage_plugin_*` databases, sign-in, and catalog.
7. Push → confirm the CI `Terraform plan` job is green.

**Rollback**: repoint `database-url` back to the Neon URL once Neon's compute allowance resets (the app is down until then either way), then `terraform destroy -target` the Postgres resources, or revert the commit and apply. The Container App is never changed by Terraform, so rollback doesn't touch it beyond the secret.

## Open Questions

- Current eastus price for B1ms + 32 GB + backup. Confirm before apply; it only matters if it's materially above ~$20/month (stop point).

# Tasks

## 0. Guardrails

- [x] 0.1 Re-read the Stop Points in proposal.md and treat each as a hard stop; verify by listing them back to the user before starting section 1

## 1. Pre-flight checks (read-only)

- [x] 1.1 Confirm B1ms and PostgreSQL 16 are available in the database region via `az postgres flexible-server list-skus --location eastus2` (look for `Standard_B1ms` under Burstable, with 16 in supported versions); if either is missing, stop (Stop Point 6) — **Result: eastus restricted; user chose eastus2 (B1ms + v16 available)**
- [x] 1.2 Look up current eastus2 pricing for B1ms + 32 GB storage + 7-day backup and record it in the README; if it's materially above ~$20/month, stop (Stop Point 6) — **Result: ~$16.09/mo (B1ms $0.017/hr ≈ $12.41 + 32 GB × $0.115 ≈ $3.68; backup free up to provisioned size)**
- [x] 1.3 Check `sp-backstage-deploy`'s role assignments (`az ad sp list --display-name sp-backstage-deploy` → `az role assignment list --assignee <appId> --all -o table`) and record whether it has read on `rg-backstage`; if not, stop and ask before apply (RBAC change is the user's call) — **Result: Contributor on rg-backstage (read OK)**
- [x] 1.4 Check the azurerm 5.x docs for `azurerm_postgresql_flexible_server` and `azurerm_postgresql_flexible_server_firewall_rule` and note any argument names that differ from design.md D1 — **Result: azurerm 5.3.0 schema matches D1; no differences**

## 2. Terraform changes

- [x] 2.1 Add `random_password.postgres_admin` (32 chars, `special = false`) and `random_string.postgres_suffix` (lowercase, no special) to `main.tf`, with a comment explaining the pattern (like `backend_auth_secret`) and the global-uniqueness reason for the suffix; verify with `terraform validate`
- [x] 2.2 Add `azurerm_postgresql_flexible_server.backstage` per design.md D1 (B_Standard_B1ms, v16, 32768 MB, auto-grow off, 7-day backups, no geo-backup, no HA, public access, password auth, admin `backstageadmin`, `tags = var.tags`) plus `lifecycle { ignore_changes = [zone] }` (D2); verify with `terraform validate`
- [x] 2.3 Add `azurerm_postgresql_flexible_server_firewall_rule.allow_azure_services` (0.0.0.0–0.0.0.0) with a comment on the trade-off (D3); verify with `terraform validate`
- [x] 2.4 Add a `postgres_location` variable (default `eastus2`, design.md D1a), plus other variables only if needed to avoid hardcoding (e.g. `postgres_sku_name`, `postgres_version`, `postgres_storage_mb`) with the cheapest-tier defaults; verify `terraform validate` passes and defaults match design.md
- [x] 2.5 Add outputs `postgres_server_fqdn`, `postgres_admin_login`, `postgres_admin_password` (sensitive) to `outputs.tf`; verify `terraform validate` passes
- [x] 2.6 Confirm the Container App resource and its `ignore_changes` block are byte-for-byte unchanged via `git diff infra/terraform/azure-container-apps/main.tf` (Stop Point 3 if any change seems needed)
- [x] 2.7 Run `terraform fmt -check` and `terraform validate` in `infra/terraform/azure-container-apps`; both must pass

## 3. Documentation

- [x] 3.1 Update `infra/terraform/azure-container-apps/README.md`: "What this creates" (Flexible Server + firewall rule), the connection-string format with `?sslmode=require`, how to get values from `terraform output`, the temporary-IP-rule procedure, the cut-over command, the B1ms connection-limit note, and the pricing from 1.2; verify by reading it back against design.md D3–D6
- [x] 3.2 Update the Deployment paragraph in `CLAUDE.md` to mention that the module now provisions the Postgres Flexible Server (and that `DATABASE_URL` is still set manually); verify with `yarn prettier:check` — **Note: CLAUDE.md and README.md already failed prettier at HEAD; not reformatted here**

## 4. Plan and apply (user-gated)

- [x] 4.1 Run `terraform plan -out=tfplan` and confirm the summary is additions only, `0 to change, 0 to destroy`; show the plan to the user and STOP (Stop Points 1 and 2) — **Result: 4 to add, 0 to change, 0 to destroy**
- [x] 4.2 After the user runs `terraform apply tfplan`, run `terraform plan` and confirm `No changes` — **Result: No changes (exit 0)**
- [x] 4.3 Run `az postgres flexible-server show -g rg-backstage -n <name>` and confirm `Standard_B1ms`, `Burstable`, version 16, 32 GB storage, HA disabled, geo-redundant backup disabled — **Result: all match; server psql-backstage-gnuf2e, Ready, require_secure_transport=on, max_connections=50**

## 5. Connectivity smoke test (temporary access)

- [x] 5.1 Show the user, then (with approval) run `az postgres flexible-server firewall-rule create` for the operator's current public IP with a name like `tmp-operator-verify` (Stop Point 4) — **Done (136.62.10.81)**
- [x] 5.2 Run `psql "<DATABASE_URL>" -c "select version();"` and confirm PostgreSQL 16; run it again with `sslmode=disable` and confirm the connection is rejected — **Result: PG 16.15, ssl=on, cert verified; sslmode=disable rejected ("no encryption"). psql not installed, used a Node script with the repo's pg package**
- [x] 5.3 Show the user, then (with approval) delete the temporary rule; confirm `az postgres flexible-server firewall-rule list` shows only the Azure-services rule and `terraform plan` reports no changes — **Result: only AllowAzureServices remains; plan No changes**

## 6. Cut-over

- [x] 6.1 Build `DATABASE_URL` from `terraform output` (`postgresql://backstageadmin:<pw>@<fqdn>:5432/postgres?sslmode=verify-full`); show the user the exact `az containerapp secret set -n backstage -g rg-backstage --secrets database-url=...` command (password redacted) plus the revision restart command and STOP for approval (Stop Point 4) — **Done: DATABASE_URL was a plain env var (Neon URL), not a secret ref; created `database-url` secret and ran `az containerapp update --set-env-vars DATABASE_URL=secretref:database-url` (revision 0000042). README updated to match**
- [x] 6.2 After the secret is updated, confirm the new revision is Running/Healthy with `az containerapp revision list -n backstage -g rg-backstage -o table` — **Result: backstage--0000042 Healthy, RunningAtMaxScale, 100% traffic; readiness endpoint {"status":"ok"}**
- [x] 6.3 Check `az containerapp logs show -n backstage -g rg-backstage --tail 200` for no DB connection errors; if `too many connections` / `remaining connection slots are reserved` appears, stop and ask about capping knex pools (Stop Point 7) — **Result: all plugins initialized, no DB/SSL/connection-limit errors**
- [x] 6.4 Confirm `backstage_plugin_*` databases exist (via `psql ... -c "\l"` with a temporary firewall rule, created and deleted with approval as in section 5) — **Result: verified via `az postgres flexible-server db list` (no firewall rule needed): 13 backstage_plugin_* databases (app, proxy, scaffolder, techdocs, auth, catalog, permission, search, kubernetes, user-settings, notifications, signals, mcp-actions)**
- [x] 6.5 Ask the user to open the production URL and confirm GitHub sign-in works and the catalog lists the example entities — **Result: user confirmed GitHub sign-in works and the sample catalog entity is listed**

## 7. CI

- [x] 7.1 After the changes are committed and pushed to `main` (user's call), confirm the `Terraform plan` job in `deploy.yml` is green; if refresh fails on the Postgres resources, report it as the SP-role open question and stop — **Result: run 36472553273 all green; plan refreshed the Postgres resources with no infrastructure changes (outputs-only: latest_revision_fqdn)**

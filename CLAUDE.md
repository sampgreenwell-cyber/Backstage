# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A [Backstage](https://backstage.io) developer portal app, scaffolded with the new frontend/backend systems (`@backstage/frontend-defaults` / `@backstage/backend-defaults`), plus a custom "Express.js Service" scaffolder golden-path template. It's a Yarn workspaces monorepo (`packages/*`, `plugins/*`), managed with Yarn 4 (Berry) via `.yarnrc.yml`'s `yarnPath` — always invoke `yarn` through Corepack/the committed release, not a globally installed Yarn.

## Commands

```sh
yarn install --immutable   # install deps (matches CI/Dockerfile)
yarn start                 # dev mode: frontend on :3000, backend on :7007 (sqlite, guest auth)
yarn start app             # dev mode, frontend package only
yarn start backend         # dev mode, backend package only

yarn tsc                   # typecheck the whole monorepo (incremental)
yarn tsc:full               # full typecheck, no incremental cache, no skipLibCheck

yarn lint                  # eslint, scoped to files changed since origin/master
yarn lint:all               # eslint, whole repo
yarn fix                   # backstage-cli repo fix (auto-fixes lint issues)
yarn prettier:check         # prettier --check .

yarn test                  # jest, whole repo (backstage-cli repo test)
yarn test:all                # jest with coverage
yarn test:e2e               # playwright e2e (spins up frontend+backend unless CI=1)
```

Running a single test: `backstage-cli repo test` wraps Jest, so pass a path/pattern through, e.g. `yarn test packages/app/src/App.test.tsx`, or scope to one workspace with `yarn workspace app test`. Playwright e2e specs live per-package (`e2e-tests/`) and are auto-discovered by `generateProjects()` in `playwright.config.ts`.

Building the backend for deployment (order matters — each step depends on the last):
```sh
yarn build:backend          # yarn workspace backend build -> packages/backend/dist/{bundle,skeleton}.tar.gz
docker build . -f packages/backend/Dockerfile --tag backstage   # context must be repo root
# or: yarn build-image
```
The Docker build's host build steps (`yarn install`, `yarn build:backend`) must run on the **same Node major version** as the Dockerfile's `FROM node:24-trixie-slim` — currently Node 24. Mismatched versions break native modules (`better-sqlite3`, etc).

## Architecture

**Frontend (`packages/app`)** uses the new frontend system: `App.tsx` calls `createApp({ features: [...] })`. Custom behavior is added as frontend modules under `src/modules/` (e.g. `modules/nav` overrides the sidebar via `createFrontendModule`, `modules/home` configures the home page) rather than by editing a monolithic root component.

**Backend (`packages/backend`)** uses the new backend system: `src/index.ts` calls `createBackend()` and wires in plugins with `backend.add(import('@backstage/plugin-...'))`. To add/remove backend capability, add/remove an import here — there's no other backend routing/wiring file. Installed backend plugins: app, proxy, scaffolder (+ GitHub module + notifications module), techdocs, auth (+ guest provider), catalog (+ scaffolder-entity-model, logs), permission (+ allow-all policy), search (+ pg engine, catalog/techdocs collators), kubernetes, user-settings, notifications, signals, mcp-actions.

**`plugins/`** is currently empty (placeholder) — this is where custom Backstage plugins (as opposed to installed `@backstage/*` ones) would live if/when added.

**Config layering**: `app-config.yaml` (checked into git, dev defaults — sqlite, guest auth, `localhost` URLs) is merged with `app-config.production.yaml` at runtime, production values overriding. Production config uses `${VAR}` substitution for everything environment-specific: `DATABASE_URL` (Postgres connection string), `APP_BASE_URL` (public URL, computed automatically by Terraform — see below, not something to hardcode), `BACKEND_AUTH_SECRET` (service-to-service auth signing key — note this is a *different* env var name than dev's `app-config.yaml` uses for the same config key, `BACKEND_SECRET`). Both `DATABASE_URL` and `BACKEND_AUTH_SECRET` are set as Container App secrets directly in Azure, never through Terraform or checked-in config — see `infra/terraform/azure-container-apps/README.md`.

**Catalog & scaffolder seed data (`examples/`)**: `entities.yaml`/`org.yaml` are example catalog data, `examples/template/` is a generic example template, `examples/express-template/` is a real golden-path template ("Express.js Service") that scaffolds a new Express service with a `skeleton/` (including its own `Dockerfile`), publishes it to a new GitHub repo, and registers it in the catalog. All are registered as `catalog.locations` in `app-config.yaml`.

**Deployment (`infra/terraform/azure-container-apps/`)**: Terraform module deploying the backend image to Azure Container Apps. Uses local state and deliberately does **not** manage `DATABASE_URL`/`BACKEND_AUTH_SECRET` (set manually in Azure) to avoid clobbering them — read that directory's README before changing anything touching the Container App's `secret`/`env` lists; Azure treats both as full-replacement lists, and a naive Terraform change can silently delete a manually-added secret. `.github/workflows/deploy.yml` builds the image and pushes it to GHCR (`ghcr.io/<owner>/backstage`) and runs `terraform plan` for visibility on push/PR to `main`; it does not `terraform apply` (local state isn't safe to apply from ephemeral CI runners).

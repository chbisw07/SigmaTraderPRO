# ML1 Sprint 1 Implementation Notes

## S1.1 Repo + Workspace Foundation

### Completed
- Created monorepo root structure
- Initialized git repository
- Added foundational config files
- Established implementation notes discipline
- Created first stable commit checkpoint

### Important highlights
- Repository root finalized
- apps/packages split reserved for future milestones
- docs discipline aligned with sprint v3 ODS
- safe rollback baseline available

### Next
- S1.2 backend bootstrap
- S1.3 frontend shell

---

## S1.2 Postgres + Redis + Persistence Bootstrap

### Completed
- Added Docker Compose infra for PostgreSQL 16 + Redis 7 with named volumes and healthchecks
- Created FastAPI backend skeleton with config/env discipline
- Added SQLAlchemy engine + session factory and Redis client wiring
- Implemented `/health` and `/health/ready` (readiness checks Postgres + Redis, degrades gracefully)
- Scaffolded Alembic with a baseline (empty) migration for future schema evolution

### Important highlights
- Infra is Docker-only; backend is intended to run locally on host during development
- `.env.example` standardizes local dev defaults for DB and Redis URLs
- Readiness endpoint returns `503` when dependencies are unavailable, without crashing the app

### Next
- S1.3 frontend shell
- S1.4 auth bootstrap (depends on persistence + readiness foundation)

---

## S1.3 Frontend App Bootstrap

### Completed
- Initialized `apps/frontend` as a Vite + React + TypeScript app
- Added Tailwind CSS and a minimal shadcn/ui foundation (CSS variables + `cn()` + baseline `Button`)
- Wired React Router with placeholder routes/pages: Dashboard, Brokers, Strategies, Positions, Orders, Settings
- Added Zustand (minimal UI store) and TanStack Query (QueryClientProvider)
- Implemented a minimal app shell (sidebar + header + main outlet)
- Added Vitest smoke render test and verified `lint`, `test`, and `build` are clean

### Important highlights
- Frontend remains host-run for development; no backend API integration yet
- Routing is placeholder-only (no auth, no protected routes, no redirects)
- Structure aligned for future feature slices: `src/app`, `src/routes`, `src/pages`, `src/components`, `src/store`

### Next
- S1.4 auth bootstrap (backend + frontend wiring later; not in S1.3)

#### S1.3 Follow-up — Appearance + Themes + Shell Polish
_Bounded foundation refinement (no new milestone features)._

- Added appearance settings with local theme persistence (Zustand + localStorage)
- Established a multi-theme token system via CSS variables (`data-theme` + `dark` class)
- Introduced theme options: `system`, `light`, `light-soft`, `dark`, `dark-trading`
- Polished sidebar (active highlight, density, branding) and header (page title, dev badge, theme control)

---

## S1.4 Quality + Developer Tooling Baseline

### Completed
- Added backend Python quality baseline with Ruff (lint + format) and Pytest
- Added backend test structure with passing smoke tests for `/health` and `/health/ready` (graceful when dependencies are unavailable)
- Added repo-level `Makefile` commands for infra, backend, frontend, and aggregate quality gates
- Added lightweight pre-commit baseline (Ruff + basic hygiene hooks)
- Documented local developer workflow and quality commands in `README.md`

### Important highlights
- Tooling is intentionally minimal and host-run; no CI introduced in S1.4
- Ruff is the single source of truth for backend lint + formatting
- `make check` provides a stable “run the quality gates” entrypoint for future work

### Next
- S1.5+ implement feature slices with consistent `make check` cadence

---

## S1.5 Logging/Config Bootstrap

### Completed
- Expanded backend settings to include logging + audit configuration (env-driven with safe local defaults)
- Added structured JSON logger baseline (stdlib `logging`) with a shared logger helper
- Added sanitization helpers and enforced redaction of sensitive keys (password/token/secret/api_key/refresh_token/access_token)
- Added CSV audit logger skeleton with frozen PRD naming baseline (`ST_YYYYMMDD.csv`, `ST_YYYYMMDD_02.csv`) and safe directory creation
- Added safe startup diagnostics log event (no secrets, no raw DB URLs) and kept existing health endpoints unchanged
- Added focused tests for config load, logger init, sanitization, and CSV audit writer

### Important highlights
- Structured logs are the engineering truth; CSV audit files are the operator convenience layer (frozen PRD convention)
- Startup diagnostics intentionally log “configured yes/no” for DB/Redis rather than connection details or secrets
- CSV audit rotation-by-size is supported at a minimal baseline level; no business event coupling yet

### Next
- Introduce correlation IDs across request flows (future S2+/S5 workstream)
- Expand CSV audit usage for webhook/order lifecycle once domain features begin

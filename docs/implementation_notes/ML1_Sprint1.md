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

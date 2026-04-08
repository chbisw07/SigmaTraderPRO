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

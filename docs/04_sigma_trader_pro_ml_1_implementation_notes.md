# SigmaTraderPRO — ML1 Implementation Notes

**Purpose:** Living implementation memory for Milestone-1 execution  
**Audience:** You, developers, Codex, QA, architecture review  
**Rule:** Every completed sub-task must append a concise implementation summary here before being marked fully done.

---

# How to use this document
For each completed sprint sub-task:
- add a dated entry
- mention the sub-task id (for example `S3.1`)
- summarize what was *actually* implemented
- mention key files/modules added or changed
- mention tests and quality gates executed
- capture deviations, caveats, and follow-up TODOs

This document is the **single milestone-level implementation memory artifact** for ML1.

---

# Template Entry Format
## [DATE] — Sprint X / SX.Y — <Sub-task Title>
### Implemented
-
-

### Files / Modules
-
-

### API / DB / UI Changes
-
-

### Tests / Quality Gates
- ruff:
- tests:
- smoke checks:

### Notes / Deviations
-

### Follow-up TODOs
-

---

# Entries

## 2026-04-09 — Sprint 1 / S1.5 — Logging/config bootstrap
### Implemented
- Backend settings expanded with env-driven logging + audit settings (safe local defaults)
- Structured JSON logging baseline (stdlib `logging`) with startup diagnostics
- Shared sanitization helpers to prevent secret leakage in logs and CSV audit
- CSV operational audit logger skeleton with frozen PRD naming convention baseline

### Files / Modules
- `apps/backend/app/core/config.py`
- `apps/backend/app/core/logger.py`
- `apps/backend/app/core/sanitization.py`
- `apps/backend/app/core/csv_audit.py`
- `apps/backend/app/core/diagnostics.py`
- `apps/backend/app/main.py`
- `apps/backend/tests/test_config_and_logging.py`

### API / DB / UI Changes
- API: added startup log event only (no endpoint changes)
- DB: none
- UI: none

### Tests / Quality Gates
- ruff: `make backend-lint`
- tests: `make backend-test`
- smoke checks: `make check`

### Notes / Deviations
- Startup logs intentionally avoid raw DB URLs and any secret-bearing fields.

### Follow-up TODOs
- Introduce request correlation IDs and propagate into structured logs + CSV audit entries.

## 2026-04-09 — Sprint 2 / S2.1 — Auth backend + schema
### Implemented
- `users` table schema + Alembic migration (`last_used_broker` preference included)
- JWT access + refresh token issuance (`/api/v1/auth/login`, `/api/v1/auth/refresh`)
- Minimal registration endpoint (`/api/v1/auth/register`) for local/dev bootstrap
- Protected identity endpoint (`/api/v1/auth/me`) and minimal preferences update endpoint
- Password hashing via Passlib (bcrypt) and token validation dependency for future protected routes

### Files / Modules
- `apps/backend/app/models/user.py`
- `apps/backend/app/core/security.py`
- `apps/backend/app/api/deps.py`
- `apps/backend/app/api/v1/auth.py`
- `apps/backend/app/api/v1/router.py`
- `apps/backend/app/schemas/auth.py`
- `apps/backend/app/schemas/user.py`
- `apps/backend/app/services/auth_service.py`
- `apps/backend/alembic/versions/0002_create_users.py`
- `apps/backend/tests/test_auth_flow.py`
- `apps/backend/tests/test_migrations.py`

### API / DB / UI Changes
- API: added `/api/v1/auth/*` endpoints
- DB: added `users` table
- UI: none (frontend auth is explicitly deferred)

### Tests / Quality Gates
- ruff: `make backend-lint`
- tests: `make backend-test`
- smoke checks: `make check`

### Notes / Deviations
- Refresh tokens are stateless in S2.1 (no revocation/blacklist store yet).

### Follow-up TODOs
- Add refresh token persistence / revocation only if/when required by product/security posture.

## 2026-04-09 — Sprint 2 / S2.2 — Frontend shell + status bar
### Implemented
- Login page (`/login`) wired to backend JWT login
- Protected routing + auth-aware redirects (unauthenticated → login; authenticated → workspace)
- Zustand auth store with local persistence (access/refresh + user identity) and bootstrap refresh handling
- Auth-aware header (user menu + logout) integrated into the existing S1.3 shell
- Persistent status bar scaffold wired to backend `/health` and frontend auth state

### Files / Modules
- `apps/frontend/src/pages/LoginPage.tsx`
- `apps/frontend/src/store/authStore.ts`
- `apps/frontend/src/lib/api/client.ts`
- `apps/frontend/src/lib/api/auth.ts`
- `apps/frontend/src/routes/router.tsx`
- `apps/frontend/src/routes/RequireAuth.tsx`
- `apps/frontend/src/components/shell/UserMenu.tsx`
- `apps/frontend/src/components/status/StatusBar.tsx`
- `apps/frontend/src/test/smoke.test.tsx`

### API / DB / UI Changes
- API: frontend now consumes `/api/v1/auth/login`, `/api/v1/auth/refresh`, `/api/v1/auth/me` and `/health`
- DB: none (auth schema lives in S2.1)
- UI: added login screen, protected shell routing, status bar baseline, and user menu logout

### Tests / Quality Gates
- ruff: `make backend-lint` (no backend changes required)
- tests: `make frontend-test`
- smoke checks: `make frontend-build`, `make check`

### Notes / Deviations
- Registration UI remains intentionally deferred; local/dev bootstrap uses backend `POST /api/v1/auth/register`.

### Follow-up TODOs
- Add a small “refresh-on-401” retry helper once protected API slices (brokers/orders/etc.) begin.

## 2026-04-09 — Sprint 3 / S3.1 — Broker adapter interface + Angel auth
### Implemented
- Broker-agnostic adapter contract (`BrokerAdapter`) + stable broker status model/state semantics
- Persisted per-user broker connection state in `broker_connections` (credentials + session tokens stored encrypted)
- Angel One adapter implementing settings, connect/reconnect, disconnect, and status behind the adapter boundary
- Daily-session validity model: sessions are valid “for today”; status flips to `stale` the next day
- Versioned broker endpoints under `/api/v1/brokers/...` (auth-required)

### Files / Modules
- `apps/backend/app/brokers/base.py`
- `apps/backend/app/brokers/types.py`
- `apps/backend/app/brokers/angel_client.py`
- `apps/backend/app/brokers/angel_adapter.py`
- `apps/backend/app/models/broker_connection.py`
- `apps/backend/app/services/broker_service.py`
- `apps/backend/app/api/v1/brokers.py`
- `apps/backend/app/schemas/broker.py`
- `apps/backend/alembic/versions/0003_create_broker_connections.py`
- `apps/backend/tests/test_broker_angel.py`

### API / DB / UI Changes
- API: added `/api/v1/brokers/status` and Angel endpoints under `/api/v1/brokers/angel/...`
- DB: added `broker_connections` table
- UI: none (broker UI deferred)

### Tests / Quality Gates
- ruff: `make backend-lint`
- tests: `make backend-test`
- smoke checks: `make check`

### Notes / Deviations
- External Angel auth calls are isolated behind a small HTTP client; tests mock the connect boundary (no live broker dependency).
- Secrets are never logged; storage uses `BROKER_ENCRYPTION_KEY` for encryption-at-rest baseline.

### Follow-up TODOs
- Add callback/postback URL fields where required by specific brokers (Zerodha/Fyers) and surface in broker settings UI.

## 2026-04-09 — Sprint 3 / S3.x — Broker settings/login UI foundation (Zerodha + Angel)
### Implemented
- Added Zerodha adapter (Kite Connect request_token flow) under the broker adapter boundary
- Added authenticated Zerodha broker endpoints (`/api/v1/brokers/zerodha/...`) including `login-url`
- Implemented Brokers page UI for Angel + Zerodha settings and connect/reconnect actions (Fyers placeholder only)

### Files / Modules
- `apps/backend/app/brokers/zerodha_client.py`
- `apps/backend/app/brokers/zerodha_adapter.py`
- `apps/backend/app/schemas/broker.py`
- `apps/backend/app/api/v1/brokers.py`
- `apps/backend/app/services/broker_service.py`
- `apps/backend/tests/test_broker_zerodha.py`
- `apps/frontend/src/lib/api/brokers.ts`
- `apps/frontend/src/pages/BrokersPage.tsx`
- `apps/frontend/src/components/ui/input.tsx`
- `apps/frontend/src/components/ui/card.tsx`
- `apps/frontend/src/test/setup.ts`
- `apps/frontend/src/test/smoke.test.tsx`

### API / DB / UI Changes
- API: added Zerodha connect/settings/status endpoints and a `login-url` helper
- DB: reused `broker_connections` table (no new migration required)
- UI: Brokers page now supports real broker config + connect flows (no trading actions yet)

### Tests / Quality Gates
- ruff: `make backend-lint`
- tests: `make backend-test`, `make frontend-test`
- smoke checks: `make check`

### Notes / Deviations
- Zerodha connect uses request_token pasted from redirect URL (callback capture is intentionally deferred).

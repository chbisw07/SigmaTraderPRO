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

## 2026-04-09 — Sprint 3 / S3.2 — Canonical instrument registry backend
### Implemented
- Canonical enums introduced per frozen PRD: Exchange/Segment/InstrumentType/OptionType
- Canonical registry persistence added:
  - `instruments` table with stable `canonical_id`
  - `instrument_mappings` table storing broker resolution data (internal-only)
- Angel instrument normalization + idempotent ingest (repeat imports converge; no duplicate canonicals)
- Sync/import skeleton (`InstrumentSyncService.sync_angel_rows`) plus a small CLI helper
- Canonical-first search API (`/api/v1/instruments/search`, `/api/v1/instruments/{canonical_id}`) returning canonical objects only

### Files / Modules
- `apps/backend/app/instruments/types.py`
- `apps/backend/app/models/instrument.py`
- `apps/backend/app/models/instrument_mapping.py`
- `apps/backend/app/services/instrument_normalizer.py`
- `apps/backend/app/services/instrument_registry_service.py`
- `apps/backend/app/services/instrument_sync_service.py`
- `apps/backend/app/api/v1/instruments.py`
- `apps/backend/app/schemas/instrument.py`
- `apps/backend/alembic/versions/0004_create_instrument_registry.py`
- `apps/backend/tests/test_instruments_registry.py`
- `apps/backend/scripts/sync_angel_instruments.py`

### API / DB / UI Changes
- API: added `/api/v1/instruments/search` and `/api/v1/instruments/{canonical_id}` (auth-required)
- DB: added `instruments` + `instrument_mappings` tables
- UI: none (backend-first milestone)

### Tests / Quality Gates
- ruff: `make backend-lint`
- tests: `make backend-test`
- migration: `make backend-migrate`
- repo gates: `make check`

### Notes / Deviations
- Broker symbols/tokens are stored only as internal mapping data; search responses are canonical-first by design.

## 2026-04-09 — Sprint 4 / S4.1 — Stock order dialog (cash)
### Implemented
- Stock ticket UI launched from canonical Search results (cash instruments only)
- Preview-first order API:
  - `POST /api/v1/orders/preview`
  - `POST /api/v1/orders`
- Canonical → broker routing resolution behind the broker adapter boundary
- Angel + Zerodha cash order placement implemented in adapters (`place_equity_order`)
- Minimal order persistence via new `orders` table + Alembic migration `0005_create_orders`

### Notes / Deviations
- This milestone intentionally excludes SL/TP/TSL protective controls; they will be layered on with a shared ticket core in later milestones.

## 2026-04-10 — Sprint 4 / S4.2 — F&O order dialog (options + futures)
### Implemented
- F&O ticket UI added (options + futures) with preview-first workflow and lots-based quantity derivation
- New auth-required order endpoints:
  - `POST /api/v1/orders/fno/preview`
  - `POST /api/v1/orders/fno`
- Broker adapters extended to support derivatives dispatch (`place_derivative_order`) for Angel + Zerodha
- Deterministic Zerodha derivative mapping sync endpoint added for NFO underlyings:
  - `POST /api/v1/instruments/sync/zerodha-nfo`

### Files / Modules
- `apps/backend/app/orders/types.py`
- `apps/backend/app/services/order_service.py`
- `apps/backend/app/api/v1/orders.py`
- `apps/backend/app/models/order.py`
- `apps/backend/alembic/versions/0006_add_orders_lots.py`
- `apps/backend/app/services/instrument_normalizer.py`
- `apps/backend/app/services/instrument_sync_service.py`
- `apps/backend/app/api/v1/instruments.py`
- `apps/backend/app/schemas/instrument.py`
- `apps/backend/tests/test_orders_fno.py`
- `apps/frontend/src/features/orders/FnoOrderDialog.tsx`
- `apps/frontend/src/lib/api/orders.ts`
- `apps/frontend/src/lib/api/instruments.ts`
- `apps/frontend/src/pages/SearchPage.tsx`
- `apps/frontend/src/test/setup.ts`
- `apps/frontend/src/test/smoke.test.tsx`

### API / DB / UI Changes
- API: added F&O preview/create endpoints + Zerodha NFO mapping sync endpoint
- DB: `orders` table extended with nullable `lots` column (migration `0006_add_orders_lots`)
- UI: Search workspace now supports opening Stock or F&O tickets via `Trade` actions

### Tests / Quality Gates
- repo gates: `make check`

### Notes / Deviations
- SL/TP/TSL protective controls remain deferred (frozen PRD) to keep S4.2 bounded and reliable.

### Follow-up (UX correctness)
- Added contract-driven ticket prefill modes (`manual` vs `contract`) so Search → `Trade` opens prefilled tickets instead of blank/manual state.
- Implemented key-based ticket remounting to prevent stale dialog state when switching contracts.

## 2026-04-10 — Sprint 4 / S4.2.1A — Premium hydration + smart strike labeling
### Implemented
- Added a small UI-side quote cache (`premiumsByCanonicalId`, `spotsByUnderlying`) used for safe, non-blocking premium hydration
- F&O ticket now hydrates/prefills premium/limit price when a cached reference premium exists (selected row → cache → last preview)
- Strike selection is enriched with moneyness labels (`ATM/ITM/OTM`) and color-coded badges (CE/PE semantics tested)
- Strike discovery list shows moneyness labels for quick scanning; preview shows premium/outlay context when available

### Files / Modules
- `apps/frontend/src/store/quoteStore.ts`
- `apps/frontend/src/lib/moneyness.ts`
- `apps/frontend/src/features/orders/FnoOrderDialog.tsx`
- `apps/frontend/src/pages/SearchPage.tsx`
- `apps/frontend/src/test/smoke.test.tsx`
- `apps/frontend/src/lib/moneyness.test.ts`

### API / DB / UI Changes
- API: none (no live quote endpoint yet; hydration is cache-driven)
- DB: none
- UI: better F&O ticket defaults (premium) + moneyness labels/badges in strike selection and strike discovery

### Tests / Quality Gates
- frontend lint: `make frontend-lint`
- frontend tests: `make frontend-test`
- frontend build: `make frontend-build`

### Notes / Deviations
- Premium hydration currently uses cached values (selected row context and last preview premium). Live quotes are intentionally deferred until a dedicated backend quote endpoint exists.

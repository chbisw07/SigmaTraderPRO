# SigmaTraderPRO — Milestone 1 (ML1) Engineering Handoff Pack

**Status:** Frozen for implementation handoff  
**Audience:** Engineering, Codex, QA, Architecture Review  
**Depends on:** Frozen ML1 PRD

---

# 1) Objective of ML1
Deliver a **broker-terminal-grade web execution product** for:
- stocks + ETFs
- index & stock options (single-leg foundation)
- index & stock futures

with:
- multi-user auth
- Angel One first broker support
- canonical instrument normalization
- TradingView webhook ingestion
- stock + F&O order dialogs
- positions / orders / holdings
- system events + logging
- fail-fast dispatch gating
- CSV exports + trade lifecycle persistence

ML1 success means the product is **live-usable for professional personal execution workflows**.

---

# 2) Engineering Workstreams
## WS1 — Platform Foundation
### Backend
- FastAPI
- PostgreSQL
- Redis
- Alembic
- structured logging
- CSV operational logger

### Frontend
- React
- Vite
- TypeScript
- Tailwind
- shadcn/ui
- Zustand
- TanStack Query

### Deliverables
- monorepo or clean backend/frontend split
- Docker local environment
- env templates
- secrets bootstrap
- health endpoint
- OpenAPI baseline

---

## WS2 — Auth + Workspace Shell
### Backend
- JWT auth
- refresh tokens
- user profile preferences
- last-used broker persistence

### Frontend
- login
- protected routes
- **top navigation shell**
- persistent **status bar**
- user menu

### Acceptance
- login/logout works
- session refresh works
- stale auth redirects cleanly

---

## WS3 — Broker Layer (Angel One First)
### Deliverables
- broker adapter interface
- Angel One implementation
- daily session lifecycle
- broker settings page
- callback/postback URL support
- connection state badge
- stale session state

### Future-ready interfaces
- Zerodha adapter contract
- Fyers adapter contract

### Acceptance
- connect Angel successfully
- stale session visible next day
- reconnect works
- broker health visible in status bar

---

## WS4 — Canonical Instrument Registry
### Backend
- `instrument_registry`
- sync jobs
- canonical enums
- exchange/segment normalization
- futures + options expiry handling

### Frontend
- universal instrument search
- stock search
- F&O search
- option strike discovery

### Acceptance
- canonical notation rendered everywhere
- broker symbols never leak into normal UI

---

## WS5 — Order Execution Surface
### UI
#### Stock dialog
- last-used broker
- qty
- CNC/MIS
- market/limit
- SL/TP/TSL
- preview

#### F&O dialog
- underlying
- expiry
- strike
- CE/PE
- lots
- MIS/NRML
- SL/TP/TSL
- preview

### Backend
- order validation
- dispatch gating
- broker normalization
- correlation IDs
- fail-fast offline block

### Acceptance
- stock order can be placed
- option order can be placed
- futures order can be placed
- offline dispatch blocked visibly

---

## WS6 — Positions / Orders / Holdings
### Pages
- positions
- open orders
- trade history
- holdings

### Features
- live broker sync
- reconciliation baseline
- row quick actions
- exit / modify placeholders for M2 evolution

### Acceptance
- broker truth reflected after dispatch
- manual refresh + auto sync available

---

## WS7 — TradingView Webhook
### Deliverables
- `/webhook/tradingview`
- `{{strategy.order.alert_message}}` contract
- route token validation
- schema version validation
- idempotency
- canonical normalization
- broker dispatch

### Acceptance
- valid alert routes to intended user
- invalid token rejected
- duplicate deduped
- system event created

---

## WS8 — Observability + Audit
### Deliverables
- system events workspace
- structured logger
- daily CSV logger with rotation
- trade lifecycle CSV exports
- dispatch warnings
- auth warnings
- webhook diagnostics

### Acceptance
- events visible in UI
- CSV files rotate by date + size
- critical failures visible in status bar

---

# 3) State Machines to Implement
## Broker Session
- DISCONNECTED
- CONNECTED_TODAY
- STALE
- AUTH_FAILED

## Order Lifecycle
- CREATED
- PENDING_DISPATCH
- DISPATCH_BLOCKED
- BROKER_ACKNOWLEDGED
- OPEN
- FILLED
- REJECTED
- CANCELLED
- CLOSED

## Connectivity
- ONLINE
- DEGRADED
- OFFLINE

---

# 4) QA Acceptance Checklist
- user login works
- Angel broker connect works
- stale next-day session shown
- stock search works
- F&O strike search works
- stock order works
- option order works
- futures order works
- TradingView webhook works
- duplicate webhook blocked
- events page shows lifecycle
- CSV operational logs generated
- trade exports downloadable
- status bar reflects connectivity + broker state

---

# 5) Explicit ML1 Non-Goals
- commodity / MCX
- multi-leg execution UI
- strategy templates
- advanced payoff analytics
- plugin SDK
- public APIs
- AI workflows
- Bloomberg-like companion terminal
- backtesting module

These remain later milestone responsibilities.

---

# 6) Codex Implementation Guidance
- preserve frozen PRD principles
- never bypass canonical instrument model
- all clients must use `/api/v1`
- no broker-specific symbols in UI
- fail-fast on stale session or offline dispatch
- keep UI nimble and Angel One inspired
- prefer shared service layer over route logic
- maintain single Alembic migration head discipline

---

# 7) Milestone Exit Gate
ML1 is complete when:
1. live Angel-connected stock/F&O/futures execution works
2. TradingView alerts dispatch correctly
3. positions and holdings reconcile to broker truth
4. observability + CSV audit trail are stable
5. PRD frozen principles remain intact


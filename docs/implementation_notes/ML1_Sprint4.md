# ML1 Sprint 4 Implementation Notes

## S4.1 Stock Order Dialog (Cash)

### Completed
- Added stock ticket UI launched from canonical Search results (`Trade` action on cash instruments)
- Implemented preview-first backend flow (auth-required):
  - `POST /api/v1/orders/preview`
  - `POST /api/v1/orders`
- Implemented canonical instrument → broker routing resolution behind the adapter boundary
- Implemented Angel + Zerodha cash order placement via `BrokerAdapter.place_equity_order()`
- Added minimal order persistence (`orders` table) with Alembic migration
- Added focused tests for payload validation, preview routing, and mocked broker placement

### Important highlights
- Canonical-first contract: UI and API accept `canonical_id`; broker-specific identifiers stay internal/secondary
- Fail-fast dispatch gating baseline: broker must be configured/enabled and session must be `connected` (not `stale`)
- Preview flow returns safe routing summary (broker + exchange + trading symbol) without leaking tokens/secrets
- Last-used broker is updated on successful placement (persisted to `User.last_used_broker`)

### Next
- S4.2 F&O order dialog reusing the same preview/dispatch patterns
- Protective controls (SL/TP/TSL) and dispatch gating expansion (internet/reachability/risk) per frozen PRD
- Order lifecycle/status APIs + Events workspace surfaces (later milestones)

---

## S4.2 F&O Order Dialog (Options + Futures)

### Completed
- Added F&O ticket UI launched from Search results and strike discovery rows (`Trade` on OPTION/FUTURE instruments)
- Implemented preview-first backend flow (auth-required):
  - `POST /api/v1/orders/fno/preview`
  - `POST /api/v1/orders/fno`
- Canonical-field request model (OPTION/FUTURE): `underlying`, `expiry`, `strike`, `option_type`, `lots`, `MIS/NRML`, `market/limit`
- Lots-based quantity derivation (`quantity = lots × canonical lot_size`) shown in preview
- Broker dispatch uses canonical → broker mapping behind the adapter boundary:
  - Angel: uses `instrument_mappings` (token + tradingsymbol) and places NFO orders via SmartAPI
  - Zerodha: uses `instrument_mappings` (tradingsymbol) and places NFO orders via Kite

### Important highlights
- Canonical-first UX: the dialog operates on canonical contract fields and never asks for broker symbols
- Preview is required before placement to keep routing/validation explicit and reduce “blind dispatch”
- Added a minimal Zerodha NFO mapping sync endpoint so Zerodha F&O orders can be resolved deterministically:
  - `POST /api/v1/instruments/sync/zerodha-nfo` (requires connected Zerodha session; underlyings required)

### Next
- Optional SL/TP/TSL controls (frozen PRD) for both stock + F&O tickets
- Dispatch gating expansion (internet/broker reachability) and system events workspace (frozen PRD)
- Multi-leg/spreads are explicitly deferred beyond S4.2

---

## S4.2 Follow-up — Contract-Driven Ticket Prefill (UX Fix)

### Completed
- Added explicit dialog launch modes: `manual` and `contract` for both Stock + F&O tickets
- Fixed Search → Trade handoff so clicking `Trade` hydrates the ticket from the selected canonical row (no blank/manual reset)
- Preserved manual/blank launch behavior for future “open empty ticket” entry points
- Prevented stale dialog state when switching between different contracts (key-based remount + clean state reset)

### Important highlights
- Row contract is the source of truth: the ticket uses canonical fields from the clicked row (underlying/expiry/strike/CE-PE) without re-selection
- Preview panel now clearly indicates `Prefilled` vs `Draft` vs `Ready` and remains compatible with preview-first placement discipline
- Price/premium prefill remains optional and hook-ready (`referencePrice`) but is intentionally not coupled to live quotes in S4.2

### Next
- Add quote/LTP enrichment (optional) to improve limit price/premium autofill without breaking canonical-first modeling
- Extend quote-aware prefill (optional) for LIMIT price defaults when a safe reference price is available

---

## S4.2.1A Premium Hydration + Smart Strike UX (F&O)

### Completed
- Added a lightweight quote cache store (`premiumsByCanonicalId`, `spotsByUnderlying`) with local persistence for safe UI-side hydration
- Prefilled F&O LIMIT premium/price when available (selected row reference premium → cached premium → last preview premium)
- Enhanced strike selection UX:
  - strike dropdown options now include moneyness labels (`ATM/ITM/OTM`)
  - added compact color-coded moneyness badge next to the strike selector
  - added moneyness labels in the strike discovery list for faster scanning
- Preview panel now shows optional premium context when available:
  - premium (reference/limit)
  - spot (if cached)
  - moneyness label
  - premium outlay (`premium × quantity`)

### Important highlights
- Premium hydration is **non-blocking** and never prevents preview/placement; it only improves defaults when a safe reference exists
- Canonical-first remains intact: quote/premium cache keys are canonical IDs and underlyings; broker symbols are never used as primary UI identity
- PE moneyness semantics reverse correctly relative to CE (tested)

### Next
- Optional async quote fetch (non-blocking) behind a future `/quotes` API (deferred) to reduce reliance on cached/preview premiums
- Populate `spotsByUnderlying` from a safe backend quote/spot source once available (deferred)

---

## S4.2.1 Order intent + Orders/Positions workspace stabilization

### Completed
- Hardened backend order persistence with normalized intent/execution semantics fields (TradingView/webhook-ready):
  - `source`, `intent_type`, `trigger_mode`, `risk_mode`, optional `sl_value`/`tp_value`/`trailing_value`
  - linkage: `parent_order_id`, `linked_position_id`, `broker_context`
  - safe snapshots: `preview_snapshot_json`, `broker_payload_json`, `broker_symbol_resolved`, `lot_size_snapshot`
- Added broker-neutral `positions` ledger table (local intent-based ledger; live broker reconciliation deferred)
- Added backend APIs:
  - `GET /api/v1/orders`, `GET /api/v1/orders/{id}`
  - `POST /api/v1/orders/repeat`, `POST /api/v1/orders/reverse`, `POST /api/v1/orders/reconcile` (deferred)
  - `GET /api/v1/positions`
  - `POST /api/v1/positions/{id}/squareoff`, `POST /api/v1/positions/{id}/reverse` (returns ticket drafts), `POST /api/v1/positions/{id}/refresh` (deferred)
- Implemented production-grade `Orders` and `Positions` workspaces in the frontend:
  - filterable tables, latest-first sorting, compact badges, and quick actions
  - single-click `Repeat` / `Reverse` / `Square off` launching prefilled tickets (contract-driven)

### Important highlights
- Canonical-first remains the truth layer: UI renders canonical instruments; broker symbols/tokens are stored internally only
- Multi-source safety: `manual_ui` and future `tv_webhook` share the same tables and intent fields
- Positions ledger is intentionally conservative: it updates from submitted intents; fill-level accuracy and broker book reconciliation are deferred
- Migrations remain developer-friendly: SQLite test migrations skip unsupported FK/default-alter operations; Postgres keeps constraints

### Next
- Add SL/TP/TSL UI inputs and intent persistence (no advanced broker-native placement yet; frozen PRD requires the UX surface)
- Add broker order/position reconciliation jobs + System Events traces (frozen PRD)
- Enrich Orders/Positions with safe quote/LTP + PnL calculations (deferred; no websockets yet)

---

## S4.2.1 broker order inclusion (Orders workspace)

### Completed
- Added persisted user preference `include_broker_orders` (default `true`) and exposed it via `/api/v1/auth/me`
- Extended `/api/v1/auth/me/preferences` to update `include_broker_orders` (and remains compatible with `last_used_broker`)
- Implemented backend-driven unified Orders workspace endpoint:
  - `GET /api/v1/orders/workspace?mode=merged|internal_only|broker_only`
  - backend fetches internal orders + (optionally) broker orderbooks, normalizes, matches conservatively, and returns one merged dataset
- Implemented broker orderbook fetch + normalization behind adapters:
  - Angel One: SmartAPI orderbook (`getOrderBook`) normalization
  - Zerodha: Kite orderbook (`orders()`) normalization
- Updated frontend Orders workspace:
  - persisted `Include broker orders` toggle (server-side preference)
  - segmented source mode selector (Merged / Internal only / Broker only)
  - provenance + reconciliation badges, plus graceful broker-warning banner

### Important highlights
- Broker remains the truth for lifecycle/status; SigmaTraderPRO remains the truth for intent metadata and internal execution context
- Matching is conservative and merge-only on strong identifiers (`broker + broker_order_id`, then `exchange_order_id`); otherwise broker orders remain separate rows
- Broker failures never blank the workspace: internal orders still render, and warnings remain non-blocking

### Next
- Expand matching confidence using additional broker identifiers where safely available (still conservative)
- Add optional “trade from broker-only row” UX (explicitly deferred; needs safer mapping defaults)

---

## S4.2.1B reconcile + positionbook sync

### Completed
- Implemented `POST /api/v1/orders/reconcile` to pull broker orderbooks and update internal order lifecycle fields (status/avg price/rejection reason) using strong-id matching only
- Implemented `POST /api/v1/positions/{id}/refresh` to pull broker positionbook and sync the local positions ledger (bounded, net-position snapshot)

### Important highlights
- Reconcile is bounded to internal rows: broker-only orders remain broker-only (no auto-import/backfill)
- Position sync is snapshot-based and FK-safe: missing positions are marked closed by setting `quantity=0` so they no longer render, but rows are retained for linkage

### Next
- Add a safe “refresh all positions” endpoint + UI (optional)
- Expand position sync to surface broker order IDs / fill attribution (deferred)

---

## S4.2.2 Watchlist workspace + quick trade actions

### Completed
- Added persisted user-scoped Watchlists (backend + migration):
  - `watchlists` + `watchlist_items` tables with ordered rows (`position`) and default list support
  - CRUD + reorder APIs under `GET/POST/PATCH/DELETE /api/v1/watchlists` and items subroutes
- Added Watchlist workspace page (`/watchlist`) as a practical daily working set:
  - multiple lists, rename/delete, set default
  - add/remove items + simple up/down reordering
  - supports canonical instruments plus “underlying-only” rows for F&O-capable underlyings
- Integrated Search → Watchlist handoff:
  - Search results include `Add` action that adds to active watchlist when available, otherwise default watchlist
- Added row quick actions (reuses existing dialogs/routes; no duplicate ticket logic):
  - Buy/Sell opens Stock or F&O ticket in contract-driven mode when a contract is known
  - Underlying rows open a prefilled manual F&O ticket
  - Orders/Positions shortcuts use existing workspace filters (`/orders?q=…`, `/positions?q=…`)

### Important highlights
- Canonical-first persistence: watchlist items store `canonical_id` when available; broker symbols never become the primary identity
- Underlyings are treated as first-class navigation anchors for F&O workflows without forcing a specific contract selection
- Quick actions reuse the S4.1/S4.2 ticket launch modes (`manual` vs `contract`) to keep behavior consistent and future-safe

### Next
- Optional: add bulk “add from Search” to a chosen watchlist (menu) and/or batch reorder (drag handle)
- Optional: lightweight row indicators from Orders/Positions (counts + status) without introducing live quotes
- Deferred: live quotes, TradingView-bound watchlists, scanner-generated lists, AI annotations (per S4.2.2 non-goals)

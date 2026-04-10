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

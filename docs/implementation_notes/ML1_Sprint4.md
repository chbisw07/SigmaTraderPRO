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


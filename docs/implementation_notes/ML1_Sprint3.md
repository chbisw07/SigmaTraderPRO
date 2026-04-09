# ML1 Sprint 3 Implementation Notes

## S3.1 Broker Adapter Interface + Angel Auth

### Completed
- Introduced a broker-agnostic adapter contract (`BrokerAdapter`) and stable status model/state semantics
- Added persisted broker connection state per user (`broker_connections`) with Alembic migration
- Implemented Angel One adapter (connect/reconnect/disconnect + status) behind the adapter boundary
- Implemented daily-session validity model (sessions are valid for the current day; next day becomes `stale`)
- Added authenticated broker endpoints under `/api/v1/brokers/...` for settings, connect/reconnect, and status
- Added focused tests for Angel settings/connect/status and next-day staleness (network calls mocked)

### Important highlights
- Secrets are never logged (API keys/passwords/tokens/TOTP). Storage uses symmetric encryption at rest via `BROKER_ENCRYPTION_KEY`.
- Status semantics are intentionally crisp for UI/status-bar consumption: `not_configured`, `configured`, `needs_reconnect`, `connected`, `stale`, `error`.
- External broker calls are isolated to a single Angel client module; tests patch the adapter boundary without live broker dependency.

### Next
- S3.2 canonical instrument registry foundations (broker-agnostic mapping layer)
- S3.3 broker settings UI consuming the new broker endpoints
- Add callback/postback URL support where required by specific brokers (Zerodha/Fyers)

---

## S3.x Broker Settings UI + Zerodha + Angel Connect (foundation)

### Completed
- Added Zerodha adapter (Kite Connect request_token flow) behind the same broker adapter boundary
- Added authenticated Zerodha broker endpoints under `/api/v1/brokers/zerodha/...` including a helper `login-url` endpoint
- Implemented a compact Brokers page UI (Angel + Zerodha) for:
  - saving broker settings (no secrets ever echoed back)
  - connect/reconnect actions (Angel via TOTP; Zerodha via request_token)
  - clear connection status display (`connected`, `stale`, `needs_reconnect`, etc.)
- Added focused backend tests for Zerodha adapter behavior with mocks and extended frontend smoke tests for Brokers page render

### Important highlights
- Daily-session validity model is applied consistently: next-day sessions report `stale` and require reconnect
- Secrets are encrypted-at-rest (DB) and never logged; UI uses masked inputs for secret fields
- UI structure includes an explicit “Fyers (coming soon)” placeholder to keep the layout extension-ready

### Next
- S3.2 canonical instrument registry (no broker symbols in UI)
- S3.3+ enrich broker page with callback/postback URLs where applicable
- Add broker connectivity summary into the status bar once broker sync and health semantics expand

---

## S3.2 Canonical Instrument Registry Backend

### Completed
- Added canonical enums (`Exchange`, `Segment`, `InstrumentType`, `OptionType`) aligned with the frozen PRD
- Introduced canonical registry tables:
  - `instruments` (canonical truth objects with `canonical_id`)
  - `instrument_mappings` (broker resolution data: token/tradingsymbol, internal-only)
- Implemented Angel instrument normalization + idempotent upsert ingestion (no duplicates on repeated sync)
- Added an import/sync skeleton (`InstrumentSyncService.sync_angel_rows`) and a small CLI helper script
- Added authenticated canonical search API:
  - `GET /api/v1/instruments/search?q=...`
  - `GET /api/v1/instruments/{canonical_id}`
- Added focused tests for normalization, idempotent sync, and search endpoints

### Important highlights
- Canonical IDs are the downstream truth layer; broker symbols/tokens are stored only in `instrument_mappings`
- Search responses are canonical-first and intentionally do not expose broker identifiers
- Mapping resolution exists as a service helper for future order flows (not a primary API surface)

### Next
- S3.3 frontend search UI consuming canonical search endpoints (no broker symbols in UI)
- S4.x order dialogs resolving canonical → broker mapping internally at dispatch time
- Add Zerodha/Fyers mapping normalizers and import paths (S3.2+ follow-ups)

---

## S3.3 Search UI + Broker Settings UI

### Completed
- Promoted Brokers workspace into a usable broker-agnostic settings surface (Angel + Zerodha together; Fyers placeholder preserved)
- Added canonical-first Search workspace:
  - universal instrument search UI consuming `/api/v1/instruments/search`
  - read-only F&O strike discovery UI consuming canonical derivative helpers
- Added a lightweight “broker context” selector backed by `last_used_broker` preference (auth-scoped, no broker coupling)
- Added frontend smoke tests covering canonical search render and strike discovery path

### Important highlights
- Search UX remains canonical-first: the UI renders canonical IDs and normalized fields; broker symbols/tokens remain internal-only
- Derivative discovery uses canonical metadata (`underlying`, `expiry`, `strike`, `option_type`) and is intentionally read-only until order dialogs land (S4.x)
- Broker settings and search surfaces are parallel-broker by design (no “one broker is the default” architecture drift)

### Next
- Enrich strike discovery with expiry/strike narrowing and “open order ticket” handoff stubs (S4.1/S4.2)
- Add Zerodha/Fyers instrument mapping normalizers and import paths to expand canonical coverage (S3.2 follow-ups)
- Add broker-connected status rollups into the status bar once sync and dispatch gating are introduced (S4.x)

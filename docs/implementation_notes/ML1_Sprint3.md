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

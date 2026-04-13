# ML1 Sprint A Implementation Notes

## 1) Overview
Sprint A consolidates Milestone-1 execution foundations into a broker-truth-aware trading terminal with professional observability. The most important architectural outcome is that order entry now produces a **reusable `execution_intent`** (entry intent + SigmaTrader-managed execution plan) and that the system has a **control-plane queue** between intent creation and broker dispatch.

---

## 2) Major completed capability areas

### 2.1 Order entry and execution semantics
- Stock and F&O order dialogs implemented with preview-first placement, canonical-instrument routing, and broker adapters (Angel + Zerodha).
- **Dispatch gating** added as a pre-dispatch protection layer (offline / session missing / stale session / dispatch disabled) so blocked outcomes are deliberate and non-retried.
- **Correlation IDs** propagated across UI → backend → gating → broker dispatch → persisted order rows and surfaced in UX for support/debugging.
- Order lifecycle made explicit and persistent:
  - `BLOCKED` (gates failed; no dispatch attempted)
  - `DISPATCH_FAILED` (attempted, failed before ack)
  - `ACKNOWLEDGED` (broker accepted request; distinct from fill/execution)
  - existing states preserved for broker truth (rejected/cancelled/executed/partial)
- Failure/blocked reasons persist via structured code+message fields and are shown cleanly in UI.
- Dispatch lifecycle is operator-visible via **System Events** (category `order_dispatch`) with correlation IDs.

### 2.2 TradingView ingestion foundation (S5.1)
- `POST /webhook/tradingview` implemented as the canonical TradingView entrypoint.
- `route_token` required and validated (configured via settings/env; never echoed in logs/responses).
- `schema_version` checked explicitly (unsupported/missing versions rejected deterministically).
- Deterministic idempotency implemented using an idempotency key / fingerprint persisted with ingestion rows.
- Canonical payload parsing/normalization produces a predictable internal contract for downstream workflows.
- Webhook lifecycle observability is operator-visible via System Events (category `webhook_tradingview`) including correlation IDs and duplicate/rejection reasons.

### 2.3 System observability (S5.2 + S5.3)
- **System Events workspace** implemented and is the primary operator-facing history:
  - persisted table, filters (category/level), search (message/correlation), cleanup/retention controls.
- **Structured application logging** standardized (JSON/console modes) and correlation-aware where available.
- **CSV audit logging** implemented as a durable exportable trail with:
  - daily file naming, size rotation, bounded retention cleanup,
  - consistent headers and safe escaping,
  - sensitive-field sanitization/redaction (tokens, route_token, secrets, credential payloads).
- Clear role separation:
  - System Events = operator UI history
  - structured logs = debugging/ops stream
  - CSV audit = durable exportable audit trail

### 2.4 Portfolio and broker-truth work (S6.1 + S6.2 baseline)
- Professional Orders / Positions / Holdings workspaces implemented with filters/search/refresh and broker-aware truth cues.
- Holdings actions improved to be terminal-like:
  - per-row **Buy/Sell** actions in an Actions column,
  - launches the stock order dialog prefilled (broker, symbol, side, qty, delivery-safe product defaults).
- Broker sync + reconciliation baseline introduced to keep SigmaTrader state broker-truth-aware:
  - broker order inclusion in Orders workspace,
  - reconcile endpoints to refresh internal lifecycle from broker truth (conservative matching),
  - positions sync/refresh baseline,
  - UI-visible warnings/badges and System Events for important sync/reconcile outcomes.

### 2.5 Execution intent foundation (order dialog redesign)
- Order dialogs redesigned as **execution-intent builders**, not one-off broker payload forms.
- `execution_intent` is modeled as:
  - **entry intent** (broker-facing entry order definition)
  - **execution plan** (SigmaTrader-managed exits and behavior)
- Product modes supported with user-facing semantics:
  - Cash: Delivery (→ `CNC`), Intraday (→ `MIS`)
  - F&O: Intraday (→ `MIS`), Carry Forward (→ `NRML`/equivalent)
- Lot-aware F&O handling:
  - lots input + lot size shown; canonical `quantity = lots × lot_size` carried in intent.
- App-managed exits captured in the execution plan (execution engine deferred):
  - Stop Loss, Target, Trailing SL
  - absolute ↔ percentage synchronization (both directions)
  - signed percentage semantics are side-aware (BUY vs SELL) and reference-price-based
- `execution_intent_json` persisted with orders so the intent survives beyond immediate dispatch and can power queue/alerts/webhooks.

### 2.6 Queue Sprint A — Ingestion Queue foundation
- Added the first real queue/pipeline layer: **Ingestion Queue** (control plane between intent creation and broker dispatch).
- Queue items persist normalized `execution_intent` plus metadata:
  - `source_type` (`manual_ui`, `tradingview`, `alert`, `system`, `ai`)
  - `correlation_id` + `idempotency_key`
  - `execution_mode` (`manual_review`, `auto_dispatch`)
  - lifecycle states: `queued`, `ready`, `blocked`, `approved`, `dispatched`, `cancelled`, `failed`, `expired`
- Queue execution reuses existing dispatch gating and order placement flows (no parallel broker pipeline).
- Queue → Order linkage is explicit (`dispatched_order_id`) and dispatch tags include `queue_id` for traceability.
- Queue lifecycle emits System Events (category `ingestion_queue`) and writes CSV audit rows (create/update/execute/cancel).
- Manual order dialogs support **“Add to queue”** (source = `manual_ui`) while preserving “Place now”.

---

## 3) Important architectural decisions (record)
- SigmaTrader remains **broker-truth-aware** and reconciliation-capable; internal intent is preserved even when broker truth differs.
- System Events, structured logs, and CSV audit serve distinct operational roles (UI history vs stream vs export).
- Order dialogs create a **reusable execution intent** (entry + execution plan), not just a transient UI submission.
- App-managed exits are modeled separately from broker-native entry orders (engine deferred but contract stabilized).
- Queue is an umbrella domain; **Ingestion Queue** is the first implemented pipeline.
- Manual UI can flow through queue to unify tracing, review, and dispatch control.
- Source+queue architecture is future-safe for TradingView, alerts, AI, and later managed-exit pipelines.

---

## 4) Operational improvements
- Deterministic block/fail/ack outcomes with explicit persistence and operator-visible explanations.
- Correlation-first observability across orders, webhooks, queue items, System Events, and CSV audit trails.
- Safe sanitization policy applied consistently to prevent leakage of secrets/tokens in logs/audit.

---

## 5) Deferred / follow-up items (deliberate)
- Live execution engine for app-managed SL/TP/Trailing SL (monitoring + exit order placement).
- Full TradingView → Queue streamlining (webhook should enqueue intents rather than dispatch directly; wiring is prepared).
- Full field-resolution matrix / source-routing policy (when multiple brokers/sources compete).
- Advanced queue families and pipelines (alerts queue, exit queue, AI queue, scheduling).
- GTT-like scheduling/activation and trigger evaluation.
- ML1 hardening polish: operator exports, retention tuning, production deployment playbooks.

---

## 6) Readiness assessment
- Core terminal workflows (manual trading, safe dispatch gating, durable observability, broker-truth-aware workspaces) are in place.
- Architecture is now “pipeline-ready”: `execution_intent` + Ingestion Queue enable safe expansion into auto modes and webhook-driven flows without rewriting core order semantics.

---

## 7) Suggested next step
Wire TradingView webhook ingestion to **enqueue execution intents** into the Ingestion Queue (source = `tradingview`) with deterministic idempotency → queue idempotency reuse, then add a thin operator path to approve/execute queued items.


# ML1 Queue — Field Resolution Matrix + Source/Routing Policy

## 1) Overview
SigmaTraderPRO “Queue” is the umbrella domain for intent-driven pipelines. The first implemented pipeline is the **Ingestion Queue**: a durable control plane between **execution intent creation** and **broker dispatch**.

Key properties:
- Queue items store a **normalized `execution_intent`** (`entry` + `plan`), plus source/correlation/idempotency and lifecycle state.
- Sources include: `manual_ui`, `tradingview`, `alert`, `system`, `ai` (future-safe).
- **Queue admission** should accept *incomplete-but-understandable* intents (when safe) and preserve lineage.
- **Execution** must only occur when execution-critical fields are resolved and broker dispatch is allowed (dispatch gating).

This document formalizes:
- which fields are required at ingestion vs required before execution,
- how source routing and secret resolution works,
- how instrument resolution should behave,
- how to represent unresolved/defaulted fields for operator tooling.

---

## 2) Field Resolution Matrix

Legend:
- **Required at ingestion**: webhook/API must provide it, or server must deterministically generate it.
- **Required before execution**: must be resolved to dispatch the entry order.
- **Nullable forever**: acceptable to keep null indefinitely (optional feature fields).
- **Defaultable**: server/operator may fill a value deterministically (policy-based).
- **Resolvable from context/secret**: value can be derived from authenticated user, route secret mapping, broker preferences, or instrument registry/mappings.
- **Blocking if unresolved**: whether the queue item should be `blocked`/`warning`/`valid` and whether execution is prevented.

> Note: current Sprint A implementation stores `execution_intent.entry.canonical_id` as required (queue item persists `canonical_id`). Sprint B may extend the model to admit unresolved derivative descriptors (see Instrument Resolution Policy).

### 2.1 Identity / Source / Routing

| Field | Required at ingestion? | Required before execution? | Nullable forever? | Defaultable? | Resolvable from context/secret? | Blocking if unresolved | Notes / examples |
|---|---:|---:|---:|---|---:|---|---|
| `source_type` | yes | yes | no | default (`manual_ui`) | no | block if missing/invalid | Must be preserved for lineage even after edits. |
| `source_ref` | no | no | yes | conditional | yes | never | E.g. webhook alert id, strategy name, UI context string. |
| `correlation_id` | yes (or generated) | yes | no | yes (server-generated UUID) | yes | block if missing (should not happen) | Must be stable for the queue item lifecycle and propagated to orders. |
| `idempotency_key` | yes (or generated) | yes | no | yes | yes | block duplicates as `409` (ingestion) | For webhook sources, should be stable across retries; for UI, server can generate. |
| `route_secret_ref` *(planned)* | conditional | conditional | yes | no | yes | reject ingestion if required and invalid | Do **not** store raw secrets; store a route id/ref and keep secrets server-side only. |
| `user_id` | yes (auth or secret-resolved) | yes | no | no | yes | reject ingestion if unresolved | Manual UI uses auth; webhook sources must resolve to user via secret mapping. |
| `broker` (`entry.broker`) | conditional | yes | no | conditional | yes | **execution blocked** if unresolved | Admission may allow missing broker for `tradingview/alert` if enough intent context exists. |

### 2.2 Instrument resolution

| Field | Required at ingestion? | Required before execution? | Nullable forever? | Defaultable? | Resolvable from context/secret? | Blocking if unresolved | Notes / examples |
|---|---:|---:|---:|---|---:|---|---|
| `canonical_id` (`entry.canonical_id`) | conditional | yes | no | no | yes | **execution blocked** | Current baseline requires canonical id. Sprint B may admit `instrument_descriptor` for derivatives. |
| `instrument_descriptor` *(planned)* | conditional | conditional | yes | no | yes | block until resolved | For options/futures: `underlying`, `expiry`, `strike`, `option_type`, `instrument_type`, `exchange/segment`. |
| `segment` | no | conditional | yes | yes | yes | warning/block depending on ambiguity | Prefer derived from canonical instrument once resolved. |
| `exchange` | no | conditional | yes | conditional | yes | block if needed for resolution | For derivatives, exchange (e.g., `NFO`) may be required to resolve contract. |
| `instrument_type` | no | conditional | yes | conditional | yes | block if ambiguity remains | `EQUITY`, `OPTION`, `FUTURE`. |
| `underlying` | conditional | conditional | yes | conditional | yes | block if derivative resolution needs it | e.g. `NIFTY`, `BANKNIFTY`, `AUROPHARMA`. |
| `expiry` | conditional | conditional | yes | no | yes | block if derivative | Must match broker/canonical master. |
| `strike` | conditional | conditional | yes | no | yes | block if option | Strike is a numeric value; formatting must not add spurious zeros. |
| `option_type` | conditional | conditional | yes | no | yes | block if option | `CE` / `PE`. |
| `lot_size` | no | conditional | yes | yes | yes | warning if missing | Should resolve from canonical instrument master; required for lots → quantity derivation. |

### 2.3 Trade intent (Entry)

| Field | Required at ingestion? | Required before execution? | Nullable forever? | Defaultable? | Resolvable from context/secret? | Blocking if unresolved | Notes / examples |
|---|---:|---:|---:|---|---:|---|---|
| `side` (`entry.side`) | yes | yes | no | no | no | block | `BUY` / `SELL`. |
| `quantity` (`entry.quantity`) | yes* | yes | no | conditional | yes | block if invalid/missing | Equity: required. F&O: may be derived from `lots × lot_size`. |
| `lots` (`entry.lots`) | conditional | conditional | yes | conditional | yes | block if F&O requires it | Prefer lots input for F&O; quantity is canonical broker qty. |
| `product_mode` *(UI semantic)* | conditional | conditional | yes | conditional | yes | warning/block if mismatch | User-facing: Delivery/Intraday/Carry Forward; maps to broker product. |
| `product` (`entry.product`) | yes | yes | no | conditional | yes | block | Must be correct for instrument segment. Holdings-originated defaults prefer Delivery/CNC. |
| `order_type` (`entry.order_type`) | yes | yes | no | conditional | yes | block | `MARKET` / `LIMIT`. |
| `limit_price` (`entry.limit_price`) | conditional | conditional | yes | no | no | block if `LIMIT` and missing/invalid | For market orders, limit price must be null. |
| `trigger_price` *(planned)* | conditional | conditional | yes | no | no | block if trigger order requested | Reserved for SL/SLM style broker triggers (future). |

### 2.4 Execution plan (SigmaTrader-managed)

| Field | Required at ingestion? | Required before execution? | Nullable forever? | Defaultable? | Resolvable from context/secret? | Blocking if unresolved | Notes / examples |
|---|---:|---:|---:|---|---:|---|---|
| `managed_exits_enabled` (`plan.managed_exits`) | no | no | yes | yes (false) | yes | never | If `true`, additional plan validation applies. Execution engine is deferred (plan persists). |
| `reference_price` (`plan.reference_price`) | conditional | conditional | yes | conditional | yes | block if managed exits require it | Derived from limit price, or provided as context; market orders may not have a safe reference at ingestion time. |
| `reference_source` (`plan.reference_source`) | conditional | conditional | yes | conditional | yes | warning/block depending on plan | e.g. `limit_price`, `ltp_snapshot`, `manual`. |
| `stop_loss` (`plan.stop_loss.price/pct`) | no | no | yes | no | no | validation warning/block if contradictory | Must be side-aware (BUY SL below ref, SELL SL above ref). |
| `target` (`plan.target.price/pct`) | no | no | yes | no | no | validation warning/block if contradictory | Side-aware (BUY TP above ref, SELL TP below ref). |
| `trailing_sl` | no | no | yes | yes (disabled) | no | warning/block if invalid | Baseline: protective trailing percent should be negative. |

### 2.5 Queue control fields

| Field | Required at ingestion? | Required before execution? | Nullable forever? | Defaultable? | Resolvable from context/secret? | Blocking if unresolved | Notes / examples |
|---|---:|---:|---:|---|---:|---|---|
| `execution_mode` | yes (or default) | yes | no | yes | yes | never | `manual_review` vs `auto_dispatch`. Auto dispatch must still pass gating + readiness. |
| `expires_at` | no | conditional | yes | conditional | yes | block/expire | Useful for intraday-only intents; expired items must not execute. |
| `notes` | no | no | yes | no | no | never | Operator annotation; must not erase source lineage. |

---

## 3) Source / Routing Policy

### 3.1 General rules (all sources)
- Preserve `source_type` and `source_ref` permanently. Manual edits must not rewrite lineage; add edit metadata instead.
- Queue admission may accept missing *resolvable* fields (broker, canonical instrument) **only** if:
  - the item is understandable and can be resolved deterministically later (by secret mapping, instrument registry, operator edit), and
  - the system can represent unresolved fields explicitly to the operator.
- Execution is only allowed when execution-critical fields are resolved and dispatch gating allows dispatch.

### 3.2 `manual_ui`
- Should flow through Ingestion Queue as a first-class path.
- Typical modes:
  - `manual_review`: queue → operator approve/execute
  - (optional) `auto_dispatch`: queue admission → validate/gate → dispatch immediately, still emitting queue lifecycle events and audit rows.
- Even if queue dwell time is short, it must still transition states and be auditable.

### 3.3 `tradingview`
- Requires a **source secret** (route token / webhook route) for ingestion.
- May omit broker/product/managed exits; admission is allowed if the intent can be interpreted and resolved.
- Must **not** blindly auto-dispatch when routing is unresolved:
  - If broker/account/instrument is unresolved → admit and mark unresolved; execution remains blocked.
  - If routing fully resolves and policy allows `auto_dispatch` → may proceed after dispatch gating.
- Idempotency must be stable across retries (TradingView repeats are expected).

### 3.4 `alert`
- Similar to `tradingview` but defaults may differ:
  - alerts may be internal and already associated with a user/strategy config,
  - can allow admission with missing broker/product if alert config provides defaults.
- Source lineage must remain explicit even if operator edits the intent later.

### 3.5 App-triggered exits (SL/TP/Trailing)
- App-managed exits should not pretend to be `manual_ui`:
  - preserve lineage: `source_type=system` (or dedicated future source) and `source_ref` links to the parent order/position/plan trigger.
- When an exit trigger fires, it should create a new downstream intent/event:
  - a new queue item representing an exit entry order (or broker-native exit order), linked to the original order/position, with correlation linkage.
- The exit execution engine is deferred, but the routing policy must preserve lineage and auditability.

### 3.6 Future `ai` / `system`
- Future-safe only in ML1:
  - treat as potentially incomplete intents,
  - require explicit routing policy and operator guardrails before allowing auto execution.

---

## 4) Secret Resolution Policy

### 4.1 Design direction
Secrets are production routing/auth material and must support **server-side resolution** (not just one-way verification).

Recommended approach:
- Maintain an opaque secret mapping table, e.g. `webhook_routes`:
  - `route_id`, `secret_hash`, `user_id`, optional `default_broker`, optional `default_execution_mode`, optional `allowed_sources`, optional strategy metadata.
- Webhook requests provide `route_token` → server resolves to route row and derives context:
  - user/account identity
  - optional broker/profile
  - default execution_mode / guardrails

### 4.2 Expected outcomes
- **Invalid secret** → reject at ingestion (`401/403`) + System Event + CSV audit entry (sanitized).
- **Valid secret, broker unresolved** → admit queue item (if intent understandable), set unresolved fields, block execution.
- **Valid secret, routing complete** → queue item can become `ready/queued` and can auto-dispatch if policy allows and dispatch gating passes.

### 4.3 Non-leakage requirements
- Never log or store raw secrets (`route_token`) in System Events, structured logs, or CSV audit.
- Persist only a safe reference (`route_id` / `route_secret_ref`) and sanitized metadata.

---

## 5) Instrument Resolution Policy

Supported (ML1):
- Equity
- Stock options
- Index options
- Futures

Not in scope yet:
- Commodities
- Multi-leg strategies / spreads

### 5.1 Canonical-first architecture
- SigmaTrader maintains a broker-agnostic canonical instrument registry.
- Broker adapters use mapping tables (`instrument_mappings`) to translate canonical instruments to broker-specific contracts (trading symbol/token).
- Dispatch is the boundary where canonical → broker mapping occurs.

### 5.2 Admission with unresolved instruments (planned for Sprint B)
Queue admission may accept derivative descriptors when canonical id is not provided, as long as the descriptor is precise enough to attempt resolution later:
- `underlying`, `expiry`, `instrument_type`, and for options: `strike` + `option_type`, plus `exchange/segment` where needed.

Resolution rules:
- If descriptor resolves to exactly one canonical instrument → fill `canonical_id` and mark field as resolved.
- If multiple matches → block execution and surface “ambiguous instrument” requiring operator edit (choose contract).
- If no match → block execution and surface “instrument not found”.

### 5.3 Allowed bootstraps
Backend may bootstrap canonical master data from one broker’s instrument master as a data source, but:
- canonical meaning must remain broker-agnostic,
- queue items and execution intents must not embed broker-specific identifiers as primary identity.

---

## 6) Queue Admission vs Execution Readiness

Queue processing must explicitly distinguish three concepts:

### 6.1 Ingestion validity (admission)
Can the system accept this payload as a queue item?
- Acceptable examples:
  - Missing `managed exits` fields (optional).
  - Missing `broker` for `tradingview` when secret resolves user but broker selection is deferred.
  - Missing canonical id **if** a precise derivative descriptor is provided (Sprint B).
- Rejection examples:
  - Invalid/missing source secret when required.
  - Payload not parseable into a safe normalized internal structure.
  - No resolvable user/account identity.

### 6.2 Resolution completeness (what’s missing)
Track which fields are unresolved/defaulted/warned so the operator can fix them:
- Missing `broker` → resolvable via route config or operator selection.
- Missing `canonical_id` → resolvable via descriptor lookup.
- Managed exits enabled but no `reference_price` → plan persists but execution readiness is blocked until reference policy is satisfied.

### 6.3 Execution readiness (dispatchable)
May this item dispatch now?
- Must have resolved: user/account, broker, canonical instrument, side, quantity, product, order_type (+ price if limit), and must pass dispatch gating.
- If unresolved fields exist → execution is blocked and queue item is marked accordingly (see Resolution Metadata).

Examples:
- Missing SL/TP/Trailing → ok to execute (plan optional).
- Missing broker → ok to admit; **not** ok to execute.
- Missing instrument resolution → admit if descriptor exists; **block** execution until resolved.
- Managed exits enabled without safe reference price → admit; execution readiness depends on policy (typically blocked until reference exists).

---

## 7) Queue state and resolution metadata (recommended)

To support reliable operator UX, queue items should include resolution metadata independent of `status`:

### 7.1 Recommended fields (Sprint B additions)
- `resolution_state`: `resolved | unresolved | blocked`
- `unresolved_fields`: array of field identifiers (e.g. `["entry.broker", "entry.canonical_id"]`)
- `defaulted_fields`: array of fields defaulted by policy (e.g. `["entry.product"]`)
- `warning_fields`: array of fields with warnings (non-blocking)
- `block_reason_code` / `block_reason_message`: single operator-facing summary for execution blocking
- `validation_state`: `valid | warning | blocked`

### 7.2 UI representation guidance
- **Resolved**: normal row
- **Unresolved**: row badge + “needs resolution” summary; edit action emphasizes required fields
- **Blocked**: warning/error badge + reason; execute disabled; “resolve” CTA
- Ensure “source” and “correlation id” are always visible.

---

## 8) Corner cases and expected behavior

1) **Secret resolves user but not broker**
- Admit queue item if intent is otherwise valid.
- Mark unresolved `entry.broker`.
- Execution blocked until broker resolved by route config or operator edit.

2) **Broker resolved but disconnected / stale**
- Admission ok (if intent valid).
- Execution blocked by dispatch gating with explicit reason (`BROKER_NOT_CONNECTED`, `BROKER_SESSION_STALE`, etc.).

3) **Ambiguous option contract**
- Admit if descriptor present.
- Resolution results in multiple matches → execution blocked; require operator selection; preserve original descriptor.

4) **Duplicate TradingView/webhook intent**
- Admission should be idempotent:
  - if idempotency key duplicates → return a safe duplicate response (policy), do not create another row.
  - persist traceability in System Events and CSV audit (sanitized).

5) **Manual edit of source-generated queue item**
- Preserve `source_type` and `source_ref`.
- Append edit metadata (who/when) rather than rewriting lineage.
- If broker/product/etc. are changed, mark fields as operator-resolved.

6) **Stale/expired intraday queue item**
- If `expires_at` exceeded, mark `expired` and prevent execution.
- Operator may duplicate into a new item if needed (new correlation/idempotency).

7) **Managed exits enabled but no valid reference price**
- Persist the plan (do not discard).
- Mark unresolved `plan.reference_price` and block execution if policy requires a reference for managed-exit activation.

8) **Broker/account policy mismatch for product/instrument**
- Admission ok if resolvable; otherwise block execution with operator-friendly reason (e.g. `PRODUCT_NOT_ALLOWED_FOR_SEGMENT`).

9) **Source tracking must survive edits and execution**
- The dispatched order should carry source lineage via:
  - order `source` (mapped)
  - `dispatch_tags` including `queue_id` and `source_type`
  - correlation id consistent across lifecycle

---

## 9) Recommended implementation guidance for Sprint B (next)

Sprint B should implement (minimal baseline):
1) **Secret resolution mapping** for webhook sources (opaque secret → route row → user + defaults).
2) **Unresolved field tracking** on queue items (schema + UI badges + execute gating).
3) **Instrument resolution admission** for derivatives via `instrument_descriptor` when canonical id is missing.
4) **Routing/default policy** per source:
   - `tradingview` admission with missing broker/product allowed, execution blocked until resolved.
5) **Preserve lineage** across edits and dispatch:
   - source never rewritten; edits add metadata.
6) Tighten operator tooling:
   - “Resolve” UX (edit with required fields highlighted),
   - clear warnings vs blocks,
   - System Events + CSV audit for key state transitions.


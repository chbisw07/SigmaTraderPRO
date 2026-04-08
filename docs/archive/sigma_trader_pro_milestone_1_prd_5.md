# SigmaTraderPRO — Product Requirements Document
## Milestone-1: Foundation, Multi-Broker Connectivity & Basic Trade Execution

**Version:** v1.0  
**Status:** Draft for review  
**Goal:** Build the production-ready foundation of SigmaTraderPRO as a web-based multi-user, multi-broker trading platform with minimal stocks + F&O trading capability.

---

## 1) Objective
Milestone-1 establishes the **minimum viable professional trading platform core**.

The system must allow:
- multi-user authentication
- broker connectivity
- stock and basic F&O order placement
- TradingView webhook ingestion
- dispatch orders to selected broker
- broker-position sync
- broker settings UI
- professional broker-terminal-like UX
- reusable architecture for advanced F&O milestones

This milestone intentionally excludes:
- spreads / strategy builder
- Greeks
- OI analytics
- AI recommendations
- strategy backtesting
- auto hedging
- multi-leg orchestration
- advanced risk engine

These are reserved for Milestone-2+.

---

## 2) Product Vision for M1
A **SigmaTrader-like but cleaner and more broker-native platform** with UI philosophy inspired by Angel One / Zerodha / Fyers.

### Primary UX Zones
- **Left:** Watchlist + unified search
- **Center:** Positions / holdings / orders
- **Right:** Order drawer / trade modal
- **Top:** Broker state, market status, profile
- **Settings:** Broker tabs

---

## 3) Scope

### 3.1 In Scope

### A) Web App Foundation
- Separate frontend and backend modules
- Web-first responsive desktop layout
- Secure API communication
- JWT auth
- Session persistence
- Multi-user tenancy

### B) User Authentication
Reuse SigmaTrader philosophy.

Features:
- register/login/logout
- password reset
- JWT access + refresh tokens
- RBAC-ready (single trader role for now)
- profile settings
- broker account mapping per user

### C) Multi-Broker Connectivity
Supported brokers in M1:
- Zerodha
- Angel One
- Fyers

Each broker gets dedicated tabs/sections:
- API credentials
- login session
- token refresh
- account status
- margin snapshot
- positions sync
- orders sync
- profile fetch
- enable/disable broker

A user may connect one or more brokers simultaneously.

**Architectural requirement:** Broker Adapter Pattern.

### D) Basic Trading
#### Stocks
- NSE equity cash
- CNC
- MIS / intraday
- market orders
- limit orders

#### F&O (Bare Minimum)
- index options
- stock options
- futures
- CE / PE selection
- expiry selection
- strike search
- MIS / NRML
- market / limit

This is minimal execution capability only.

### E) Instrument Search
Unified search bar must support:
- RELIANCE
- INFY
- NIFTY
- BANKNIFTY
- NIFTY 23100 CE
- NIFTY APR 23100 PE

Search result metadata:
- exchange
- expiry
- strike
- CE/PE
- lot size
- tradingsymbol

### F) TradingView Webhook Integration
Mandatory in M1.

Flow:
`TradingView -> Backend Webhook -> Validation -> Broker Dispatch`

Compatible schema:
```json
{
  "broker": "zerodha",
  "symbol": "NIFTY",
  "segment": "OPT",
  "expiry": "2026-04-30",
  "strike": 23100,
  "option_type": "CE",
  "side": "BUY",
  "order_type": "MARKET",
  "product": "MIS",
  "qty": 75
}
```

Core behaviors:
- idempotency
- retry
- dead-letter queue
- validation
- auth secret
- duplicate protection
- broker routing

### G) Positions & Orders Screen
Angel One inspired.

Required tabs:
- positions
- orders
- holdings
- trades log
- P&L snapshot

---

## 4) Non-Functional Requirements

### Performance
- order dispatch < 500ms internal
- webhook processing < 300ms before broker API
- UI page load < 2s
- search latency < 200ms cached

### Security
- encrypted secrets
- token vault
- broker secrets never exposed to frontend
- audit logs
- webhook signature validation
- PII-safe logging
- secure refresh workflows

### Reliability
- broker reconnect
- token auto refresh
- retry queue
- persistent event log
- order reconciliation
- eventual broker truth sync

---

## 4.1) Data Layer & Retention Strategy (Frozen)

### Primary Data Layer
- **PostgreSQL** as the primary durable database
- **Redis** as the cache, idempotency, locking, and short-lived coordination layer

### Lean Market Data Philosophy
#### Persist in PostgreSQL
- users
- broker accounts and sessions
- orders, fills, and reconciliation events
- webhook events and audit logs
- instrument master metadata
- traded/watchlisted F&O contracts
- selective option-chain snapshots

#### Keep in Redis only
- TradingView webhook idempotency keys
- quote/LTP cache
- recent instrument search cache
- short-lived distributed locks
- burst protection and retry helpers

#### Fetch on demand
- long-range stock OHLC history
- backtesting datasets for equities
- full historical candles for non-traded option strikes

### Retention Defaults
- stock historical data: fetch on demand, no long-term DB retention in M1
- live quotes: Redis short-lived cache only
- option-chain snapshots: **30 days default**, configurable up to **90 days**
- automatic purge/cleanup jobs required

---

## 4.2) Deployment Philosophy (Frozen)

### Milestone-1
- local Docker-based development environment
- production-like Docker Compose support from day one
- VPS deployment deferred until project stabilization

### Production Rollout Recommendation
Preferred production target after M1/M2 stabilization:
- **Hostinger VPS**
- Docker Compose
- Nginx reverse proxy
- PostgreSQL
- Redis
- HTTPS + domain routing

This keeps infra cost lean during build phase while preserving a clean path for always-on live trading and future AI/LLM services.

---

## 5) Tech Stack Freeze (M1)

### Backend
- FastAPI
- SQLAlchemy
- Alembic
- PostgreSQL
- Redis
- Celery / Dramatiq
- Pydantic
- httpx
- broker SDK wrappers

### Frontend
- React + Vite + TypeScript
- TanStack Query
- Zustand
- Tailwind
- shadcn/ui

### Infra
- Docker
- Docker Compose
- Nginx
- VPS-ready deployment (Hostinger preferred for production)
- HTTPS deployment

---

## 6) Backend Architecture
```text
auth/
brokers/
  zerodha/
  angelone/
  fyers/
orders/
positions/
instruments/
webhooks/
users/
audit/
core/
```

### Critical Pattern: Broker Interface
```python
class BrokerAdapter:
    connect()
    place_order()
    modify_order()
    cancel_order()
    get_positions()
    get_orders()
    search_instruments()
```

This abstraction is foundational for all future milestones.

---

## 7) UI/UX Direction (Frozen)

### Design Philosophy
- **Overall look and feel:** Angel One inspired
- selectively adopt best UX patterns from **Fyers** for speed-critical trading panels
- selectively adopt **Zerodha** simplicity for clean forms, tables, and low-noise workflows
- UI must remain **light, nimble, professional, and uncluttered** as features grow

### Navigation Model
- **Top navigation bar** replaces SigmaTrader's left-side page rail
- major workspaces live in top-level tabs: Dashboard, Trade, Positions, Orders, Holdings, Brokers, Alerts, Settings
- each top page can expose **internal contextual tabs** for sub-workflows
- related workflows must stay visually close together for rapid maneuvering

### UX Principles
- execution-first workflow with minimal clicks
- related data and actions grouped together
- fast symbol search always accessible from top bar
- contextual drawers/panels for quick order placement
- avoid deep route nesting and unnecessary page switching
- maintain compact spacing and restrained visual weight
- optimized for intuitive and rapid F&O workflows in future milestones

### Recommended Frontend Stack (Frozen)
- React + Vite + TypeScript
- Tailwind CSS
- shadcn/ui
- Zustand
- TanStack Query

## 7.1) Frontend Architecture
```text
modules/
  auth/
  dashboard/
  orders/
  positions/
  watchlist/
  settings/
  brokers/
  webhooks/
```

### Main Screens
- Top Navigation Workspace Shell
- Dashboard
- Broker Settings
- Orders Page
- Positions Page
- Search + Trade Drawer / Modal
- Login
- Dashboard
- Broker Settings
- Orders Page
- Positions Page
- Search + Trade Modal

---

## 7.2) Order Dialog UX Specification (Frozen for M1)

### Visual & Interaction Direction (Angel One Inspired)
The order and positions interaction model should remain **nimble, clean, and low-friction**, inspired by the light execution feel seen in Angel One.

Design principles:
- lightweight centered trade dialog / quick drawer
- compact field grouping with minimal visual noise
- fast Buy / Sell toggles always reachable
- protection fields (SL / TP / TSL) visually grouped in one clean section
- positions row quick actions for Buy, Sell, Exit, Modify, and contextual menu
- quick hover or row-action controls on watchlist / positions for rapid maneuvering
- avoid heavy card stacking and overuse of borders
- maintain clean whitespace and restrained shadows

The implementation must borrow the **interaction speed and cleanliness**, not visually clone the broker UI.

This ticket must feel broker-terminal grade while staying modern and product-owned.

The order ticket is a **core Milestone-1 surface** and must be optimized for speed, safety, and future extensibility.

### Core M1 Decisions
- **Separate order dialogs for Stocks and F&O**
- shared underlying ticket engine for validation, payload normalization, and broker dispatch
- default broker selection must use **last successfully used broker**, persisted per user and preferably per segment (Stocks vs F&O)
- execution safety controls are included in M1: **SL, TP, and TSL**

### Broker Defaulting Behavior
The broker selector should automatically prefill:
- last used stock broker when opening stock ticket
- last used F&O broker when opening F&O ticket
- allow one-click switching to another connected broker

This behavior must feel fast and invisible to the user.

### Protection Controls Strategy
M1 order dialogs must support:
- Stop Loss (SL)
- Take Profit (TP)
- Trailing Stop Loss (TSL)

#### Execution Model (Frozen)
Use a **hybrid protective execution model**:
- prefer **broker-native SL/cover/bracket/GTT style support** where broker APIs reliably support it
- fallback to **internal protective order manager** for unsupported cases and for richer TSL workflows

This ensures:
- lower latency exits when broker-native support exists
- unified UX across Zerodha, Angel One, and Fyers
- portable behavior for future multi-leg and SigmaFNO workflows

### Stock Order Dialog (M1)
Fields:
- broker (default: last used)
- symbol
- quantity
- product: CNC / MIS
- order type: Market / Limit
- limit price (when applicable)
- optional SL
- optional TP
- optional TSL
- Buy / Sell actions
- order preview / confirmation

The stock ticket must prioritize **single-screen, low-click execution**.

### F&O Order Dialog (M1)
Fields:
- broker (default: last used)
- underlying symbol
- expiry
- strike
- CE / PE
- lots / quantity
- product: MIS / NRML
- order type: Market / Limit
- premium / limit price
- optional SL
- optional TP
- optional TSL
- Buy / Sell actions
- order preview / confirmation

The F&O ticket must optimize for **rapid strike and expiry maneuvering** without making the UI heavy.

### Architectural Intent
Although the dialogs are separate, they must be built on a **shared order ticket core engine**.

Shared responsibilities:
- field validation
- broker payload normalization
- margin preview hooks
- SL/TP/TSL normalization
- submit workflow
- preview and confirmation
- error handling and retry surfaces

This shared-core + specialized-shell design is the preferred path for future Milestone-2 multi-leg evolution.

## 7.3) Operational Observability & System Events (Frozen for M1)

A dedicated **System Events workspace** is mandatory in Milestone-1 and is inspired by the proven usefulness of SigmaTrader's event logs.

### Purpose
Provide operational truth for:
- TradingView webhook lifecycle
- broker connectivity and token refresh
- instrument sync jobs
- order dispatch and rejection tracing
- SL / TP / TSL lifecycle events
- retries, fallbacks, and reconciliation
- warnings and error diagnostics

This is critical for user trust and rapid troubleshooting in a multi-broker system.

### UI Placement
- dedicated **top navigation workspace: Events**
- searchable, paginated table
- compact professional log-view experience
- must remain lightweight and readable

### Minimum Columns
- timestamp
- severity
- module
- category
- message
- broker
- symbol
- correlation id
- retry count
- status

### Backend Model
Recommended durable table: `system_events`

Suggested fields:
- id
- timestamp
- level
- source_module
- category
- correlation_id
- broker
- user_id
- symbol
- message
- payload_summary
- retry_count
- metadata_json

### Retention
- **7 days default retention**
- configurable 30–90 days
- cleanup job required
- export and filtering hooks preferred

This observability layer is a first-class M1 capability, not an afterthought.

## 8) API Requirements
```text
POST /auth/login
POST /broker/{broker}/connect
GET /broker/{broker}/status
POST /orders/place
GET /positions
POST /webhooks/tradingview
GET /instruments/search
```

---

## 9) Database Design
Core tables:
- users
- broker_accounts
- broker_sessions
- instruments
- orders
- order_events
- webhook_events
- positions_snapshot
- audit_logs

---

## 10) Acceptance Criteria
Milestone-1 is complete when:

### Manual Stock Flow
- user logs in
- connects broker
- searches INFY
- buys MIS/CNC
- sees position

### Basic F&O Flow
- searches NIFTY CE/PE
- selects strike + expiry
- places order
- sees live position

### TradingView Flow
- alert received
- validated
- dispatched to intended broker
- response persisted

### Multi-Broker Flow
- same user can trade via Zerodha + Angel + Fyers

---

## 11) Deliverables
### Backend
- auth
- multi-broker adapters
- order APIs
- webhook engine
- instrument search
- DB schema

### Frontend
- login
- broker settings
- dashboard
- positions/orders
- search + trade modal

### Infra
- dockerized deployment
- env templates
- Cloudflare/static IP ready

---

## 11.1) Core vs Extensions / Plugin Readiness (Frozen Product Principle)

SigmaTraderPRO is **fundamentally an execution product**.
This principle is frozen and must guide all future milestone decisions.

The long-term health of the product depends on preserving a **trusted execution nucleus** while allowing rich surrounding capabilities to evolve through loosely coupled modules, companion services, and future plugin points.

### A) What Must Remain in the Core Product
The core terminal owns everything required for **safe, professional, and trustworthy live trade execution**.

This includes:
- user authentication and session integrity
- broker connectivity and broker adapters
- instrument search and contract resolution
- stock and F&O order dialogs
- order placement, modification, cancellation
- positions, holdings, and order book
- SL / TP / TSL orchestration
- execution-adjacent strategy management for live positions
- hard risk controls that can veto or constrain live trades
- daily and per-symbol exposure guardrails
- protective exits and adjustment workflows
- system events and operational observability
- broker truth reconciliation
- account settings, preferences, and broker profiles

The core must remain **lean, deterministic, and highly trusted**.
No optional utility should weaken execution reliability.

### B) Execution-Adjacent Modules (Privileged Extensions)
Some future capabilities are close enough to live money workflows that they should remain **execution-adjacent**, even if modularized.

Examples:
- advanced multi-leg strategy management
- spread execution orchestration
- roll, repair, and adjustment workflows
- trade baskets and grouped exits
- advanced live holdings controls
- visual risk management overlays tied to actual positions
- portfolio-level enforcement helpers

These may be implemented as internal modules or privileged extensions, but they must still route through the core execution and risk layers.

### C) Potential Plugin / Companion Workloads
The following capabilities should be **decoupled by design** and integrated through APIs, event streams, companion services, or future plugin slots.

Examples:
- backtesting and simulation engines
- strategy research and optimization labs
- scanners and screeners beyond execution needs
- AI trade research assistants
- Bloomberg-like market intelligence terminals
- news and sentiment analytics
- post-trade journaling and review
- portfolio diagnostics and scenario visualization
- advanced holdings analytics dashboards
- custom research terminals and external data products

These workloads may appear as pages, tabs, or embedded panels inside the SigmaTraderPRO UI, but architecturally they must remain **loosely coupled from the execution nucleus**.

### D) Plugin Readiness Design Principles
The architecture should already preserve future readiness for plugin ecosystems.

#### Extension capabilities
A future plugin or companion system should be able to:
- consume selected market and position context
- publish insights, signals, alerts, and ranked ideas
- register approved UI panels/widgets
- subscribe to selected system events
- call permissioned SigmaTraderPRO APIs
- remain optional and removable without destabilizing the core

#### Control boundaries
Plugins must **never bypass**:
- broker abstraction layer
- risk enforcement
- policy guardrails
- order normalization
- system auditability

All live trade authority must continue to flow through the SigmaTraderPRO core.

### E) Product Governance Principle
Whenever a new feature is proposed, the first architectural question must be:

> **Does this capability directly strengthen safe live execution?**

If **yes**, it belongs in the core or execution-adjacent layer.

If **no**, it should default toward plugin, companion module, or external service integration.

This principle protects SigmaTraderPRO from long-term bloat and preserves its identity as a professional broker-terminal-grade execution product.

## 12) Milestone-2 Preview
Planned future additions:
- advanced F&O terminal
- multi-leg strategy builder
- spreads
- hedging
- SL/TP/TSL
- Greeks
- risk engine
- AI-assisted F&O ideas
- SigmaFNO inference engine

---

## 13) Key Architectural Decision
The single most important Milestone-1 decision:

> Freeze broker abstraction + unified instrument model correctly now.

This ensures Milestone-2 and later SigmaFNO layers can evolve without major rewrites.


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

## 7) Frontend Architecture
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
- Login
- Dashboard
- Broker Settings
- Orders Page
- Positions Page
- Search + Trade Modal

---

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


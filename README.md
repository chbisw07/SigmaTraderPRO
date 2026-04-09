# SigmaTraderPRO

Professional algorithmic trading platform for Indian equities and F&O.

## Milestone-1
Foundation + onboarding + repo/workspace bootstrap.

## Developer workflow (local)

### Infra (Postgres + Redis)
From repo root:

```bash
make infra-up
make infra-ps
```

Stop:

```bash
make infra-down
```

### Backend (FastAPI)
From repo root:

```bash
make backend-install
cp apps/backend/.env.example apps/backend/.env
make backend-run
```

Backend URL:
- `http://127.0.0.1:8000`

Runtime output (local, ignored by git):
- backend logs: `apps/backend/.logs`
- backend CSV audit: `apps/backend/.audit`

Auth endpoints (backend; frontend consumes in S2.2):
- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/refresh`
- `GET /api/v1/auth/me`

Broker endpoints (backend; UI wiring later):
- `GET /api/v1/brokers/status`
- `GET /api/v1/brokers/angel/status`
- `PUT /api/v1/brokers/angel/settings`
- `POST /api/v1/brokers/angel/connect`
- `POST /api/v1/brokers/angel/reconnect`
- `POST /api/v1/brokers/angel/disconnect`
- `GET /api/v1/brokers/zerodha/status`
- `PUT /api/v1/brokers/zerodha/settings`
- `GET /api/v1/brokers/zerodha/login-url`
- `POST /api/v1/brokers/zerodha/connect`
- `POST /api/v1/brokers/zerodha/reconnect`
- `POST /api/v1/brokers/zerodha/disconnect`

Instrument endpoints (backend; UI wiring later):
- `GET /api/v1/instruments/search?q=...`
- `GET /api/v1/instruments/{canonical_id}`
- `GET /api/v1/instruments/derivatives/expiries?underlying=...`
- `GET /api/v1/instruments/derivatives/strikes?underlying=...&expiry=YYYY-MM-DD`
- `GET /api/v1/instruments/derivatives/options?underlying=...&expiry=YYYY-MM-DD&option_type=CE|PE`

### Frontend (Vite)
From repo root:

```bash
make frontend-install
cp apps/frontend/.env.example apps/frontend/.env
make frontend-dev
```

Frontend URL:
- `http://localhost:5173`

Frontend env:
- `apps/frontend/.env` supports `VITE_API_BASE_URL`
  - default: empty (relative URLs via Vite dev proxy to `http://127.0.0.1:8000`)
  - if set: backend must allow CORS for `http://localhost:5173`

Auth (local/dev):
- Create a dev user (backend): `POST /api/v1/auth/register`
- Sign in (frontend): `http://localhost:5173/login`

## Quality gates

Run all checks (lint + tests + frontend build):

```bash
make check
```

Backend only:

```bash
make backend-lint
make backend-test
```

Frontend only:

```bash
make frontend-lint
make frontend-test
make frontend-build
```

## Pre-commit (optional but recommended)
Install `pre-commit` once (example):

```bash
python3 -m pip install pre-commit
```

Then enable hooks:

```bash
make precommit-install
```

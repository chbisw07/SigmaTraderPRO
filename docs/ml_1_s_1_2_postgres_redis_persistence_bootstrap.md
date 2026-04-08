# ML1 → Sprint 1 → S1.2 Postgres + Redis + Persistence Bootstrap

S1.1 is complete.

Now we establish the **data-layer foundation** that later features depend on:
- authentication
- broker integrations
- positions/orders ledger
- risk engine state
- background jobs
- event ingestion
- AI traces / audit / inference persistence

---

## 1) S1.2 objective
Create a local development persistence stack with:
- **PostgreSQL** as primary relational database
- **Redis** for cache / queue / ephemeral coordination
- **backend app skeleton** wired to both
- **environment/config discipline**
- **health-check endpoints**
- **first persistence migration baseline**

This is not yet business logic. This is the **plumbing layer**.

---

## 2) Recommended root structure after S1.2

```text
SigmaTraderPro/
├── apps/
│   ├── backend/
│   │   ├── app/
│   │   │   ├── api/
│   │   │   ├── core/
│   │   │   ├── db/
│   │   │   ├── models/
│   │   │   ├── schemas/
│   │   │   └── main.py
│   │   ├── alembic/
│   │   ├── alembic.ini
│   │   ├── requirements.txt
│   │   └── .env.example
├── infra/
│   └── docker-compose.yml
├── docs/
│   └── implementation_notes/
│       └── ML1_Sprint1.md
└── ...
```

---

## 3) Suggested stack

### Backend
- Python 3.11+
- FastAPI
- Uvicorn
- SQLAlchemy 2.x
- Alembic
- psycopg
- redis-py
- Pydantic settings

### Infra
- PostgreSQL 16
- Redis 7
- Docker Compose

---

## 4) Create backend folders
From repo root:

```bash
mkdir -p apps/backend/app/api
mkdir -p apps/backend/app/core
mkdir -p apps/backend/app/db
mkdir -p apps/backend/app/models
mkdir -p apps/backend/app/schemas
mkdir -p apps/backend/alembic
```

---

## 5) Create Docker Compose for Postgres + Redis
Create `infra/docker-compose.yml`

```yaml
services:
  postgres:
    image: postgres:16
    container_name: sigmatraderpro-postgres
    restart: unless-stopped
    environment:
      POSTGRES_DB: sigmatraderpro
      POSTGRES_USER: sigmatrader
      POSTGRES_PASSWORD: sigmatrader
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U sigmatrader -d sigmatraderpro"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7
    container_name: sigmatraderpro-redis
    restart: unless-stopped
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  postgres_data:
  redis_data:
```

Start services:

```bash
docker compose -f infra/docker-compose.yml up -d
```

Check:

```bash
docker compose -f infra/docker-compose.yml ps
```

---

## 6) Create Python virtual environment for backend

```bash
cd apps/backend
python3 -m venv .venv
source .venv/bin/activate
```

---

## 7) Create `requirements.txt`
Create `apps/backend/requirements.txt`

```txt
fastapi
uvicorn[standard]
sqlalchemy
alembic
psycopg[binary]
redis
pydantic
pydantic-settings
python-dotenv
```

Install:

```bash
pip install -r requirements.txt
```

---

## 8) Create environment template
Create `apps/backend/.env.example`

```env
APP_NAME=SigmaTraderPRO
APP_ENV=development
APP_HOST=127.0.0.1
APP_PORT=8000

DATABASE_URL=postgresql+psycopg://sigmatrader:sigmatrader@127.0.0.1:5432/sigmatraderpro
REDIS_URL=redis://127.0.0.1:6379/0
```

Then create actual local env:

```bash
cp .env.example .env
```

---

## 9) Minimal backend code

### `apps/backend/app/core/config.py`

```python
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "SigmaTraderPRO"
    app_env: str = "development"
    app_host: str = "127.0.0.1"
    app_port: int = 8000
    database_url: str
    redis_url: str

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()
```

### `apps/backend/app/db/session.py`

```python
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.config import settings


engine = create_engine(settings.database_url, pool_pre_ping=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
```

### `apps/backend/app/db/redis_client.py`

```python
import redis

from app.core.config import settings


redis_client = redis.Redis.from_url(settings.redis_url, decode_responses=True)
```

### `apps/backend/app/api/health.py`

```python
from fastapi import APIRouter
from sqlalchemy import text

from app.db.redis_client import redis_client
from app.db.session import engine

router = APIRouter(prefix="/health", tags=["health"])


@router.get("")
def health() -> dict:
    return {"status": "ok"}


@router.get("/ready")
def readiness() -> dict:
    db_ok = False
    redis_ok = False

    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        db_ok = True
    except Exception:
        db_ok = False

    try:
        redis_ok = redis_client.ping() is True
    except Exception:
        redis_ok = False

    return {
        "status": "ready" if db_ok and redis_ok else "degraded",
        "postgres": db_ok,
        "redis": redis_ok,
    }
```

### `apps/backend/app/main.py`

```python
from fastapi import FastAPI

from app.api.health import router as health_router
from app.core.config import settings


app = FastAPI(title=settings.app_name)
app.include_router(health_router)
```

---

## 10) Run backend
From `apps/backend`:

```bash
uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

Test:
- `http://127.0.0.1:8000/health`
- `http://127.0.0.1:8000/health/ready`

Expected:
- `/health` → `{"status":"ok"}`
- `/health/ready` → postgres=true and redis=true

---

## 11) Add Alembic migration baseline
From `apps/backend`:

```bash
alembic init alembic
```

Update `alembic.ini` with your database URL or keep it driven from env in `alembic/env.py`.

Minimal recommended next step:
- wire Alembic to SQLAlchemy metadata
- create an initial empty baseline migration
- commit it so all later schema evolution is tracked from day one

For S1.2, even an empty baseline migration is acceptable if the app boots and DB connectivity is proven.

---

## 12) Update implementation notes
Append to `docs/implementation_notes/ML1_Sprint1.md`

```markdown
## S1.2 Postgres + Redis + Persistence Bootstrap

### Completed
- Added docker compose for PostgreSQL and Redis
- Established backend app skeleton
- Added environment/config discipline
- Wired SQLAlchemy engine and Redis client
- Added health and readiness endpoints
- Initialized migration discipline with Alembic

### Important highlights
- First durable persistence layer established
- Data services can now support auth, broker state, orders, and audit trails
- Redis available for cache/queue/coordination workflows
- Migration discipline started before business tables

### Next
- S1.3 backend domain models + first schema tables
- S1.4 frontend shell / admin console bootstrap
```

---

## 13) Commit checkpoint
From repo root:

```bash
git add .
git commit -m "S1.2: bootstrap postgres redis and backend persistence foundation"
```

---

## 14) Definition of done for S1.2
S1.2 is done when all of the below are true:

- Docker containers for Postgres and Redis are healthy
- backend virtualenv is created
- dependencies install successfully
- `.env` is in place
- FastAPI boots successfully
- `/health/ready` returns postgres=true and redis=true
- Alembic is initialized
- implementation notes are updated
- git commit is created

---

## 15) Recommended execution order right now

1. Create backend folders
2. Add docker compose
3. Start Postgres + Redis
4. Create backend venv
5. Install requirements
6. Add `.env.example` and `.env`
7. Add minimal FastAPI/config/db code
8. Run backend and verify readiness
9. Initialize Alembic
10. Update implementation notes
11. Commit

---

## 16) Practical note
At this stage, keep it **boringly reliable**. Do not jump to auth, broker adapters, or domain tables until this stack is stable.

S1.2 is about proving:
- local infra reproducibility
- deterministic backend boot
- persistence connectivity discipline
- migration discipline from day one


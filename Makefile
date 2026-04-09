.PHONY: help
help:
	@echo "SigmaTraderPRO — developer commands"
	@echo ""
	@echo "Infra:"
	@echo "  make infra-up        Start Postgres+Redis"
	@echo "  make infra-down      Stop Postgres+Redis"
	@echo "  make infra-ps        Show infra status"
	@echo ""
	@echo "Backend:"
	@echo "  make backend-venv    Create backend venv"
	@echo "  make backend-install Install backend deps"
	@echo "  make backend-run     Run backend (uvicorn)"
	@echo "  make backend-lint    Ruff lint + format check"
	@echo "  make backend-fmt     Ruff format"
	@echo "  make backend-test    Pytest"
	@echo "  make backend-migrate Alembic upgrade head"
	@echo ""
	@echo "Frontend:"
	@echo "  make frontend-install Install frontend deps"
	@echo "  make frontend-dev     Run frontend (vite)"
	@echo "  make frontend-lint    ESLint"
	@echo "  make frontend-test    Vitest smoke test"
	@echo "  make frontend-build   Vite build"
	@echo ""
	@echo "Quality:"
	@echo "  make lint            Lint backend+frontend"
	@echo "  make test            Test backend+frontend"
	@echo "  make check           Lint+test+frontend build"
	@echo "  make fmt             Format backend"
	@echo ""
	@echo "Pre-commit (requires pre-commit installed):"
	@echo "  make precommit-install"
	@echo "  make precommit-run"

COMPOSE_FILE := infra/docker-compose.yml
BACKEND_DIR := apps/backend
FRONTEND_DIR := apps/frontend

.PHONY: infra-up infra-down infra-ps
infra-up:
	docker compose -f $(COMPOSE_FILE) up -d

infra-down:
	docker compose -f $(COMPOSE_FILE) down

infra-ps:
	docker compose -f $(COMPOSE_FILE) ps

.PHONY: backend-venv backend-install backend-run backend-lint backend-fmt backend-test
.PHONY: backend-migrate
backend-venv:
	cd $(BACKEND_DIR) && [ -d .venv ] || python3 -m venv .venv

backend-install: backend-venv
	cd $(BACKEND_DIR) && . .venv/bin/activate && python -m pip install -U pip && pip install -r requirements.txt -r requirements-dev.txt

backend-run:
	cd $(BACKEND_DIR) && . .venv/bin/activate && uvicorn app.main:app --reload --host 127.0.0.1 --port 8000

backend-lint:
	cd $(BACKEND_DIR) && . .venv/bin/activate && ruff check . && ruff format --check .

backend-fmt:
	cd $(BACKEND_DIR) && . .venv/bin/activate && ruff format .

backend-test:
	cd $(BACKEND_DIR) && . .venv/bin/activate && pytest

backend-migrate:
	cd $(BACKEND_DIR) && . .venv/bin/activate && alembic -c alembic.ini upgrade head

.PHONY: frontend-install frontend-dev frontend-lint frontend-test frontend-build
frontend-install:
	cd $(FRONTEND_DIR) && npm install

frontend-dev:
	cd $(FRONTEND_DIR) && npm run dev

frontend-lint:
	cd $(FRONTEND_DIR) && npm run lint

frontend-test:
	cd $(FRONTEND_DIR) && npm run test:run

frontend-build:
	cd $(FRONTEND_DIR) && npm run build

.PHONY: lint test check
lint: backend-lint frontend-lint

test: backend-test frontend-test

check: lint test frontend-build

.PHONY: fmt
fmt: backend-fmt

.PHONY: precommit-install precommit-run
precommit-install:
	pre-commit install

precommit-run:
	pre-commit run -a

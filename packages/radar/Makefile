.PHONY: up down logs test test-backend test-frontend smoke lint lint-backend lint-frontend migrate migration shell-api shell-db clean

up:
	docker compose up --build -d

down:
	docker compose down

logs:
	docker compose logs -f

test: test-backend test-frontend

test-backend:
	docker compose exec api pytest

test-frontend:
	docker compose exec web pnpm test

# End to end against the real stack. Out of `make test` on purpose: it needs a
# live PostgreSQL and takes seconds rather than milliseconds, and a suite that
# is slow on every push is one people learn to skip.
smoke:
	docker compose up -d db
	cd backend && DATABASE_URL=postgresql+asyncpg://radar_user:radar_dev_password@localhost:5432/karajan_radar \
		uv run pytest tests/smoke -m smoke -p no:cacheprovider

lint: lint-backend lint-frontend

lint-backend:
	docker compose exec api ruff check .
	docker compose exec api mypy app/

lint-frontend:
	docker compose exec web pnpm lint

migrate:
	docker compose exec api alembic upgrade head

migration:
	docker compose exec api alembic revision --autogenerate -m "$(MSG)"

shell-api:
	docker compose exec api bash

shell-db:
	docker compose exec db psql -U radar_user -d karajan_radar

clean:
	docker compose down -v --remove-orphans

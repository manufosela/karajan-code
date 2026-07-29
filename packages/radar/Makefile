.PHONY: up down logs test test-backend test-frontend lint lint-backend lint-frontend migrate migration shell-api shell-db clean

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
	docker compose exec db psql -U ofr_user -d ortho_frontier_radar

clean:
	docker compose down -v --remove-orphans

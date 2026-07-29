# Ortho Frontier Radar - Project Instructions

## Stack
- Backend: Python 3.12+ / FastAPI / SQLAlchemy 2.0 / Alembic / PostgreSQL
- Frontend: Next.js 14+ / TypeScript / Tailwind CSS
- Testing: pytest (backend), vitest (frontend)
- Package managers: uv (backend), pnpm (frontend)

## Development
- Run `make up` to start all services
- Run `make test` to run all tests
- Run `make lint` to lint everything
- Backend API: http://localhost:8000
- Frontend: http://localhost:3000
- Database: postgresql://ofr_user:ofr_dev_password@localhost:5432/ortho_frontier_radar

## Conventions
- Conventional Commits: feat/fix/refactor/test/docs/chore
- Branch naming: feat/OFR-TSK-XXXX-short-desc or fix/OFR-BUG-XXXX-short-desc
- TDD: tests first, then implementation
- PRs < 300 lines changed
- Never commit .env files or API keys

## Testing
- Backend: `cd backend && pytest`
- Frontend: `cd frontend && pnpm test`
- Coverage: backend services 80%+, frontend components 70%+

## Architecture
- See docs/architecture.md for full architecture
- See docs/tdd-quality-strategy.md for quality strategy
- See docs/mvp-user-stories.md for user stories
- See database/schema.sql for database schema reference

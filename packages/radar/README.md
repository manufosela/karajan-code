# Ortho Frontier Radar

**Strategic Research Intelligence for Geniova Technologies**

Ortho Frontier Radar is an internal platform that automates the monitoring, analysis, and synthesis of scientific literature in orthodontics and dentistry. It helps the clinical and R&D teams at Geniova stay ahead of emerging technologies, materials, and techniques by transforming raw research data into actionable strategic insights.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Python 3.12, FastAPI, SQLAlchemy 2.0, Alembic |
| Frontend | Next.js 14, TypeScript, Tailwind CSS |
| Database | PostgreSQL 16 |
| Testing | pytest, vitest |
| Package Managers | uv (backend), pnpm (frontend) |
| Infrastructure | Docker, Docker Compose, GitHub Actions |

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) (v24+)
- [Docker Compose](https://docs.docker.com/compose/install/) (v2+)
- [Git](https://git-scm.com/)

For local development without Docker:
- Python 3.12+ and [uv](https://docs.astral.sh/uv/)
- Node.js 20+ and [pnpm](https://pnpm.io/)
- PostgreSQL 16

## Quick Start

```bash
# Clone the repository
git clone git@github.com:AntonioPF/ortho-frontier-radar.git
cd ortho-frontier-radar

# Set up environment variables
cp .env.example .env

# Start all services
make up
```

Once running:
- Frontend: http://localhost:3000
- Backend API: http://localhost:8000
- API Docs (Swagger): http://localhost:8000/docs

## Development

### Make Commands

| Command | Description |
|---------|-------------|
| `make up` | Build and start all services |
| `make down` | Stop all services |
| `make logs` | Follow logs from all services |
| `make test` | Run backend and frontend tests |
| `make test-backend` | Run backend tests only |
| `make test-frontend` | Run frontend tests only |
| `make lint` | Lint backend and frontend |
| `make migrate` | Apply database migrations |
| `make migration MSG="description"` | Create a new migration |
| `make shell-api` | Open a bash shell in the API container |
| `make shell-db` | Open a psql shell in the database |
| `make clean` | Stop services and remove volumes |

### Testing

```bash
# All tests
make test

# Backend only
make test-backend

# Frontend only
make test-frontend
```

### Linting

```bash
# All linting
make lint

# Backend: ruff + mypy
make lint-backend

# Frontend: eslint
make lint-frontend
```

## Architecture

The system follows a modular architecture with clear separation of concerns:

- **Ingestion Layer** -- Collects articles from PubMed, Semantic Scholar, CrossRef, and other scientific databases
- **Processing Layer** -- Uses LLMs to analyze, classify, and extract insights from research papers
- **Storage Layer** -- PostgreSQL with structured schema for articles, analyses, trends, and alerts
- **Presentation Layer** -- Next.js dashboard with trend visualizations, alerts, and synthesis reports
- **Notification Layer** -- Microsoft Teams integration for automated alerts on key findings

For the full architecture documentation, see [docs/architecture.md](docs/architecture.md).

## Project Structure

```
ortho-frontier-radar/
├── backend/                # FastAPI backend
│   ├── app/
│   │   ├── api/            # API routes (v1)
│   │   ├── core/           # Config, security, dependencies
│   │   ├── models/         # SQLAlchemy models
│   │   ├── schemas/        # Pydantic schemas
│   │   ├── services/       # Business logic
│   │   └── main.py         # App entry point
│   ├── tests/              # pytest tests
│   ├── alembic/            # Database migrations
│   └── Dockerfile
├── frontend/               # Next.js frontend
│   ├── src/
│   │   ├── app/            # App router pages
│   │   ├── components/     # React components
│   │   ├── lib/            # Utilities and API client
│   │   └── types/          # TypeScript types
│   ├── tests/              # vitest tests
│   └── Dockerfile
├── database/               # SQL schema reference
├── docs/                   # Architecture and design docs
├── .github/                # CI workflows and PR template
├── docker-compose.yml      # Service orchestration
├── Makefile                # Development commands
└── sonar-project.properties
```

## Contributing

1. **Branch from main**: Create a feature or fix branch following the naming convention:
   - Features: `feat/OFR-TSK-XXXX-short-description`
   - Fixes: `fix/OFR-BUG-XXXX-short-description`

2. **Write tests first**: Follow TDD -- write failing tests, then implement.

3. **Use Conventional Commits**:
   - `feat:` new feature
   - `fix:` bug fix
   - `refactor:` code restructuring
   - `test:` adding or updating tests
   - `docs:` documentation changes
   - `chore:` maintenance tasks

4. **Keep PRs small**: Aim for fewer than 300 lines changed per PR.

5. **Ensure quality**: All tests pass, linting is clean, no new warnings.

## License

Proprietary - Geniova Technologies. All rights reserved.

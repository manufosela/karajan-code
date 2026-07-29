# Frontier Radar

**Configurable strategic research intelligence**

Frontier Radar monitors the frontier of a field — whatever field you point it at — and turns raw sources into ranked, summarised, actionable signals. It ingests from configured connectors, classifies and scores each item with an LLM, and delivers digests to the people who need them.

What makes it reusable is the **Radar Profile**: a single YAML file that declares the domain. Themes, strategic buckets, vocabularies, prompts, sources and branding all live there. Watching orthodontic research and watching energy policy are the same code with different profiles — no fork, no prompt rewriting.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Python 3.12, FastAPI, SQLAlchemy 2.0, Alembic |
| Frontend | Next.js 14, TypeScript, Tailwind CSS |
| Database | PostgreSQL 16 |
| LLM | OpenAI, Anthropic, or Ollama (local, no API key) |
| Testing | pytest, vitest |
| Package Managers | uv (backend), pnpm (frontend) |
| Infrastructure | Docker, Docker Compose, GitHub Actions |

## Quick Start

```bash
cp .env.example .env
make up
```

- Frontend: http://localhost:3000
- Backend API: http://localhost:8000
- API Docs (Swagger): http://localhost:8000/docs

## Radar Profiles

A profile lives in `backend/profiles/<id>.yaml` and is selected with the `ACTIVE_PROFILE` environment variable. The bundled `orthodontics` profile doubles as a worked example.

```yaml
id: my-domain
name: My Domain Radar
organization:
  name: Acme Corp
  description: a company that makes widgets
  analyst_role: an expert widget research analyst

taxonomy:
  themes:
    - id: materials
      label: Materials
      description: Novel materials, coatings and composites.
  strategic_buckets: [...]
  time_horizons: [...]

sources:
  - connector: pubmed
    query: widgets OR gadgets

prompts:
  classification:
    required_variables: [analyst_role, themes, id, description, title, abstract, theme_ids_csv]
    template: |
      You are {{analyst_role}}...
      {{#themes}}
      - {{id}}: {{description}}
      {{/themes}}
```

Profiles are validated on load: scoring weights must sum to 1.0, ids must be unique, and every template variable must be both declared and used. A malformed profile fails at startup rather than producing degraded classifications later.

Prompts use Mustache (`{{variable}}`), so the JSON output schemas they embed need no brace escaping. Tags used inside a section (`{{id}}` within `{{#themes}}`) resolve per item; tags outside one must be supplied by the caller.

### Switching domain

1. Write `backend/profiles/<id>.yaml`.
2. Set `ACTIVE_PROFILE=<id>`.
3. Set the frontend build arguments: `NEXT_PUBLIC_APP_NAME`, `NEXT_PUBLIC_APP_SHORT_NAME`, `NEXT_PUBLIC_APP_TAGLINE`, `NEXT_PUBLIC_ORGANIZATION_NAME`.
4. Add connectors if the domain needs sources the bundled ones do not cover.

## Running against a local model

Ollama needs no API key and costs nothing per token, which matters when reprocessing a corpus during development:

```yaml
llm:
  provider: ollama
  default_model: llama3.1
  fast_model: llama3.1
```

Set `OLLAMA_BASE_URL` if the server is not at `http://localhost:11434`.

## Development

| Command | Description |
|---------|-------------|
| `make up` | Build and start all services |
| `make down` | Stop all services |
| `make logs` | Follow logs from all services |
| `make test` | Run backend and frontend tests |
| `make lint` | Lint backend and frontend |
| `make migrate` | Apply database migrations |
| `make migration MSG="description"` | Create a new migration |
| `make shell-api` | Open a bash shell in the API container |
| `make shell-db` | Open a psql shell in the database |
| `make clean` | Stop services and remove volumes |

## Architecture

- **Ingestion** — connectors pull from configured sources
- **Processing** — an LLM classifies, scores and summarises each item against the active profile
- **Storage** — PostgreSQL, with structured records for items, analyses, trends and alerts
- **Presentation** — a Next.js dashboard with trends, alerts and synthesis reports
- **Notification** — webhook delivery for automated alerts

See [docs/architecture.md](docs/architecture.md).

```
frontier-radar/
├── backend/
│   ├── app/
│   │   ├── api/            # API routes (v1)
│   │   ├── connectors/     # Source connectors
│   │   ├── core/           # Config, security, dependencies
│   │   ├── llm/            # LLM providers
│   │   ├── models/         # SQLAlchemy models
│   │   ├── profiles/       # Radar Profile schema, loader, renderer
│   │   ├── schemas/        # Pydantic schemas
│   │   └── services/       # Business logic
│   ├── profiles/           # Radar Profile definitions (YAML)
│   ├── tests/
│   └── alembic/
├── frontend/
├── database/               # SQL schema reference
├── docs/
└── docker-compose.yml
```

## Configuration

Deployment-specific values belong in the environment, never in source:

| Variable | Purpose |
|----------|---------|
| `ACTIVE_PROFILE` | Which Radar Profile this instance runs |
| `PROFILES_DIR` | Where to look for profiles (defaults to the bundled ones) |
| `ALLOWED_ORIGINS` | CORS origins for this deployment |
| `SCHEDULER_JOB_NAME` | Fully qualified Cloud Scheduler job to keep in sync; unset disables the integration |
| `APP_SECRET_KEY` | Required; no default |

## Contributing

1. Branch from `main`: `feat/FRD-TSK-XXXX-short-description` or `fix/FRD-BUG-XXXX-...`
2. Write tests first.
3. Use Conventional Commits.
4. Keep PRs under ~300 lines changed.
5. All tests pass, linting clean, no new warnings.

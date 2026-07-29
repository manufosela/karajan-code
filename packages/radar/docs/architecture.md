# Frontier Radar - Architecture Document

## 1. Vision

Frontier Radar (OFR) is a strategic research intelligence system for the organization it is configured for. It automatically detects, classifies, scores, and converts cutting-edge research signals from global scientific sources into actionable strategic insights.

**It is NOT a paper aggregator.** It is an opinionated, configurable radar that answers:
- What advances truly matter for the organization?
- What could affect product, clinic, operations, or R&D?
- What deserves monitoring?
- What is an opportunity or a competitive threat?

## 2. System Overview

```
                    ┌─────────────────────────────────────┐
                    │         Cloud Scheduler              │
                    │    (daily trigger 06:00 UTC)         │
                    └──────────────┬──────────────────────┘
                                   │
                    ┌──────────────▼──────────────────────┐
                    │      Cloud Run Job: Ingestion        │
                    │                                      │
                    │  ┌───────────┐  ┌────────────────┐  │
                    │  │ Connectors│→ │ Normalization   │  │
                    │  │ (PubMed,  │  │ & Deduplication │  │
                    │  │  arXiv,   │  └───────┬────────┘  │
                    │  │  CT.gov,  │          │           │
                    │  │  Crossref,│  ┌───────▼────────┐  │
                    │  │  S.Scholar│  │ LLM Classify +  │  │
                    │  └───────────┘  │ Score + Insight  │  │
                    │                 └───────┬────────┘  │
                    └─────────────────────────┼───────────┘
                                              │
                    ┌─────────────────────────▼───────────┐
                    │         Cloud SQL PostgreSQL          │
                    │  (research_items, sources, config,    │
                    │   ingestion_runs, daily_digests)      │
                    └───────┬─────────────────┬───────────┘
                            │                 │
             ┌──────────────▼──────┐  ┌───────▼───────────┐
             │ Cloud Run: FastAPI  │  │ Cloud Run Job:     │
             │ Backend API         │  │ Daily Digest       │
             │ /api/v1/*           │  │                    │
             └──────────┬─────────┘  │ → Teams Webhook    │
                        │            └────────────────────┘
             ┌──────────▼─────────┐
             │ Cloud Run: Next.js  │
             │ Dashboard           │
             │ (SSR + Client)      │
             └─────────────────────┘
```

## 3. Architecture Decisions

### ADR-001: Monolith Modular over Microservices
- **Decision:** Single monorepo with `backend/` and `frontend/` as separate deployable units. No microservices.
- **Why:** MVP scope doesn't justify the operational overhead of microservices. Cloud Run already gives us independent scaling per service.
- **Trade-off:** Less isolation between modules, but simpler deployment, debugging, and development.

### ADR-002: SQLAlchemy 2.0 + Alembic for ORM/Migrations
- **Decision:** SQLAlchemy 2.0 with async support and Alembic for migrations.
- **Why:** Most mature, battle-tested ORM for Python. Native async, excellent PostgreSQL support, widely understood. Alembic provides reliable schema versioning.
- **Alternatives considered:** Tortoise ORM (less mature), raw SQL (harder to maintain), Prisma (Python support experimental).

### ADR-003: Cloud Run Jobs for Batch Processing
- **Decision:** Use Cloud Run Jobs (not Cloud Functions) for ingestion and digest generation.
- **Why:** Jobs can run up to 24h, have better resource control, share the same codebase and Docker image as the API. Simpler than maintaining separate Cloud Functions.

### ADR-004: Abstract LLM Provider Layer
- **Decision:** All LLM interactions go through an abstract `LLMProvider` interface.
- **Why:** Decouples business logic from any specific provider. Enables switching between OpenAI and Claude, A/B testing, fallback strategies, and future provider additions without touching business code.

### ADR-005: Structured JSON LLM Output with Anti-Hallucination Guards
- **Decision:** All LLM prompts enforce structured JSON output, separate facts from interpretation, and require uncertainty declaration.
- **Why:** Core requirement. Scientific integrity demands traceability. Every LLM output is auditable with raw input/output stored.

### ADR-006: Configuration-Driven System
- **Decision:** All scoring weights, thematic filters, sources, delivery settings stored in `configuration` table and editable from UI.
- **Why:** The system must be iterable without code changes. Strategic criteria evolve as the team learns what signals matter.

### ADR-007: Next.js with App Router
- **Decision:** Next.js 14+ with App Router, TypeScript, Tailwind CSS.
- **Why:** Best DX for React-based dashboards. SSR for initial load performance. Tailwind for rapid, consistent UI development.

### ADR-008: Pydantic for Schema Validation
- **Decision:** Pydantic v2 for all data validation, API schemas, and internal data transfer objects.
- **Why:** Native FastAPI integration, excellent performance in v2, JSON Schema generation, type safety.

## 4. Component Architecture

### 4.1 Source Connectors (`app/connectors/`)
- Abstract `BaseConnector` with `fetch()`, `parse()`, `normalize()` contract
- Each source is a plugin: PubMed, arXiv, ClinicalTrials, Crossref, Semantic Scholar
- `ConnectorRegistry` for dynamic discovery and configuration
- Rate limiting per connector, retry with exponential backoff
- Prepared for future: journals, authors, RSS, patents

### 4.2 Ingestion Pipeline (`app/pipeline/`)
- **Normalization:** Title cleaning, author parsing, date standardization
- **Deduplication:** Content hash (SHA-256 of normalized title + abstract), DOI match, fuzzy title matching
- **Orchestrator:** Runs enabled connectors, normalizes, deduplicates, persists raw items
- Each stage is independent and testable

### 4.3 LLM Layer (`app/llm/`)
- `LLMProvider` abstract interface
- `OpenAIProvider` and `ClaudeProvider` implementations
- Versioned prompts in `app/llm/prompts/v1/`
- Operations: `classify_document()`, `score_document()`, `generate_strategic_insight()`
- All calls logged with full input/output for auditability

### 4.4 Classification & Scoring (`app/pipeline/`)
- Thematic classification → assigns tags from configured taxonomy
- Strategic bucket classification → maps to 7 business areas
- Scientific strength score → evidence quality assessment
- Strategic relevance score → weighted multi-criteria with configurable weights
- Both scores include structured reasons (explainability)

### 4.5 Insight Generation (`app/pipeline/`)
- Executive summaries in EN + ES
- "Why it matters" analysis
- "Possible impact" assessment
- Hype risk detection
- Time horizon estimation
- Recommended action

### 4.6 Delivery (`app/delivery/`)
- Daily digest builder: selects top N signals above threshold
- Teams webhook integration (desacoplado, configurable)
- Payload formatting with links to dashboard and original sources

### 4.7 API (`app/api/`)
- REST API under `/api/v1/`
- Endpoints for signals (CRUD, filters, pagination), configuration, sources, analytics
- Health check and readiness probes
- Structured error responses, request ID tracing

### 4.8 Frontend (`frontend/`)
- Signal inbox (main view)
- Detail view with full traceability
- Configuration panels
- Analytics/trends views
- Bilingual content (generated content in EN+ES, UI in Spanish)

## 5. Folder Structure

```
frontier-radar/
├── backend/
│   ├── alembic/
│   │   ├── versions/
│   │   ├── env.py
│   │   └── script.py.mako
│   ├── app/
│   │   ├── __init__.py
│   │   ├── main.py                    # FastAPI application factory
│   │   ├── api/
│   │   │   ├── __init__.py
│   │   │   ├── deps.py                # Dependency injection
│   │   │   └── v1/
│   │   │       ├── __init__.py
│   │   │       ├── router.py          # Main v1 router
│   │   │       ├── signals.py         # Research items endpoints
│   │   │       ├── sources.py         # Source management endpoints
│   │   │       ├── configuration.py   # Config endpoints
│   │   │       └── analytics.py       # Trends/analytics endpoints
│   │   ├── core/
│   │   │   ├── __init__.py
│   │   │   ├── config.py              # Settings (pydantic-settings)
│   │   │   ├── database.py            # Async engine, session factory
│   │   │   └── logging.py             # Structured logging setup
│   │   ├── models/
│   │   │   ├── __init__.py
│   │   │   ├── base.py                # SQLAlchemy base model
│   │   │   ├── research_item.py
│   │   │   ├── source.py
│   │   │   ├── configuration.py
│   │   │   ├── ingestion_run.py
│   │   │   └── daily_digest.py
│   │   ├── schemas/
│   │   │   ├── __init__.py
│   │   │   ├── research_item.py       # Pydantic schemas
│   │   │   ├── source.py
│   │   │   ├── configuration.py
│   │   │   ├── analytics.py
│   │   │   └── common.py              # Shared schemas (pagination, errors)
│   │   ├── connectors/
│   │   │   ├── __init__.py
│   │   │   ├── base.py                # BaseConnector ABC
│   │   │   ├── registry.py            # ConnectorRegistry
│   │   │   ├── pubmed.py
│   │   │   ├── arxiv.py
│   │   │   ├── clinical_trials.py
│   │   │   ├── crossref.py
│   │   │   └── semantic_scholar.py
│   │   ├── pipeline/
│   │   │   ├── __init__.py
│   │   │   ├── normalization.py
│   │   │   ├── deduplication.py
│   │   │   ├── classification.py
│   │   │   ├── scoring.py
│   │   │   ├── insight_generation.py
│   │   │   └── orchestrator.py        # Full pipeline orchestration
│   │   ├── llm/
│   │   │   ├── __init__.py
│   │   │   ├── base.py                # LLMProvider ABC
│   │   │   ├── openai_provider.py
│   │   │   ├── claude_provider.py
│   │   │   └── prompts/
│   │   │       ├── __init__.py
│   │   │       ├── registry.py        # Prompt version management
│   │   │       └── v1/
│   │   │           ├── __init__.py
│   │   │           ├── classify.py
│   │   │           ├── score.py
│   │   │           └── insight.py
│   │   └── delivery/
│   │       ├── __init__.py
│   │       ├── digest.py              # Digest builder
│   │       └── teams.py               # Teams webhook sender
│   ├── jobs/
│   │   ├── __init__.py
│   │   ├── daily_ingestion.py         # Cloud Run Job entry point
│   │   └── daily_digest.py            # Cloud Run Job entry point
│   ├── tests/
│   │   ├── __init__.py
│   │   ├── conftest.py                # Shared fixtures, test DB
│   │   ├── unit/
│   │   │   ├── __init__.py
│   │   │   ├── test_normalization.py
│   │   │   ├── test_deduplication.py
│   │   │   ├── test_scoring.py
│   │   │   ├── test_classification.py
│   │   │   ├── test_connectors/
│   │   │   │   ├── test_pubmed.py
│   │   │   │   ├── test_arxiv.py
│   │   │   │   ├── test_clinical_trials.py
│   │   │   │   ├── test_crossref.py
│   │   │   │   └── test_semantic_scholar.py
│   │   │   ├── test_llm/
│   │   │   │   ├── test_prompts.py
│   │   │   │   └── test_providers.py
│   │   │   └── test_api/
│   │   │       ├── test_signals.py
│   │   │       ├── test_health.py
│   │   │       └── test_configuration.py
│   │   ├── integration/
│   │   │   ├── __init__.py
│   │   │   ├── test_pipeline.py
│   │   │   └── test_ingestion.py
│   │   └── fixtures/
│   │       ├── pubmed_response.xml
│   │       ├── arxiv_response.xml
│   │       ├── clinical_trials_response.json
│   │       ├── crossref_response.json
│   │       ├── semantic_scholar_response.json
│   │       └── mock_research_items.json
│   ├── alembic.ini
│   ├── pyproject.toml
│   ├── Dockerfile
│   └── Dockerfile.jobs
├── frontend/
│   ├── src/
│   │   ├── app/
│   │   │   ├── layout.tsx
│   │   │   ├── page.tsx               # Dashboard home / signal inbox
│   │   │   ├── signals/
│   │   │   │   ├── page.tsx           # Signal list with filters
│   │   │   │   └── [id]/
│   │   │   │       └── page.tsx       # Signal detail
│   │   │   ├── configuration/
│   │   │   │   ├── page.tsx           # Configuration hub
│   │   │   │   ├── sources/page.tsx
│   │   │   │   ├── themes/page.tsx
│   │   │   │   ├── scoring/page.tsx
│   │   │   │   └── delivery/page.tsx
│   │   │   └── analytics/
│   │   │       └── page.tsx           # Trends and analytics
│   │   ├── components/
│   │   │   ├── layout/
│   │   │   │   ├── Sidebar.tsx
│   │   │   │   ├── Header.tsx
│   │   │   │   └── Footer.tsx
│   │   │   ├── signals/
│   │   │   │   ├── SignalCard.tsx
│   │   │   │   ├── SignalTable.tsx
│   │   │   │   ├── SignalFilters.tsx
│   │   │   │   ├── SignalDetail.tsx
│   │   │   │   ├── ScoreBadge.tsx
│   │   │   │   └── StatusBadge.tsx
│   │   │   ├── configuration/
│   │   │   │   ├── SourceToggle.tsx
│   │   │   │   ├── KeywordEditor.tsx
│   │   │   │   ├── WeightSlider.tsx
│   │   │   │   └── DeliverySettings.tsx
│   │   │   ├── analytics/
│   │   │   │   ├── TrendChart.tsx
│   │   │   │   └── BucketDistribution.tsx
│   │   │   └── ui/                    # Shared UI primitives
│   │   │       ├── Badge.tsx
│   │   │       ├── Card.tsx
│   │   │       ├── Modal.tsx
│   │   │       └── Toast.tsx
│   │   ├── lib/
│   │   │   ├── api.ts                 # API client
│   │   │   └── utils.ts
│   │   ├── hooks/
│   │   │   ├── useSignals.ts
│   │   │   ├── useConfiguration.ts
│   │   │   └── useAnalytics.ts
│   │   └── types/
│   │       ├── signal.ts
│   │       ├── source.ts
│   │       ├── configuration.ts
│   │       └── analytics.ts
│   ├── tests/
│   │   ├── components/
│   │   └── hooks/
│   ├── public/
│   ├── package.json
│   ├── pnpm-lock.yaml
│   ├── tsconfig.json
│   ├── next.config.ts
│   ├── tailwind.config.ts
│   ├── postcss.config.js
│   ├── vitest.config.ts
│   └── Dockerfile
├── database/
│   └── schema.sql                     # Reference schema (source of truth for Alembic)
├── docs/
│   ├── architecture.md                # This document
│   ├── mvp-user-stories.md
│   └── tdd-quality-strategy.md
├── .github/
│   └── workflows/
│       ├── ci-backend.yml
│       └── ci-frontend.yml
├── docker-compose.yml
├── Makefile
├── .env.example
├── .gitignore
├── sonar-project.properties
├── CLAUDE.md
└── README.md
```

## 6. Data Flow

### Ingestion Pipeline (Daily)
```
Cloud Scheduler → Cloud Run Job (daily_ingestion.py)
  │
  ├─ For each enabled source:
  │   ├─ Connector.fetch() → raw data from API
  │   ├─ Connector.parse() → list of raw items
  │   └─ Connector.normalize() → NormalizedPaper objects
  │
  ├─ Normalization Service
  │   ├─ Clean titles (strip HTML, normalize whitespace)
  │   ├─ Parse authors (name, affiliation)
  │   └─ Standardize dates (ISO 8601)
  │
  ├─ Deduplication Service
  │   ├─ Compute content_hash (SHA-256)
  │   ├─ Check DOI duplicates
  │   └─ Fuzzy title matching (threshold 0.92)
  │
  ├─ Persist raw items to research_items (status: review)
  │
  ├─ LLM Classification (for new items)
  │   ├─ classify_document() → thematic_tags, strategic_buckets, document_type
  │   ├─ score_document() → scientific_strength, strategic_relevance (with reasons)
  │   └─ generate_strategic_insight() → summaries, impact, hype, action
  │
  └─ Log ingestion_run with statistics
```

### Daily Digest (After Ingestion)
```
Cloud Scheduler → Cloud Run Job (daily_digest.py)
  │
  ├─ Query top N items above threshold (strategic_relevance_score >= X)
  ├─ Build digest payload (structured JSON → formatted message)
  ├─ Send to Teams via webhook
  └─ Log daily_digest record
```

## 7. Security

- All secrets in GCP Secret Manager (API keys, DB credentials, webhook URLs)
- No credentials in code or Docker images
- CORS configured per environment
- API rate limiting (future: auth for dashboard)
- Input validation on all endpoints (Pydantic)
- SQL injection prevention (SQLAlchemy parameterized queries)
- XSS prevention (React auto-escaping + CSP headers)

## 8. Observability

- Structured JSON logging (structlog)
- Request ID tracing (X-Request-ID header)
- Health/readiness endpoints for Cloud Run
- Ingestion run statistics (items fetched, new, duplicate, errors)
- LLM audit trail (raw input/output stored per item)

## 9. Deployment

- **API:** Cloud Run service (autoscaling, min 0 instances)
- **Frontend:** Cloud Run service (Next.js standalone build)
- **Ingestion Job:** Cloud Run Job triggered by Cloud Scheduler (daily)
- **Digest Job:** Cloud Run Job triggered by Cloud Scheduler (after ingestion)
- **Database:** Cloud SQL PostgreSQL (production) / Docker PostgreSQL (development)
- **CI/CD:** GitHub Actions → build → test → deploy to Cloud Run

## 10. MVP Scope

**In scope:**
- 5 core source connectors (PubMed, arXiv, ClinicalTrials, Crossref, Semantic Scholar)
- Full ingestion pipeline with normalization and deduplication
- LLM classification, scoring, and insight generation
- Dashboard with signal inbox, detail view, filters
- Configuration UI for sources, themes, scoring, delivery
- Teams daily digest
- Full traceability and anti-hallucination guards

**Out of scope for MVP:**
- University-specific scrapers
- Patent search
- Author/lab tracking
- User authentication
- Multi-tenant support
- Advanced NLP clustering
- Real-time streaming

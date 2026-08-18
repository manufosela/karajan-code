# Karajan Radar - MVP User Stories

> **Project:** Karajan Radar
> **Version:** MVP v1.0
> **Date:** 2026-03-19
> **Tech Stack:** Python/FastAPI, Next.js, PostgreSQL, GCP Cloud Run
> **Total Stories:** 34 | **Total devPoints:** 99 | **Total businessPoints:** 109

> **Read this as a record, not as a specification.** These are the stories the
> MVP was built from, written when the radar watched a single domain. The
> subject-matter terms below — the default search queries in particular — are
> where that domain showed through; they live in the Radar Profile now, and
> the engine carries none of them. For how the system is actually put
> together today, see [architecture.md](architecture.md); for standing up a
> new instance, [creating-instances.md](creating-instances.md).

---

## EPIC 1: Project Bootstrap & Infrastructure (E1)

> Foundation: repository structure, containerization, database, CI/CD, and API baseline.

---

### US-001: Project Skeleton (Backend + Frontend + Docker Compose + PostgreSQL)

- **As a** platform administrator
- **I want** a fully scaffolded monorepo with a FastAPI backend, a Next.js frontend, Docker Compose orchestration, and a PostgreSQL database
- **So that** the team has a reproducible, production-ready local development environment from day one

- **Description:** Create the monorepo structure with two top-level directories (`backend/`, `frontend/`). The backend uses Python 3.12+, FastAPI with async support, uvicorn, and SQLAlchemy 2.0 (async). The frontend uses Next.js 14+ with TypeScript and Tailwind CSS. Docker Compose defines three services: `api`, `web`, `db` (PostgreSQL 16). Include `.env.example`, `Makefile` with common commands (`make up`, `make down`, `make test`), and a root `README.md` with setup instructions.

- **Acceptance Criteria:**
  - Given a clean clone of the repository, when I run `docker compose up --build`, then all three services start without errors within 90 seconds
  - Given the services are running, when I navigate to `http://localhost:8000/docs`, then I see the FastAPI Swagger UI
  - Given the services are running, when I navigate to `http://localhost:3000`, then I see the Next.js default page with the project title "Karajan Radar"
  - Given the services are running, when I query `SELECT 1` against the PostgreSQL container, then the query returns successfully
  - Given I review the repository structure, when I check the root, then I find `backend/`, `frontend/`, `docker-compose.yml`, `.env.example`, `Makefile`, and `README.md`

- **Technical Notes:**
  - Use multi-stage Docker builds for both backend and frontend to minimize image size
  - Backend: `poetry` or `uv` for dependency management; include `pyproject.toml`
  - Frontend: `pnpm` as package manager; include `pnpm-lock.yaml`
  - PostgreSQL volume for data persistence across restarts
  - Configure hot-reload for both backend (uvicorn `--reload`) and frontend (Next.js dev mode)

- **Dependencies:** None

- **Definition of Done:**
  - [ ] Monorepo structure created with `backend/` and `frontend/` directories
  - [ ] Docker Compose starts all three services without manual intervention
  - [ ] FastAPI Swagger UI accessible at `/docs`
  - [ ] Next.js dev server accessible at port 3000
  - [ ] PostgreSQL accepts connections from backend service
  - [ ] `.env.example` documents all required environment variables
  - [ ] `Makefile` includes `up`, `down`, `test`, `lint` targets
  - [ ] README with setup instructions reviewed and verified

- **devPoints:** 3
- **businessPoints:** 5

---

### US-002: Database Schema and Alembic Migrations

- **As a** platform administrator
- **I want** a well-designed relational database schema managed by Alembic migrations
- **So that** the data model evolves safely across environments with full version control

- **Description:** Design and implement the core database schema for the MVP. Key tables: `papers` (normalized paper data), `paper_sources` (source-specific metadata and origin tracking), `classifications` (LLM-assigned themes/buckets), `scores` (strategic relevance and scientific strength), `insights` (executive summaries, impact analysis), `connectors` (source configuration and status), `ingestion_runs` (pipeline execution logs), `config` (system configuration key-value store), `digest_logs` (delivery history). All tables include `created_at`, `updated_at` audit columns. Use UUID primary keys. Set up Alembic with async support and create the initial migration.

- **Acceptance Criteria:**
  - Given a fresh PostgreSQL database, when I run `alembic upgrade head`, then all tables are created with correct columns, types, indexes, and constraints
  - Given the migration has been applied, when I run `alembic downgrade base`, then all tables are removed cleanly
  - Given the schema is applied, when I inspect the `papers` table, then it contains columns: `id` (UUID PK), `doi`, `title`, `abstract`, `authors` (JSONB), `published_date`, `source`, `url`, `pdf_url`, `content_hash`, `status` (enum: new/classified/scored/reviewed/archived), `created_at`, `updated_at`
  - Given the schema is applied, when I inspect the `classifications` table, then it contains `paper_id` (FK), `themes` (JSONB), `strategic_bucket`, `confidence`, `raw_llm_response` (JSONB), `model_used`, `created_at`
  - Given the schema is applied, when I inspect the `scores` table, then it contains `paper_id` (FK), `scientific_strength` (float), `strategic_relevance` (float), `composite_score` (float), `explanation` (JSONB), `weights_snapshot` (JSONB), `model_used`, `created_at`
  - Given the migration exists, when I check the migration file, then it includes appropriate indexes on `papers.doi`, `papers.content_hash`, `papers.published_date`, and `papers.status`

- **Technical Notes:**
  - Use SQLAlchemy 2.0 declarative models with `mapped_column`
  - JSONB for flexible fields (authors, themes, explanation) to accommodate varying source formats
  - `content_hash` as SHA-256 of normalized title+abstract for deduplication
  - `status` as PostgreSQL enum type for type safety
  - Add GIN index on `classifications.themes` for fast JSONB queries
  - Consider partitioning `papers` by `published_date` if volume warrants it in the future

- **Dependencies:** US-001

- **Definition of Done:**
  - [ ] SQLAlchemy models defined for all MVP tables
  - [ ] Alembic initial migration created and tested (upgrade and downgrade)
  - [ ] All foreign key relationships correctly defined
  - [ ] Indexes created on high-query columns
  - [ ] Migration runs successfully in Docker environment
  - [ ] Schema diagram added to `docs/` directory

- **devPoints:** 3
- **businessPoints:** 4

---

### US-003: CI Pipeline with Linting, Tests, and Quality Gates

- **As a** platform administrator
- **I want** an automated CI pipeline that runs on every push and pull request
- **So that** code quality is enforced consistently and regressions are caught before merging

- **Description:** Configure GitHub Actions with two workflow files: `ci-backend.yml` and `ci-frontend.yml`. Backend pipeline: install dependencies, run `ruff` (linting + formatting), `mypy` (type checking), `pytest` with coverage (minimum 80% for services). Frontend pipeline: install dependencies, run `eslint`, `tsc --noEmit`, `vitest` with coverage. Both pipelines run on push to `main` and on all PRs. Add branch protection rules requiring CI pass before merge.

- **Acceptance Criteria:**
  - Given a push to any branch, when the CI pipeline triggers, then the backend job runs ruff check, mypy, and pytest in sequence
  - Given a push to any branch, when the CI pipeline triggers, then the frontend job runs eslint, TypeScript check, and vitest in sequence
  - Given any linting error exists, when the CI pipeline runs, then the pipeline fails with a clear error message indicating the violation
  - Given pytest coverage drops below 80% on backend services, when the CI pipeline runs, then the pipeline fails
  - Given a PR is created against `main`, when CI has not passed, then GitHub blocks the merge
  - Given all checks pass, when I review the PR, then I see green check marks for both backend and frontend jobs

- **Technical Notes:**
  - Use GitHub Actions with matrix strategy for Python 3.12 and Node 20
  - Cache pip and pnpm dependencies between runs for speed
  - Use PostgreSQL service container in backend CI for integration tests
  - Configure `ruff` with `pyproject.toml` (line-length=120, select E/W/F/I/N/UP)
  - Configure `mypy` in strict mode for new code
  - Upload coverage reports as artifacts; optionally integrate with Codecov

- **Dependencies:** US-001

- **Definition of Done:**
  - [ ] Backend CI workflow runs ruff, mypy, pytest with coverage
  - [ ] Frontend CI workflow runs eslint, tsc, vitest with coverage
  - [ ] Both workflows trigger on push and PR events
  - [ ] Coverage thresholds enforced (80% backend services, 70% frontend components)
  - [ ] Branch protection configured on `main`
  - [ ] Pipeline completes in under 5 minutes for typical changes

- **devPoints:** 2
- **businessPoints:** 4

---

### US-004: Health Check and API Versioning

- **As a** platform administrator
- **I want** health check endpoints and a versioned API structure
- **So that** I can monitor service health in production and evolve the API without breaking clients

- **Description:** Implement a `/health` endpoint (no auth) returning service status, database connectivity, and version information. Implement a `/ready` endpoint that verifies all dependencies (database, LLM provider reachability). Structure all business endpoints under `/api/v1/` prefix using FastAPI routers. Include request ID middleware (UUID per request in headers and logs), structured JSON logging with `structlog`, CORS configuration, and global exception handlers that return consistent error responses.

- **Acceptance Criteria:**
  - Given the API is running, when I call `GET /health`, then I receive a 200 response with `{"status": "ok", "version": "0.1.0", "database": "connected", "timestamp": "<ISO8601>"}`
  - Given the database is unreachable, when I call `GET /health`, then I receive a 200 response with `{"status": "degraded", "database": "disconnected"}`
  - Given the API is fully operational, when I call `GET /ready`, then I receive a 200 response; otherwise a 503 with details of failing dependencies
  - Given any API endpoint, when I make a request, then the response includes an `X-Request-ID` header with a UUID
  - Given any API endpoint, when I make a request, then application logs include the same request ID for traceability
  - Given a request to a non-existent endpoint, when the response is returned, then it follows the format `{"error": {"code": "<CODE>", "message": "<MSG>", "request_id": "<UUID>"}}`
  - Given the business API, when I inspect the routes, then all endpoints are prefixed with `/api/v1/`

- **Technical Notes:**
  - Use FastAPI `lifespan` for startup/shutdown events (database pool, etc.)
  - Implement health check as a separate router, not under `/api/v1/`
  - Use `structlog` with JSON renderer for production, console renderer for development
  - CORS: allow configurable origins via environment variable `ALLOWED_ORIGINS`
  - Request ID middleware: generate UUID if not present in `X-Request-ID` header, propagate through context
  - Global exception handler catches `HTTPException`, `ValidationError`, and unhandled exceptions

- **Dependencies:** US-001, US-002

- **Definition of Done:**
  - [ ] `/health` endpoint returns correct status with database connectivity check
  - [ ] `/ready` endpoint verifies all critical dependencies
  - [ ] All business routes under `/api/v1/` prefix
  - [ ] Request ID present in all responses and logs
  - [ ] Structured JSON logging configured with structlog
  - [ ] CORS configured with environment-based allowed origins
  - [ ] Global error handler returns consistent error format
  - [ ] Unit tests for health, ready, error handling, and middleware

- **devPoints:** 2
- **businessPoints:** 3

---

## EPIC 2: Source Connectors (E2)

> Connect to scientific databases and retrieve orthodontics-relevant papers.

---

### US-005: Base Connector Interface

- **As a** platform administrator
- **I want** an abstract base connector class with standardized fetch, parse, and normalize methods
- **So that** all source connectors follow a consistent contract and new sources can be added easily

- **Description:** Create an abstract base class `BaseConnector` in `backend/app/connectors/base.py` that defines the interface every connector must implement. Methods: `async fetch(query_params) -> RawResponse` (retrieve raw data from source API), `parse(raw_response) -> list[RawPaper]` (extract paper records from raw response), `normalize(raw_papers) -> list[NormalizedPaper]` (convert to internal schema). Also include: `get_status() -> ConnectorStatus`, `test_connection() -> bool`, rate limiting support (configurable per connector), retry logic with exponential backoff, and a `ConnectorResult` dataclass wrapping results with metadata (count, errors, duration, source). Define Pydantic models for `RawPaper`, `NormalizedPaper`, `ConnectorConfig`, and `ConnectorStatus`.

- **Acceptance Criteria:**
  - Given a developer creating a new connector, when they subclass `BaseConnector`, then they are forced to implement `fetch`, `parse`, and `normalize` methods (abstract methods)
  - Given any connector execution, when `run()` is called, then it executes fetch -> parse -> normalize in sequence and returns a `ConnectorResult`
  - Given a connector exceeds the rate limit, when a new request is attempted, then it waits the appropriate time before proceeding (no 429 errors to external APIs)
  - Given a transient network failure, when a fetch fails, then it retries up to 3 times with exponential backoff (1s, 2s, 4s)
  - Given a connector execution, when it completes, then `ConnectorResult` includes `source_name`, `papers_found`, `papers_normalized`, `errors`, `duration_seconds`, and `run_timestamp`
  - Given the `NormalizedPaper` model, when I inspect its fields, then it includes: `title`, `abstract`, `authors` (list of `{name, affiliation?}`), `doi`, `published_date`, `source`, `source_id`, `url`, `pdf_url`, `journal`, `keywords`, `content_hash`

- **Technical Notes:**
  - Use Python `abc.ABC` and `abc.abstractmethod` for the interface
  - Rate limiting: use `asyncio.Semaphore` combined with a token bucket or `aiolimiter`
  - Retry: use `tenacity` library with configurable max retries and backoff
  - `content_hash`: SHA-256 of `normalize(title) + normalize(abstract)` for dedup
  - All connectors should use `httpx.AsyncClient` with connection pooling
  - Include a `ConnectorRegistry` to dynamically discover and instantiate connectors

- **Dependencies:** US-001

- **Definition of Done:**
  - [ ] `BaseConnector` abstract class with all required abstract methods
  - [ ] Pydantic models for `RawPaper`, `NormalizedPaper`, `ConnectorConfig`, `ConnectorResult`
  - [ ] Rate limiting support with configurable requests-per-second
  - [ ] Retry logic with exponential backoff (configurable)
  - [ ] `ConnectorRegistry` for dynamic connector discovery
  - [ ] Unit tests with a mock connector implementation verifying the full flow
  - [ ] Documentation docstrings on all public methods

- **devPoints:** 3
- **businessPoints:** 5

---

### US-006: PubMed Connector

- **As a** research analyst
- **I want** the system to fetch orthodontics-related papers from PubMed using E-utilities
- **So that** I have access to the largest biomedical literature database for my research radar

- **Description:** Implement a `PubMedConnector` extending `BaseConnector`. Use NCBI E-utilities: `esearch.fcgi` to search and `efetch.fcgi` to retrieve full records in XML format. Default search queries should cover orthodontics-relevant terms: `"orthodontics"`, `"clear aligners"`, `"dental biomechanics"`, `"malocclusion treatment"`, `"orthodontic force"`, `"tooth movement"`. Support date-range filtering (default: last 7 days). Parse PubMed XML (MedlineCitation) to extract PMID, title, abstract, authors with affiliations, MeSH terms, journal, DOI, publication date. Respect NCBI rate limit (3 requests/second without API key, 10 with). Store and use NCBI API key from environment.

- **Acceptance Criteria:**
  - Given the PubMed connector is configured, when `run()` is called with default parameters, then it returns papers from PubMed matching orthodontics-related queries from the last 7 days
  - Given search results exist, when the connector parses PubMed XML, then each paper includes: PMID, title, abstract (full structured text), author list, journal name, publication date, DOI (when available), and MeSH terms
  - Given the NCBI API key is configured, when making requests, then the connector uses the key and respects the 10 req/s rate limit
  - Given the NCBI API key is not configured, when making requests, then the connector falls back to 3 req/s rate limit
  - Given a date range parameter, when `run(date_from, date_to)` is called, then only papers published within that range are returned
  - Given a paper without an abstract, when it is parsed, then the paper is still included with `abstract=None` and flagged in metadata
  - Given PubMed returns paginated results (>10000), when fetching, then the connector handles `retstart`/`retmax` pagination correctly

- **Technical Notes:**
  - E-utilities base URL: `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/`
  - Use `esearch` with `rettype=json` for initial search, then `efetch` with `rettype=xml&retmode=xml` for full records
  - Parse XML with `lxml` or `defusedxml` for security
  - PubMed date filter: `datetype=pdat&mindate=YYYY/MM/DD&maxdate=YYYY/MM/DD`
  - Map MeSH terms to `keywords` in `NormalizedPaper`
  - Handle the `tool` and `email` parameters required by NCBI usage policy
  - Batch `efetch` requests in groups of 200 IDs (NCBI recommended batch size)

- **Dependencies:** US-005

- **Definition of Done:**
  - [ ] `PubMedConnector` class extends `BaseConnector`
  - [ ] Successfully fetches papers from PubMed E-utilities
  - [ ] Parses PubMed XML correctly (all required fields extracted)
  - [ ] Normalizes results to `NormalizedPaper` format
  - [ ] Respects rate limits (with and without API key)
  - [ ] Handles pagination for large result sets
  - [ ] Date range filtering works correctly
  - [ ] Integration test with real PubMed API (marked as slow/external)
  - [ ] Unit tests with mocked responses (XML fixtures)

- **devPoints:** 3
- **businessPoints:** 5

---

### US-007: arXiv Connector

- **As a** research analyst
- **I want** the system to fetch relevant papers from arXiv covering AI and dental/orthodontic cross-domain research
- **So that** I can detect emerging technologies from the AI and computational fields applicable to orthodontics

- **Description:** Implement an `ArxivConnector` extending `BaseConnector`. Use the arXiv API (Atom feed) to search across categories: `cs.AI`, `cs.CV`, `cs.LG`, `q-bio` cross-referenced with dental/orthodontic keywords. Build compound queries: `(cat:cs.AI OR cat:cs.CV OR cat:cs.LG) AND (all:orthodontic OR all:dental OR all:aligner OR all:malocclusion OR all:cephalometric OR all:tooth)`. Also include direct `q-bio` searches related to biomechanics. Support date filtering and pagination via `start`/`max_results`. Parse Atom XML to extract arXiv ID, title, abstract, authors, categories, published/updated dates, DOI (if present), PDF link.

- **Acceptance Criteria:**
  - Given the arXiv connector is configured, when `run()` is called, then it returns papers matching the cross-domain AI + orthodontics queries
  - Given search results exist, when the connector parses the Atom feed, then each paper includes: arXiv ID, title, abstract, authors, categories, published date, updated date, PDF URL, and DOI (when available)
  - Given arXiv rate limiting (1 request per 3 seconds), when making requests, then the connector never exceeds this rate
  - Given a date range parameter, when filtering, then only papers submitted within that range are returned
  - Given multiple search queries (AI cross-domain + q-bio direct), when `run()` executes, then results from all queries are combined and deduplicated by arXiv ID
  - Given the arXiv API returns paginated results, when total results exceed `max_results`, then the connector fetches subsequent pages

- **Technical Notes:**
  - arXiv API base URL: `http://export.arxiv.org/api/query`
  - arXiv enforces ~1 request per 3 seconds; be conservative
  - Parse Atom XML namespace: `http://www.w3.org/2005/Atom` and `http://arxiv.org/schemas/atom`
  - PDF URL pattern: `https://arxiv.org/pdf/{id}`
  - arXiv does not support date-range natively in API; filter client-side by `published` date
  - Use `sortBy=submittedDate&sortOrder=descending` for recency
  - Max 1000 results per query; implement pagination with `start` parameter

- **Dependencies:** US-005

- **Definition of Done:**
  - [ ] `ArxivConnector` class extends `BaseConnector`
  - [ ] Fetches papers using compound category + keyword queries
  - [ ] Parses Atom XML feed correctly
  - [ ] Normalizes results to `NormalizedPaper` format
  - [ ] Combines and deduplicates results from multiple queries
  - [ ] Respects arXiv rate limits (1 req / 3s)
  - [ ] Client-side date filtering works correctly
  - [ ] Unit tests with mocked Atom XML fixtures
  - [ ] Integration test with real arXiv API (marked as slow/external)

- **devPoints:** 3
- **businessPoints:** 4

---

### US-008: ClinicalTrials.gov Connector

- **As a** the organization strategist
- **I want** the system to fetch orthodontic clinical trials from ClinicalTrials.gov
- **So that** I can track ongoing and upcoming clinical research that may impact our product strategy

- **Description:** Implement a `ClinicalTrialsConnector` extending `BaseConnector`. Use the ClinicalTrials.gov v2 API (`https://clinicaltrials.gov/api/v2/studies`). Search for orthodontic-related interventions with query terms: `"orthodontic"`, `"clear aligner"`, `"dental malocclusion"`, `"tooth movement"`, `"bracket"`. Filter by `query.cond` (condition) and `query.intr` (intervention). Retrieve study fields: NCT ID, title, brief summary, conditions, interventions, phases, status, enrollment, start date, primary completion date, sponsors, locations. Map clinical trial records to `NormalizedPaper` with appropriate field mapping (brief_summary -> abstract, NCT ID -> source_id).

- **Acceptance Criteria:**
  - Given the ClinicalTrials.gov connector is configured, when `run()` is called, then it returns clinical trials matching orthodontic-related queries
  - Given search results exist, when the connector parses the JSON response, then each trial includes: NCT ID, title, brief summary, conditions, interventions, phase, overall status, enrollment count, sponsor, start date, and primary completion date
  - Given the v2 API pagination token, when results exceed page size, then the connector follows `nextPageToken` to retrieve all results
  - Given a date range parameter, when filtering, then only trials with updates within that range are returned (using `query.term` with `AREA[LastUpdatePostDate]`)
  - Given a trial record, when normalized, then `source` is set to `"clinicaltrials"`, `source_id` is the NCT number, and `keywords` includes conditions and intervention types

- **Technical Notes:**
  - v2 API uses JSON responses (simpler than v1 XML)
  - Default page size: 20 studies; use `pageSize=100` for efficiency
  - Pagination via `pageToken` returned in response
  - Map trial `phase` and `overallStatus` to additional metadata fields in `NormalizedPaper`
  - Rate limit: be conservative, 1 request per second
  - Include `countTotal=true` in first request to know total result set size
  - Fields parameter: use `fields` query param to request only needed fields for efficiency

- **Dependencies:** US-005

- **Definition of Done:**
  - [ ] `ClinicalTrialsConnector` class extends `BaseConnector`
  - [ ] Fetches trials from ClinicalTrials.gov v2 API
  - [ ] Parses JSON response correctly (all required fields)
  - [ ] Normalizes trials to `NormalizedPaper` format with correct mapping
  - [ ] Handles pagination via `nextPageToken`
  - [ ] Date-range filtering works
  - [ ] Unit tests with mocked JSON fixtures
  - [ ] Integration test with real API (marked as slow/external)

- **devPoints:** 3
- **businessPoints:** 4

---

### US-009: Crossref Connector

- **As a** research analyst
- **I want** the system to fetch orthodontics papers from Crossref
- **So that** I can access a broad cross-publisher database of scholarly literature with DOI-based metadata

- **Description:** Implement a `CrossrefConnector` extending `BaseConnector`. Use the Crossref REST API (`https://api.crossref.org/works`) with query filters for orthodontics-related terms. Implement polite pool access by including a `mailto` parameter. Search using `query.bibliographic` for terms: `"orthodontics"`, `"clear aligners"`, `"dental biomechanics"`, `"malocclusion"`. Filter by `from-index-date` and `until-index-date` for date ranges. Extract: DOI, title, abstract, authors, container-title (journal), published date, ISSN, type, URL, license, references-count, is-referenced-by-count (citation count). Use citation count as an additional quality signal.

- **Acceptance Criteria:**
  - Given the Crossref connector is configured, when `run()` is called, then it returns works from Crossref matching orthodontics-related queries
  - Given a valid `mailto` is configured, when making requests, then the connector uses the Crossref polite pool (faster responses)
  - Given search results exist, when parsed, then each paper includes: DOI, title, abstract (when available), authors, journal, published date, type, URL, and citation count
  - Given date range parameters, when filtering with `from-index-date`/`until-index-date`, then only recently indexed papers are returned
  - Given Crossref pagination (offset-based), when results exceed `rows` parameter, then the connector fetches subsequent pages using `offset`
  - Given a paper from Crossref, when normalized, then `source` is `"crossref"`, `source_id` is the DOI, and `content_hash` is computed from normalized title + abstract

- **Technical Notes:**
  - Include `mailto` parameter for polite pool access (100x faster rate limit)
  - Default `rows=100` per request; max offset is 10000 for deep paging
  - Use `select` parameter to request only needed fields for efficiency
  - Crossref abstracts may be in JATS XML format; strip XML tags for plain text
  - Rate limit: 50 req/s with polite pool, 1 req/s without
  - Handle the `message.items` array and `message.total-results` for pagination
  - Some works lack abstracts; include them but flag for later enrichment

- **Dependencies:** US-005

- **Definition of Done:**
  - [ ] `CrossrefConnector` class extends `BaseConnector`
  - [ ] Fetches works from Crossref REST API
  - [ ] Uses polite pool with `mailto` parameter
  - [ ] Parses JSON response correctly (handles JATS XML in abstracts)
  - [ ] Normalizes results to `NormalizedPaper` format
  - [ ] Handles offset-based pagination
  - [ ] Date-range filtering with `from-index-date` works correctly
  - [ ] Unit tests with mocked JSON fixtures
  - [ ] Integration test with real API (marked as slow/external)

- **devPoints:** 3
- **businessPoints:** 3

---

### US-010: Semantic Scholar Connector

- **As a** research analyst
- **I want** the system to fetch papers from Semantic Scholar's Academic Graph API
- **So that** I can leverage AI-enriched metadata including citation contexts, influential citations, and TLDR summaries

- **Description:** Implement a `SemanticScholarConnector` extending `BaseConnector`. Use the Semantic Scholar Academic Graph API (`https://api.semanticscholar.org/graph/v1/paper/search`). Search with orthodontics-related queries. Request fields: `paperId`, `externalIds` (DOI, PubMed, ArXiv), `title`, `abstract`, `authors`, `year`, `venue`, `publicationDate`, `citationCount`, `influentialCitationCount`, `tldr`, `openAccessPdf`, `fieldsOfStudy`. The `tldr` field provides an AI-generated one-line summary that can be used as an additional data point. Map `influentialCitationCount` as a quality signal. Support API key authentication for higher rate limits.

- **Acceptance Criteria:**
  - Given the Semantic Scholar connector is configured, when `run()` is called, then it returns papers matching orthodontics-related queries
  - Given results are returned, when parsed, then each paper includes: paper ID, external IDs (DOI, PMID, ArXiv ID), title, abstract, authors, venue, publication date, citation count, influential citation count, TLDR, and open access PDF URL
  - Given an API key is configured, when making requests, then it is included in the `x-api-key` header and the connector uses the higher rate limit (100 req/s)
  - Given no API key, when making requests, then the connector uses the public rate limit (100 req/5min) with appropriate throttling
  - Given a date range, when filtering, then only papers with `publicationDate` within the range are returned (client-side filter as API supports `year` filter only)
  - Given pagination support via `offset` and `limit`, when total results exceed `limit`, then subsequent pages are fetched
  - Given a paper with external IDs, when normalized, then the DOI is used as `source_id` if available, falling back to Semantic Scholar `paperId`

- **Technical Notes:**
  - API base: `https://api.semanticscholar.org/graph/v1`
  - Use `fields` parameter to request only needed fields
  - `limit` max is 100 per request; paginate with `offset`
  - The `tldr` field requires requesting it explicitly and is not always available
  - Partner API key gives 1 req/s guaranteed vs public tier
  - Map `fieldsOfStudy` to `keywords` in `NormalizedPaper`
  - Use bulk endpoint `/paper/batch` for fetching known paper IDs efficiently (up to 500 at once)

- **Dependencies:** US-005

- **Definition of Done:**
  - [ ] `SemanticScholarConnector` class extends `BaseConnector`
  - [ ] Fetches papers from Academic Graph API
  - [ ] Handles both authenticated and unauthenticated rate limits
  - [ ] Parses JSON response including TLDR and influential citations
  - [ ] Normalizes results to `NormalizedPaper` format
  - [ ] Handles pagination correctly
  - [ ] Client-side date filtering works
  - [ ] Unit tests with mocked JSON fixtures
  - [ ] Integration test with real API (marked as slow/external)

- **devPoints:** 3
- **businessPoints:** 3

---

## EPIC 3: Ingestion Pipeline (E3)

> Normalize, deduplicate, and orchestrate paper ingestion from all sources.

---

### US-011: Normalization Service

- **As a** system
- **I want** a normalization service that standardizes paper data from heterogeneous sources
- **So that** all papers in the database follow a consistent format regardless of their origin

- **Description:** Implement a `NormalizationService` in `backend/app/services/normalization.py`. Responsibilities: (1) **Title normalization**: strip HTML/XML tags, normalize whitespace, convert to title case for display while keeping a lowercase normalized version for comparison. (2) **Author parsing**: handle various formats (`"Last, First"`, `"First Last"`, `"Last FM"`, ORCID when available), produce a list of `{given_name, family_name, affiliation?, orcid?}`. (3) **Date standardization**: parse various date formats (ISO, `"2024 Jan"`, `"2024/01/15"`, partial dates) into ISO 8601 (`YYYY-MM-DD`), handling partial dates gracefully (set missing day to 01, missing month to 01). (4) **Abstract cleaning**: strip HTML/JATS XML tags, normalize Unicode, detect and handle structured abstracts (Background/Methods/Results/Conclusion). (5) **Content hash generation**: SHA-256 of lowercase normalized title + first 500 chars of normalized abstract.

- **Acceptance Criteria:**
  - Given a title with HTML tags like `"<i>In vitro</i> orthodontic bracket adhesion"`, when normalized, then the result is `"In Vitro Orthodontic Bracket Adhesion"` (display) and `"in vitro orthodontic bracket adhesion"` (comparison)
  - Given an author string `"Smith, John A."`, when parsed, then the result is `{"given_name": "John A.", "family_name": "Smith"}`
  - Given an author string `"Maria Garcia-Lopez"`, when parsed, then the result is `{"given_name": "Maria", "family_name": "Garcia-Lopez"}`
  - Given a date string `"2024 Feb"`, when standardized, then the result is `"2024-02-01"`
  - Given a date string `"2024-03-15T00:00:00Z"`, when standardized, then the result is `"2024-03-15"`
  - Given an abstract with JATS XML like `"<jats:p>This study evaluates...</jats:p>"`, when cleaned, then the result is `"This study evaluates..."`
  - Given two papers with the same title and abstract but different sources, when content hashes are computed, then they produce identical hashes
  - Given two papers with slightly different titles (one has trailing whitespace), when content hashes are computed, then they produce identical hashes

- **Technical Notes:**
  - Use `dateutil.parser` for flexible date parsing with fallback strategies
  - Use `bleach` or `lxml` for HTML/XML stripping
  - Unicode normalization: use `unicodedata.normalize('NFKC', text)`
  - Author parsing: consider edge cases (single name, organization as author, CJK names)
  - Content hash: `hashlib.sha256((norm_title + norm_abstract[:500]).encode()).hexdigest()`
  - Make normalization functions stateless and pure for easy testing

- **Dependencies:** US-001

- **Definition of Done:**
  - [ ] `NormalizationService` with methods for title, author, date, abstract, and hash
  - [ ] Handles all documented edge cases for each normalization type
  - [ ] All normalization functions are pure/stateless
  - [ ] Comprehensive unit tests covering edge cases (minimum 20 test cases)
  - [ ] Performance: normalizes 1000 papers in under 1 second

- **devPoints:** 3
- **businessPoints:** 4

---

### US-012: Deduplication Service

- **As a** system
- **I want** a deduplication service that detects and merges duplicate papers from different sources
- **So that** each paper appears only once in the system with metadata consolidated from all sources

- **Description:** Implement a `DeduplicationService` in `backend/app/services/deduplication.py`. Three-tier deduplication strategy: (1) **Exact DOI match**: if two papers share the same DOI, they are duplicates. (2) **Content hash match**: if two papers have identical content hashes (from normalization), they are duplicates. (3) **Fuzzy title match**: use normalized title similarity (Levenshtein ratio >= 0.92) combined with same-year publication as a probable duplicate, flagged for review. When duplicates are found, merge metadata: keep the richest abstract, combine author lists (union), collect all source IDs in `paper_sources` table, retain the earliest publication date. Track provenance: which sources contributed to each paper record.

- **Acceptance Criteria:**
  - Given two papers with the same DOI from PubMed and Crossref, when deduplication runs, then they are merged into a single paper with both sources recorded in `paper_sources`
  - Given two papers with different DOIs but identical content hashes, when deduplication runs, then they are flagged as duplicates and merged
  - Given two papers with titles that are 93% similar (Levenshtein) and the same publication year, when deduplication runs, then they are flagged as probable duplicates
  - Given two papers with titles that are 90% similar, when deduplication runs, then they are NOT flagged as duplicates (below threshold)
  - Given a duplicate is found, when merging, then the longer abstract is kept, authors from both sources are combined (deduped by name), and all source-specific IDs are preserved
  - Given a batch of 500 papers, when deduplication runs, then it completes in under 10 seconds
  - Given the deduplication result, when inspected, then it reports: `total_input`, `unique_papers`, `exact_doi_dupes`, `hash_dupes`, `fuzzy_dupes`

- **Technical Notes:**
  - Use DOI as primary dedup key (most reliable)
  - Content hash as secondary key (catches papers without DOI)
  - For fuzzy matching: use `rapidfuzz` library (faster than `fuzzywuzzy`)
  - Consider blocking/bucketing by publication year before fuzzy comparison to reduce O(n^2) complexity
  - Merge strategy should be configurable (which source takes priority for each field)
  - Store merge history for audit: `paper_sources` table tracks `source`, `source_id`, `raw_data` (JSONB)
  - Use database upsert (`INSERT ... ON CONFLICT`) for efficient persistence

- **Dependencies:** US-002, US-011

- **Definition of Done:**
  - [ ] `DeduplicationService` with DOI, hash, and fuzzy matching strategies
  - [ ] Merge logic preserves richest metadata from all sources
  - [ ] Provenance tracked in `paper_sources` table
  - [ ] Dedup statistics reported after each run
  - [ ] Performance: 500 papers deduplicated in under 10 seconds
  - [ ] Unit tests covering all three dedup strategies and merge logic
  - [ ] Edge case tests: papers without DOI, without abstract, identical papers

- **devPoints:** 3
- **businessPoints:** 4

---

### US-013: Ingestion Orchestrator

- **As a** platform administrator
- **I want** an ingestion orchestrator that runs all enabled connectors, normalizes, deduplicates, and persists results
- **So that** the full ingestion pipeline executes reliably as a single coordinated process

- **Description:** Implement an `IngestionOrchestrator` in `backend/app/services/ingestion.py`. The orchestrator: (1) reads enabled connectors from configuration, (2) runs each connector concurrently using `asyncio.gather` with per-connector error isolation, (3) collects all `NormalizedPaper` results, (4) runs deduplication across the combined set, (5) persists new papers to database (upsert), (6) logs a complete `IngestionRun` record with per-connector stats and overall metrics. Expose via API endpoint `POST /api/v1/ingestion/run` (admin-only) for manual triggers. Include a dry-run mode that executes the full pipeline but does not persist results (useful for testing).

- **Acceptance Criteria:**
  - Given 3 connectors are enabled (PubMed, arXiv, Crossref), when the orchestrator runs, then all three execute concurrently and results are combined
  - Given one connector fails (e.g., arXiv timeout), when the orchestrator runs, then the other connectors complete successfully and the failure is logged with error details
  - Given the pipeline completes, when the `IngestionRun` is logged, then it includes: `run_id`, `started_at`, `completed_at`, `duration_seconds`, per-connector stats (`papers_fetched`, `papers_normalized`, `errors`), dedup stats (`duplicates_found`, `new_papers`), and overall `total_persisted`
  - Given a `POST /api/v1/ingestion/run` request, when called with valid admin credentials, then the ingestion pipeline executes and returns the `IngestionRun` summary
  - Given a `POST /api/v1/ingestion/run?dry_run=true` request, when executed, then the full pipeline runs but no papers are persisted to the database
  - Given papers already exist in the database, when new ingestion finds them again, then they are not duplicated (upsert behavior) and `paper_sources` may be enriched with new source data
  - Given the orchestrator is already running, when a second run is triggered, then it returns a 409 Conflict with a message indicating a run is in progress

- **Technical Notes:**
  - Use `asyncio.gather(*tasks, return_exceptions=True)` for concurrent connector execution with error isolation
  - Implement a lock mechanism (database row lock or in-memory lock) to prevent concurrent runs
  - Use database transactions: normalize and deduplicate in memory, persist in a single transaction
  - Log each step with structured logging including `run_id` for traceability
  - Consider a progress callback mechanism for future UI integration (WebSocket or polling endpoint)
  - `IngestionRun` table stores run history for observability

- **Dependencies:** US-005, US-006, US-007, US-008, US-009, US-010, US-011, US-012

- **Definition of Done:**
  - [ ] `IngestionOrchestrator` runs all enabled connectors concurrently
  - [ ] Per-connector error isolation (one failure does not stop others)
  - [ ] Results normalized, deduplicated, and persisted in a single transaction
  - [ ] `IngestionRun` record logged with complete metrics
  - [ ] API endpoint for manual trigger with admin auth
  - [ ] Dry-run mode works without side effects
  - [ ] Concurrent run protection (409 on duplicate trigger)
  - [ ] Integration tests with mocked connectors
  - [ ] Unit tests for orchestration logic

- **devPoints:** 4
- **businessPoints:** 5

---

### US-014: Daily Ingestion Cloud Run Job

- **As a** platform administrator
- **I want** the ingestion pipeline to run automatically every day as a Cloud Run Job
- **So that** the research radar stays current with minimal manual intervention

- **Description:** Configure the ingestion orchestrator to run as a GCP Cloud Run Job triggered daily by Cloud Scheduler. The job should: (1) execute the ingestion pipeline for the previous day's papers (date range: yesterday 00:00 UTC to today 00:00 UTC), (2) report results via structured logs (accessible in Cloud Logging), (3) send a summary to a configurable webhook (for Teams notification pipeline), (4) handle job timeout gracefully (max execution: 30 minutes). Include a `Dockerfile.job` for the job container, a Terraform/Pulumi config (or `gcloud` commands documented in a script) for provisioning the Cloud Run Job and Cloud Scheduler trigger. Provide environment variable configuration for all secrets (API keys, database URL).

- **Acceptance Criteria:**
  - Given Cloud Scheduler is configured, when the daily trigger fires at 06:00 UTC, then the Cloud Run Job starts and executes the ingestion pipeline
  - Given the job runs, when it queries connectors, then the date range is set to the previous 24 hours
  - Given the job completes successfully, when Cloud Logging is checked, then structured logs include the full `IngestionRun` summary with `run_id`, paper counts, and duration
  - Given the job completes, when a webhook URL is configured, then a summary payload is POSTed to that URL with `new_papers_count`, `total_sources_queried`, `errors`, and `run_duration`
  - Given the job exceeds 30 minutes, when the timeout is reached, then it terminates gracefully, logs partial results, and exits with a non-zero code
  - Given the infrastructure configuration, when I review the deployment script, then it includes: Cloud Run Job definition, Cloud Scheduler cron expression, IAM service account, and Secret Manager references
  - Given environment variables `DATABASE_URL`, `NCBI_API_KEY`, `S2_API_KEY`, `OPENAI_API_KEY` are configured, when the job starts, then it reads them from the environment (injected via Secret Manager)

- **Technical Notes:**
  - Cloud Run Job: `gcloud run jobs create <instance>-daily-ingestion --image=... --tasks=1 --max-retries=1 --task-timeout=1800s`
  - Cloud Scheduler: `gcloud scheduler jobs create http <instance>-daily-trigger --schedule="0 6 * * *" --uri=... --http-method=POST`
  - Use Secret Manager for API keys, mount as environment variables
  - Job container should use the same backend image with a different entrypoint (`python -m app.jobs.daily_ingestion`)
  - Include a health check at job start (verify DB connectivity, connector reachability)
  - Log to stdout in JSON format for Cloud Logging compatibility
  - Document manual job triggering: `gcloud run jobs execute <instance>-daily-ingestion`

- **Dependencies:** US-013

- **Definition of Done:**
  - [ ] `Dockerfile.job` created for job container
  - [ ] Job entry point (`daily_ingestion.py`) implements daily pipeline with date range
  - [ ] Cloud Run Job and Cloud Scheduler configuration documented/scripted
  - [ ] Structured logs compatible with Cloud Logging
  - [ ] Webhook notification on completion
  - [ ] Graceful timeout handling
  - [ ] Deployment script tested in GCP environment
  - [ ] Manual trigger documented and tested

- **devPoints:** 3
- **businessPoints:** 4

---

## EPIC 4: LLM Abstraction & Classification (E4)

> LLM-powered paper classification, scoring, and structured output generation.

---

### US-015: LLM Provider Abstraction Layer

- **As a** platform administrator
- **I want** an abstraction layer for LLM providers with a uniform interface
- **So that** the system can switch between LLM providers (OpenAI, Anthropic, Gemini) without changing business logic

- **Description:** Create an `LLMProvider` abstract base class in `backend/app/llm/base.py` with methods: `async classify(paper, config) -> ClassificationResult`, `async score(paper, classification, config) -> ScoreResult`, `async generate_insight(paper, classification, score, config) -> InsightResult`. Include: structured JSON output parsing with Pydantic validation, token usage tracking per call, cost estimation per call, retry logic for rate limits (429) and transient errors (500/503), configurable temperature/model per task, and prompt template management (Jinja2 templates stored in `backend/app/llm/prompts/`). Implement a `ProviderRegistry` for dynamic provider selection based on configuration.

- **Acceptance Criteria:**
  - Given a developer implementing a new provider, when they subclass `LLMProvider`, then they must implement `_call_api(messages, config) -> RawResponse` as the single integration point
  - Given any LLM call, when structured JSON output is requested, then the response is validated against a Pydantic model and invalid responses trigger a retry with a correction prompt
  - Given an LLM call completes, when the result is returned, then it includes `tokens_used` (prompt + completion), `estimated_cost_usd`, `model_used`, `latency_ms`
  - Given a 429 rate limit response, when the provider handles it, then it retries with exponential backoff up to 3 times
  - Given a prompt template exists in `prompts/classify.j2`, when `classify()` is called, then the template is rendered with the paper data and config context
  - Given the configuration specifies `provider=openai, model=gpt-4o-mini` for classification, when `classify()` is called, then the OpenAI provider is used with the specified model
  - Given different tasks (classify, score, insight), when configured, then each can use a different model/temperature combination

- **Technical Notes:**
  - Use `abc.ABC` for the abstract class
  - Jinja2 templates for prompt management (separation of prompts from code)
  - Token tracking: use `tiktoken` for OpenAI token counting, approximate for other providers
  - Cost estimation: maintain a cost-per-token table per model (configurable)
  - Retry logic: use `tenacity` with specific retry conditions (rate limit, server error)
  - JSON output: request `response_format={"type": "json_object"}` for OpenAI; parse and validate with Pydantic
  - Include a `MockProvider` for testing that returns deterministic results

- **Dependencies:** US-001

- **Definition of Done:**
  - [ ] `LLMProvider` abstract class with `classify`, `score`, `generate_insight` methods
  - [ ] Structured JSON output parsing with Pydantic validation
  - [ ] Token usage and cost tracking per call
  - [ ] Retry logic for rate limits and transient errors
  - [ ] Prompt template system with Jinja2
  - [ ] `ProviderRegistry` for dynamic provider selection
  - [ ] `MockProvider` for testing
  - [ ] Unit tests for base class, retry logic, and JSON parsing
  - [ ] Prompt templates created for classify, score, and insight tasks

- **devPoints:** 4
- **businessPoints:** 5

---

### US-016: OpenAI Provider Implementation

- **As a** platform administrator
- **I want** a concrete OpenAI provider implementation
- **So that** the system can use GPT-4o and GPT-4o-mini for paper classification and analysis

- **Description:** Implement `OpenAIProvider` in `backend/app/llm/providers/openai.py` extending `LLMProvider`. Use the official `openai` Python SDK (async client). Implement `_call_api()` to call the Chat Completions API with support for: JSON mode (`response_format`), system/user message construction from prompt templates, streaming support (for long-running insight generation), and function calling (for future extensibility). Configure via environment variables: `OPENAI_API_KEY`, `OPENAI_ORG_ID` (optional), `OPENAI_DEFAULT_MODEL`. Implement token counting with `tiktoken` for accurate cost estimation. Support both `gpt-4o` (for complex classification) and `gpt-4o-mini` (for simpler/high-volume tasks) with per-task model configuration.

- **Acceptance Criteria:**
  - Given valid OpenAI API credentials, when `classify()` is called with a paper, then the OpenAI Chat Completions API is called and a valid `ClassificationResult` is returned
  - Given the API response is in JSON mode, when the response is received, then it is parsed into the expected Pydantic model without errors
  - Given a model is specified in task config (e.g., `gpt-4o-mini`), when the API call is made, then that specific model is used
  - Given no model is specified, when the API call is made, then `OPENAI_DEFAULT_MODEL` from environment is used
  - Given a successful API call, when the result is returned, then `tokens_used` matches `tiktoken` calculation within 5% tolerance
  - Given a successful API call, when cost is estimated, then it uses the correct rate for the model used (e.g., $2.50/1M input tokens for gpt-4o-mini)
  - Given the OpenAI API returns a rate limit error, when handled, then the provider retries respecting the `Retry-After` header
  - Given an invalid JSON response from the LLM, when validation fails, then the provider sends a correction prompt asking the LLM to fix the output (max 2 retries)

- **Technical Notes:**
  - Use `openai.AsyncOpenAI` client for async support
  - JSON mode: set `response_format={"type": "json_object"}` and include "JSON" instruction in system prompt
  - Token counting: `tiktoken.encoding_for_model(model_name)` for accurate pre-call estimation
  - Cost table (as of 2024): gpt-4o ($2.50/$10 per 1M in/out), gpt-4o-mini ($0.15/$0.60 per 1M in/out)
  - Make cost table configurable to accommodate price changes
  - Implement connection pooling via `httpx` client reuse
  - Log all API calls with request ID, model, token count, latency (structured logging)

- **Dependencies:** US-015

- **Definition of Done:**
  - [ ] `OpenAIProvider` class extends `LLMProvider`
  - [ ] Calls OpenAI Chat Completions API via async SDK
  - [ ] JSON mode output with Pydantic validation
  - [ ] Accurate token counting with tiktoken
  - [ ] Cost estimation per call
  - [ ] Per-task model configuration (gpt-4o vs gpt-4o-mini)
  - [ ] Rate limit retry with `Retry-After` header
  - [ ] Invalid JSON retry with correction prompt
  - [ ] Unit tests with mocked OpenAI client
  - [ ] Integration test with real API (marked as slow/external, uses cheap model)

- **devPoints:** 3
- **businessPoints:** 4

---

### US-017: Thematic Classification with Structured JSON Output

- **As a** research analyst
- **I want** papers to be automatically classified by orthodontic themes using LLM analysis
- **So that** I can quickly filter and find papers relevant to specific areas of interest

- **Description:** Implement the thematic classification pipeline in `backend/app/services/classification.py`. The LLM analyzes each paper's title, abstract, and keywords to assign one or more themes from a configurable taxonomy. Default taxonomy: `biomechanics`, `materials_science`, `digital_orthodontics`, `ai_ml_applications`, `clinical_outcomes`, `patient_experience`, `imaging_diagnostics`, `treatment_planning`, `clear_aligners`, `surgical_orthodontics`, `pediatric_orthodontics`, `periodontics_interface`, `temporomandibular`, `business_innovation`. The LLM returns structured JSON with: `primary_theme`, `secondary_themes` (list), `confidence` (0.0-1.0), `reasoning` (brief explanation). Store results in `classifications` table with the raw LLM response for auditability. The taxonomy is configurable via the `config` table.

- **Acceptance Criteria:**
  - Given a paper about "3D-printed clear aligner biomechanics", when classified, then `primary_theme` is `biomechanics` or `clear_aligners` and both appear in themes with confidence > 0.7
  - Given a paper about "Machine learning for cephalometric landmark detection", when classified, then themes include `ai_ml_applications` and `imaging_diagnostics`
  - Given any classification, when the result is returned, then it includes `primary_theme` (exactly one), `secondary_themes` (zero or more), `confidence` (0.0-1.0), and `reasoning` (non-empty string)
  - Given the LLM returns a theme not in the taxonomy, when validation runs, then the invalid theme is rejected and the LLM is asked to re-classify using only valid themes
  - Given a paper with insufficient information (no abstract, very short title), when classified, then `confidence` is below 0.5 and `reasoning` notes the data limitation
  - Given the taxonomy is updated in the `config` table, when future classifications run, then they use the updated taxonomy without code changes
  - Given a classification, when stored in the database, then `raw_llm_response` preserves the complete LLM output for audit purposes

- **Technical Notes:**
  - Prompt template: include the full taxonomy with descriptions and examples in system prompt
  - Use `gpt-4o-mini` for classification (cost-effective for high volume)
  - Pydantic model: `ClassificationResult(primary_theme: str, secondary_themes: list[str], confidence: float, reasoning: str)`
  - Validate themes against taxonomy; retry with correction if invalid
  - Batch classification: process up to 5 papers per LLM call if context window allows (reduces cost)
  - Cache taxonomy in memory, refresh from DB every hour
  - Include few-shot examples in the prompt for consistency

- **Dependencies:** US-015, US-016, US-002

- **Definition of Done:**
  - [ ] Classification service calls LLM with paper data and taxonomy
  - [ ] LLM returns structured JSON validated by Pydantic
  - [ ] Themes validated against configurable taxonomy
  - [ ] Results stored in `classifications` table with raw response
  - [ ] Handles papers with missing/incomplete data gracefully
  - [ ] Taxonomy configurable via database
  - [ ] Prompt template with few-shot examples
  - [ ] Unit tests with mocked LLM responses
  - [ ] Validation tests for edge cases (invalid themes, low confidence)

- **devPoints:** 3
- **businessPoints:** 5

---

### US-018: Strategic Bucket Classification

- **As a** the organization strategist
- **I want** papers classified into strategic buckets aligned with the organization's business priorities
- **So that** I can quickly assess which research signals are most relevant to our strategic roadmap

- **Description:** Extend the classification pipeline with strategic bucket assignment. Each paper is classified into one primary strategic bucket based on its relevance to the organization's business. Default buckets: (1) `product_innovation` - new materials, designs, or manufacturing techniques for aligners/orthodontic products, (2) `competitive_intelligence` - competitor research, patents, clinical results from competing products, (3) `market_expansion` - new indications, patient populations, or market segments, (4) `operational_efficiency` - AI/automation for treatment planning, manufacturing, or workflow, (5) `regulatory_landscape` - regulatory changes, standards, compliance requirements, (6) `fundamental_research` - basic science that may have long-term implications, (7) `patient_outcomes` - clinical evidence, patient satisfaction, treatment efficacy. The LLM provides bucket assignment with a `strategic_rationale` explaining why the paper matters for the organization specifically.

- **Acceptance Criteria:**
  - Given a paper about "Novel 3D-printed resin for clear aligners with improved stress distribution", when bucket-classified, then `strategic_bucket` is `product_innovation` with a rationale mentioning material improvement for aligners
  - Given a paper about "Invisalign vs SmileDirectClub: 5-year clinical outcomes", when bucket-classified, then `strategic_bucket` is `competitive_intelligence`
  - Given a paper about "FDA guidance update for AI-assisted orthodontic treatment planning software", when bucket-classified, then `strategic_bucket` is `regulatory_landscape`
  - Given any bucket classification, when the result is returned, then it includes: `strategic_bucket` (one of the valid buckets), `strategic_rationale` (2-3 sentences explaining relevance to the organization), `actionability` (enum: `immediate`, `monitor`, `archive`)
  - Given the bucket taxonomy is updated in configuration, when future classifications run, then they use the updated buckets
  - Given a paper with no clear strategic relevance, when classified, then `actionability` is `archive` and rationale explains why it has limited strategic value

- **Technical Notes:**
  - This classification runs as a second LLM call after thematic classification (or combined in a single call if context allows)
  - The system prompt should include a brief description of the organization, taken from the active Radar Profile
  - `actionability` levels: `immediate` (requires action within 30 days), `monitor` (track for developments), `archive` (low strategic relevance)
  - Consider combining thematic + bucket classification in a single LLM call to reduce costs
  - Store in the same `classifications` table, extending the schema with `strategic_bucket`, `strategic_rationale`, `actionability`
  - Bucket definitions should be stored in config with descriptions that are included in the LLM prompt

- **Dependencies:** US-017

- **Definition of Done:**
  - [ ] Strategic bucket classification integrated into classification pipeline
  - [ ] LLM assigns bucket with rationale and actionability
  - [ ] All bucket assignments validated against configurable taxonomy
  - [ ] Results stored in `classifications` table
  - [ ] the organization-specific context included in LLM prompt
  - [ ] Configurable bucket definitions via database
  - [ ] Unit tests with mocked LLM responses covering all buckets
  - [ ] Test cases for edge cases (ambiguous papers, no strategic relevance)

- **devPoints:** 2
- **businessPoints:** 5

---

### US-019: Scientific Strength and Strategic Relevance Scoring with Explainability

- **As a** the organization strategist
- **I want** each paper scored on scientific strength and strategic relevance with transparent explanations
- **So that** I can prioritize which signals deserve my attention based on objective, explainable criteria

- **Description:** Implement a scoring service in `backend/app/services/scoring.py`. Two independent scores per paper: (1) **Scientific Strength** (0-100): evaluates methodology quality, sample size, study type (RCT > cohort > case study > review > opinion), journal impact, citation count, statistical rigor mentioned in abstract. (2) **Strategic Relevance** (0-100): evaluates alignment with the organization priorities, commercial applicability, time-to-impact, competitive advantage potential. Both scores combine weighted sub-scores. A **Composite Score** is calculated: `composite = (scientific_strength * w1 + strategic_relevance * w2) / (w1 + w2)` where `w1` and `w2` are configurable weights (default: w1=0.4, w2=0.6). The LLM provides an `explanation` object with sub-scores and reasoning for each. Store weights snapshot with each score for reproducibility.

- **Acceptance Criteria:**
  - Given a randomized controlled trial paper in a high-impact journal with n=500, when scored, then `scientific_strength` is above 75
  - Given a case report with n=1 in a low-impact journal, when scored, then `scientific_strength` is below 40
  - Given a paper about a novel aligner material directly applicable to manufacturing, when scored, then `strategic_relevance` is above 80
  - Given a paper about basic tooth biology with no near-term commercial application, when scored, then `strategic_relevance` is below 30
  - Given any score result, when the explanation is inspected, then it contains: sub-scores for each criterion (e.g., `methodology: 85, sample_size: 70, ...`), a text reasoning for each sub-score, and the formula used for the composite
  - Given the scoring weights are changed in configuration (e.g., w1=0.5, w2=0.5), when future scoring runs, then the new weights are applied and the `weights_snapshot` in the score record reflects the change
  - Given a previously scored paper, when weights change, then the old score retains its `weights_snapshot` and is not retroactively changed

- **Technical Notes:**
  - Scientific strength sub-scores: `study_type` (0-100), `sample_size` (0-100), `methodology_rigor` (0-100), `journal_impact` (0-100), `citation_signal` (0-100)
  - Strategic relevance sub-scores: `organization_alignment` (0-100), `commercial_applicability` (0-100), `time_to_impact` (0-100), `competitive_advantage` (0-100), `market_potential` (0-100)
  - Use `gpt-4o` for scoring (higher accuracy needed for nuanced evaluation)
  - Include citation count and journal name in the prompt context (from paper metadata)
  - Weights for sub-scores also configurable; default equal weighting within each category
  - Store `weights_snapshot` as JSONB capturing all weight values at time of scoring
  - Pydantic model for validation of all sub-scores and ranges

- **Dependencies:** US-015, US-016, US-002

- **Definition of Done:**
  - [ ] Scoring service computes scientific strength and strategic relevance
  - [ ] Composite score calculated from configurable weights
  - [ ] Explanation includes sub-scores with reasoning for each
  - [ ] Weights snapshot stored with each score for reproducibility
  - [ ] Results stored in `scores` table
  - [ ] Scoring weights configurable via database
  - [ ] Unit tests with mocked LLM responses
  - [ ] Validation tests for score ranges (0-100) and explanation completeness
  - [ ] Edge case tests (paper with minimal metadata, missing abstract)

- **devPoints:** 3
- **businessPoints:** 5

---

## EPIC 5: Strategic Insight Generation (E5)

> Generate actionable summaries, impact analyses, and detect hype.

---

### US-020: Executive Summary Generation (EN + ES)

- **As a** the organization strategist
- **I want** each paper to have an executive summary in both English and Spanish
- **So that** I can quickly understand the strategic significance without reading the full paper, in both languages our team uses

- **Description:** Implement an executive summary generator in `backend/app/services/insights.py`. For each classified and scored paper, generate: (1) **Executive Summary** (3-5 sentences): concise overview of what the paper found and why it matters for orthodontics, written for a business audience (not academic). (2) **Key Findings** (3-5 bullet points): the most important takeaways. (3) **the organization Impact Statement** (1-2 sentences): specific implications for the organization's products, strategy, or operations. (4) **Recommended Actions** (0-3 bullet points): concrete next steps if applicable. Generate all four components in both English and Spanish in a single LLM call (bilingual generation). Store in the `insights` table with `language` field.

- **Acceptance Criteria:**
  - Given a classified and scored paper, when insight generation runs, then an executive summary is produced in both English and Spanish
  - Given the English summary, when reviewed, then it is written in clear business language (no academic jargon) and is 3-5 sentences long
  - Given the Spanish summary, when reviewed, then it is a natural Spanish translation (not word-for-word), using appropriate dental/orthodontic terminology in Spanish
  - Given any insight, when inspected, then it includes: `executive_summary`, `key_findings` (list), `organization_impact`, `recommended_actions` (list), and `language` (enum: `en`, `es`)
  - Given a paper classified as `actionability=immediate`, when insights are generated, then `recommended_actions` contains at least one concrete action item
  - Given a paper classified as `actionability=archive`, when insights are generated, then `recommended_actions` may be empty and the impact statement reflects limited relevance
  - Given both language versions, when stored, then each has its own record in the `insights` table linked to the same paper

- **Technical Notes:**
  - Use `gpt-4o` for insight generation (requires nuanced bilingual output)
  - Single LLM call with prompt: "Generate the following in both English and Spanish..."
  - Include classification results and scores in the prompt context for informed summary generation
  - Pydantic model: `InsightResult(executive_summary: str, key_findings: list[str], organization_impact: str, recommended_actions: list[str], language: str)`
  - Spanish dental terminology reference: include a glossary in the system prompt (e.g., "clear aligners" = "alineadores transparentes")
  - Target total token usage: under 2000 tokens per paper (both languages combined)
  - Store `model_used` and `tokens_used` for cost tracking

- **Dependencies:** US-015, US-016, US-017, US-019

- **Definition of Done:**
  - [ ] Executive summary generated in English and Spanish
  - [ ] Business-friendly language (non-academic)
  - [ ] Key findings, the organization impact, and recommended actions included
  - [ ] Both language versions stored in `insights` table
  - [ ] Spanish output uses natural orthodontic terminology
  - [ ] Token usage tracked per call
  - [ ] Unit tests with mocked LLM responses
  - [ ] Quality review of sample outputs (5+ papers)

- **devPoints:** 3
- **businessPoints:** 5

---

### US-021: Impact Analysis and Hype Detection

- **As a** the organization strategist
- **I want** each paper analyzed for potential market impact and hype indicators
- **So that** I can distinguish genuinely impactful research from overhyped findings

- **Description:** Implement impact analysis and hype detection in `backend/app/services/insights.py`. For each paper, generate: (1) **Impact Analysis**: `time_horizon` (short-term <1yr, medium 1-3yr, long-term >3yr), `impact_magnitude` (low/medium/high/transformative), `affected_areas` (list of the organization departments/products affected), `confidence_level` (how confident the assessment is). (2) **Hype Detection**: `hype_score` (0-100, where 100 = pure hype), `hype_indicators` (list of detected indicators like "small sample size with bold claims", "no peer review", "commercial sponsor bias"), `credibility_signals` (positive indicators like "replicated results", "large RCT", "independent funding"), `verdict` (enum: `solid_evidence`, `promising_early`, `needs_replication`, `likely_overhyped`, `insufficient_data`). This helps strategists avoid allocating resources based on overhyped research.

- **Acceptance Criteria:**
  - Given a paper from a large multi-center RCT published in a top journal, when analyzed, then `hype_score` is below 20 and `verdict` is `solid_evidence`
  - Given a paper with a small sample (n=10) claiming "revolutionary results", when analyzed, then `hype_score` is above 60 and `hype_indicators` includes "small sample size with bold claims"
  - Given a paper sponsored by a competitor with favorable results only for their product, when analyzed, then `hype_indicators` includes "commercial sponsor bias"
  - Given any impact analysis, when the result is returned, then it includes `time_horizon`, `impact_magnitude`, `affected_areas`, and `confidence_level`
  - Given a paper about a new aligner material, when `affected_areas` is populated, then it includes relevant areas like "R&D", "Manufacturing", or "Product Development"
  - Given a paper with `impact_magnitude=transformative`, when the `time_horizon` is long-term, then the insight notes that monitoring is recommended rather than immediate action
  - Given the hype detection result, when `verdict` is `likely_overhyped`, then at least 2 `hype_indicators` are provided explaining why

- **Technical Notes:**
  - Combine impact analysis and hype detection in a single LLM call for efficiency
  - Use `gpt-4o` for this task (requires nuanced judgment)
  - Hype indicators to check: sample size vs claims magnitude, publication venue, funding source, reproducibility claims, statistical methodology, effect size, peer review status
  - Credibility signals: replication, pre-registration, open data, independent funding, large sample, rigorous methodology
  - Store results in `insights` table with `type=impact_analysis` and `type=hype_detection`
  - Include the paper's scientific strength score in the prompt for context
  - Pydantic models for both `ImpactAnalysis` and `HypeDetection` with strict validation

- **Dependencies:** US-015, US-016, US-019

- **Definition of Done:**
  - [ ] Impact analysis generates time horizon, magnitude, affected areas, and confidence
  - [ ] Hype detection produces score, indicators, credibility signals, and verdict
  - [ ] Results validated by Pydantic models
  - [ ] Stored in `insights` table with appropriate type tags
  - [ ] LLM prompt includes scientific strength score and paper metadata
  - [ ] Unit tests with mocked LLM responses covering all verdict types
  - [ ] Edge case handling for papers with minimal metadata

- **devPoints:** 3
- **businessPoints:** 5

---

### US-022: Full Signal Processing Pipeline

- **As a** system
- **I want** a complete signal processing pipeline that classifies, scores, generates insights, and persists all results
- **So that** each ingested paper is fully processed in a reliable, traceable sequence

- **Description:** Implement a `SignalProcessor` in `backend/app/services/signal_processor.py` that orchestrates the full processing of a paper: (1) Thematic classification (US-017), (2) Strategic bucket classification (US-018), (3) Scientific strength and strategic relevance scoring (US-019), (4) Executive summary generation in EN + ES (US-020), (5) Impact analysis and hype detection (US-021). Each step depends on the previous results. The processor handles: step-by-step execution with intermediate persistence (if step 3 fails, steps 1-2 results are still saved), paper status transitions (`new` -> `classified` -> `scored` -> `processed`), batch processing (process multiple papers concurrently with configurable parallelism), and a processing queue for pending papers. Expose API endpoints: `POST /api/v1/signals/process/{paper_id}` (process single paper), `POST /api/v1/signals/process-batch` (process all unprocessed papers), `GET /api/v1/signals/process-status` (processing queue status).

- **Acceptance Criteria:**
  - Given a newly ingested paper with status `new`, when `process()` is called, then all five processing steps execute in sequence and the paper status becomes `processed`
  - Given step 3 (scoring) fails due to an LLM error, when the pipeline handles it, then steps 1-2 results are persisted, the paper status is `classified`, and the error is logged with the step that failed
  - Given a batch of 20 unprocessed papers, when `process_batch()` is called with `parallelism=5`, then up to 5 papers are processed concurrently
  - Given `POST /api/v1/signals/process/{paper_id}`, when called, then the paper is processed and the response includes processing results and timing per step
  - Given `GET /api/v1/signals/process-status`, when called, then it returns: `total_pending`, `currently_processing`, `processed_today`, `failed_today`, `avg_processing_time_seconds`
  - Given a paper that has already been processed, when `process()` is called again, then it skips already-completed steps (idempotent) unless `force=true` is specified
  - Given the full pipeline processes a paper, when the total LLM cost is calculated, then it is logged and stored for cost monitoring

- **Technical Notes:**
  - Use a state machine pattern for paper status transitions
  - Intermediate persistence: save after classification, after scoring, after insights
  - Batch processing: use `asyncio.Semaphore` for parallelism control
  - Consider using a task queue (e.g., database-backed queue) for robust batch processing
  - Track per-step timing: `classify_ms`, `score_ms`, `insight_ms`, `total_ms`
  - Track per-step cost: `classify_cost`, `score_cost`, `insight_cost`, `total_cost`
  - Idempotency: check paper status before each step; skip if already completed
  - Force reprocessing: useful when prompts or taxonomy change

- **Dependencies:** US-017, US-018, US-019, US-020, US-021

- **Definition of Done:**
  - [ ] `SignalProcessor` orchestrates all five processing steps in sequence
  - [ ] Intermediate persistence on step failure
  - [ ] Paper status transitions correctly through the pipeline
  - [ ] Batch processing with configurable parallelism
  - [ ] API endpoints for single, batch, and status
  - [ ] Idempotent processing (skip completed steps)
  - [ ] Per-step timing and cost tracking
  - [ ] Total LLM cost logged per paper
  - [ ] Integration tests with mocked LLM provider
  - [ ] Unit tests for state transitions and error handling

- **devPoints:** 4
- **businessPoints:** 5

---

## EPIC 6: Dashboard Core (E6)

> Next.js frontend for viewing, filtering, and managing research signals.

---

### US-023: Dashboard Layout and Navigation

- **As a** the organization strategist
- **I want** a clean, professional dashboard layout with intuitive navigation
- **So that** I can efficiently navigate between different sections of the research radar

- **Description:** Implement the main dashboard layout in Next.js with: (1) **Top navigation bar**: the organization logo, app title "Karajan Radar", user avatar placeholder, settings gear icon. (2) **Sidebar navigation**: collapsible sidebar with sections: "Dashboard" (overview/home), "Signals" (signal inbox), "Analytics" (future - placeholder), "Configuration" (settings), "About". Active state indication. (3) **Main content area**: responsive container with breadcrumbs. (4) **Dashboard home page**: summary cards showing `Signals Today`, `Pending Review`, `High Priority` (composite score > 75), `Sources Active`. A recent signals mini-list (last 5). Layout uses Tailwind CSS with a professional color scheme (the organization brand: blues and whites). Responsive: works on desktop (primary) and tablet.

- **Acceptance Criteria:**
  - Given a user opens the app, when the dashboard loads, then they see the top nav bar with logo and title, the sidebar with all navigation items, and the main content area with the home page
  - Given the sidebar, when I click "Signals", then I navigate to the signals inbox page and the "Signals" nav item shows as active
  - Given the sidebar, when I click the collapse button, then the sidebar collapses to icon-only mode and the content area expands
  - Given the dashboard home page, when it loads, then I see four summary cards: "Signals Today", "Pending Review", "High Priority", "Sources Active" with real data from the API
  - Given the dashboard home page, when it loads, then I see the last 5 signals in a mini-list with title, source, composite score, and date
  - Given a tablet-width viewport (768px), when viewing the dashboard, then the layout adapts responsively (sidebar collapses, cards stack)
  - Given the API is unreachable, when the dashboard loads, then summary cards show a loading skeleton and then an error state with a retry button

- **Technical Notes:**
  - Use Next.js App Router with layout components
  - Tailwind CSS for styling; consider using `shadcn/ui` for component primitives
  - Summary cards: `GET /api/v1/dashboard/summary` endpoint returning counts
  - Recent signals: `GET /api/v1/signals?limit=5&sort=created_at:desc`
  - Use React Query (`@tanstack/react-query`) for data fetching with caching and refetching
  - Skeleton loading states for all async data
  - Color scheme: primary blue (#1e3a5f), accent (#3b82f6), background (#f8fafc)
  - Sidebar state persisted in `localStorage`

- **Dependencies:** US-001, US-004

- **Definition of Done:**
  - [ ] Dashboard layout with top nav, sidebar, and main content area
  - [ ] Sidebar navigation with all sections and active state
  - [ ] Collapsible sidebar with state persistence
  - [ ] Dashboard home page with 4 summary cards
  - [ ] Recent signals mini-list on home page
  - [ ] Responsive layout for desktop and tablet
  - [ ] Loading skeletons and error states
  - [ ] Tailwind-based design with the organization color scheme
  - [ ] Frontend unit tests for layout components

- **devPoints:** 3
- **businessPoints:** 4

---

### US-024: Signal Inbox with List/Table View

- **As a** research analyst
- **I want** a signal inbox that displays all papers in a sortable, scannable list or table view
- **So that** I can quickly browse and triage incoming research signals

- **Description:** Implement the signal inbox page at `/signals`. Two view modes togglable via buttons: (1) **List view** (default): card-based layout showing for each signal: title (clickable, links to detail), source badge (color-coded: PubMed=green, arXiv=orange, etc.), published date, composite score (circular indicator: green >75, yellow 50-75, red <50), strategic bucket tag (colored chip), primary theme tag, hype verdict badge, status badge (new/classified/scored/reviewed/archived), and a truncated executive summary (first 100 chars). (2) **Table view**: compact tabular layout with sortable columns: Title, Source, Date, Composite Score, Bucket, Theme, Hype Verdict, Status. Both views support infinite scroll pagination (load 20 signals at a time). Default sort: composite score descending.

- **Acceptance Criteria:**
  - Given I navigate to `/signals`, when the page loads, then I see the signal inbox in list view by default with the first 20 signals
  - Given the list view, when I look at a signal card, then I see: title, source badge, date, composite score indicator, bucket tag, theme tag, hype badge, status, and truncated summary
  - Given the list view, when I click the table view toggle, then the display switches to a compact table layout
  - Given the table view, when I click a column header (e.g., "Composite Score"), then the table sorts by that column; clicking again reverses the sort order
  - Given either view, when I scroll to the bottom, then the next 20 signals are loaded automatically (infinite scroll)
  - Given 0 signals in the system, when the page loads, then an empty state is shown with a message "No signals found" and a hint to check source configuration
  - Given the composite score is 82, when displayed, then the circular indicator is green; given 55, yellow; given 30, red
  - Given a signal with source "pubmed", when displayed, then the source badge is green with text "PubMed"

- **Technical Notes:**
  - Backend endpoint: `GET /api/v1/signals?page=1&per_page=20&sort=composite_score:desc`
  - Use `react-query` `useInfiniteQuery` for paginated fetching
  - Source color map: `{ pubmed: "green", arxiv: "orange", clinicaltrials: "blue", crossref: "purple", semanticscholar: "teal" }`
  - Composite score visualization: small circular SVG or CSS-based progress ring
  - Use `Intersection Observer` for infinite scroll trigger
  - Memoize card/row components for performance with large lists
  - Table view: use a lightweight table component with sort state management
  - Both views share the same data source, just different rendering

- **Dependencies:** US-023, US-022

- **Definition of Done:**
  - [ ] Signal inbox page at `/signals` with list and table view modes
  - [ ] List view shows all required fields per signal card
  - [ ] Table view with sortable columns
  - [ ] View mode toggle works correctly
  - [ ] Infinite scroll pagination (20 items per page)
  - [ ] Color-coded source badges, score indicators, and bucket tags
  - [ ] Empty state handling
  - [ ] Loading and error states
  - [ ] Frontend tests for both view modes

- **devPoints:** 4
- **businessPoints:** 5

---

### US-025: Signal Filters (Date, Source, Type, Tags, Bucket, Score, Status)

- **As a** research analyst
- **I want** powerful filtering options for the signal inbox
- **So that** I can quickly narrow down signals to exactly what I'm looking for

- **Description:** Implement a filter panel for the signal inbox. The panel sits at the top of the signal list and can be expanded/collapsed. Filters: (1) **Date range**: date picker for `published_date` from/to. (2) **Source**: multi-select checkboxes (PubMed, arXiv, ClinicalTrials, Crossref, Semantic Scholar). (3) **Theme**: multi-select dropdown from taxonomy. (4) **Strategic bucket**: multi-select chips. (5) **Composite score range**: dual-handle slider (0-100). (6) **Status**: multi-select (new, classified, scored, reviewed, archived). (7) **Hype verdict**: multi-select (solid_evidence, promising_early, needs_replication, likely_overhyped, insufficient_data). (8) **Free text search**: searches title and abstract. All filters are combinable (AND logic). Filters are reflected in URL query parameters for shareable filtered views. Include a "Clear all filters" button and an active filter count badge.

- **Acceptance Criteria:**
  - Given the filter panel is collapsed, when I click "Filters", then it expands showing all filter options
  - Given I select source "PubMed" and bucket "product_innovation", when the filters apply, then only signals from PubMed with bucket "product_innovation" are shown
  - Given I set the composite score slider to 70-100, when applied, then only signals with composite score >= 70 and <= 100 are shown
  - Given I type "aligner" in the free text search, when applied, then only signals with "aligner" in their title or abstract are shown
  - Given I apply 3 filters, when I look at the filter panel header, then I see a badge showing "3 active filters"
  - Given I have active filters, when I click "Clear all filters", then all filters are reset and the full signal list is shown
  - Given I apply filters, when I look at the URL, then the query parameters reflect the active filters (e.g., `?source=pubmed&bucket=product_innovation&score_min=70`)
  - Given I navigate to the URL with filter parameters, when the page loads, then the filters are pre-applied and the results match
  - Given I change a filter, when the signal list updates, then there is a brief loading indicator and results update without full page reload

- **Technical Notes:**
  - Backend endpoint supports query parameters: `source`, `theme`, `bucket`, `score_min`, `score_max`, `status`, `hype_verdict`, `date_from`, `date_to`, `search`
  - Use URL search params (`useSearchParams` from Next.js) for filter state
  - Debounce free text search (300ms)
  - Date picker: use `react-day-picker` or similar lightweight component
  - Score range slider: use a dual-range input component
  - Filter panel state (expanded/collapsed) persisted in `localStorage`
  - Use `react-query` cache invalidation when filters change
  - Consider backend-side full-text search with PostgreSQL `tsvector` for text search

- **Dependencies:** US-024

- **Definition of Done:**
  - [ ] Filter panel with all 8 filter types
  - [ ] Filters combinable with AND logic
  - [ ] URL query parameter sync for shareable views
  - [ ] Active filter count badge
  - [ ] Clear all filters functionality
  - [ ] Debounced text search
  - [ ] Loading state during filter application
  - [ ] Backend endpoint supports all filter parameters
  - [ ] Frontend tests for filter interactions
  - [ ] Backend tests for filtered queries

- **devPoints:** 4
- **businessPoints:** 4

---

### US-026: Signal Detail View with Full Traceability

- **As a** the organization strategist
- **I want** a comprehensive detail view for each signal showing all processed information with full traceability
- **So that** I can deeply understand a research signal and trust the AI-generated analysis by seeing the reasoning

- **Description:** Implement the signal detail page at `/signals/[id]`. Sections: (1) **Header**: title, source badge, published date, DOI link (clickable to original paper), PDF link if available, status badge with action buttons. (2) **Executive Summary**: bilingual tabs (EN/ES), key findings, the organization impact statement, recommended actions. (3) **Classification**: primary and secondary themes with confidence bars, strategic bucket with rationale, actionability badge. (4) **Scoring**: composite score (large), scientific strength breakdown (sub-scores visualized as horizontal bars), strategic relevance breakdown (sub-scores as bars), explanation text for each sub-score. (5) **Impact & Hype**: impact timeline visualization, magnitude, affected areas chips, hype score gauge (0-100), hype indicators (red chips), credibility signals (green chips), verdict badge. (6) **Paper Metadata**: authors, journal, keywords/MeSH terms, abstract (full), source-specific IDs. (7) **Traceability Footer**: model used, tokens consumed, processing cost, processing timestamp, raw LLM response toggle (expandable JSON viewer).

- **Acceptance Criteria:**
  - Given I click a signal title in the inbox, when the detail page loads, then I see all 7 sections with the paper's complete processed information
  - Given the executive summary section, when I toggle between EN and ES tabs, then the summary, key findings, and impact statement switch languages
  - Given the scoring section, when I view sub-scores, then each sub-score is displayed as a labeled horizontal bar (0-100) with the numeric value and explanation text
  - Given the hype detection section, when the hype score is above 60, then the gauge visual is in the red zone and hype indicators are prominently displayed
  - Given the traceability footer, when I click "Show raw LLM response", then a JSON viewer expands showing the complete raw response from the LLM
  - Given the DOI is available, when I click it, then it opens the original paper URL in a new tab
  - Given the detail page, when I press the back button or breadcrumb, then I return to the signal inbox with my previous filters preserved
  - Given the paper status is "scored", when I view the insight sections, then they show a placeholder "Processing pending" instead of empty content

- **Technical Notes:**
  - Backend endpoint: `GET /api/v1/signals/{id}` returning all paper data with classifications, scores, and insights joined
  - Use Next.js dynamic route `app/signals/[id]/page.tsx`
  - Sub-score bars: Tailwind CSS width-based bars or lightweight chart library
  - Hype gauge: SVG-based semicircular gauge component
  - JSON viewer: use `react-json-view` or similar for raw LLM response display
  - EN/ES tabs: client-side tab switching (both loaded in initial request)
  - Preserve inbox filters using URL state (back navigation returns with params)
  - Responsive: all sections stack vertically on smaller screens

- **Dependencies:** US-024

- **Definition of Done:**
  - [ ] Signal detail page at `/signals/[id]` with all 7 sections
  - [ ] Bilingual executive summary with tab switching
  - [ ] Sub-score visualizations for scientific strength and strategic relevance
  - [ ] Hype gauge and indicator chips
  - [ ] Full paper metadata display
  - [ ] Traceability footer with raw LLM response toggle
  - [ ] DOI and PDF links functional
  - [ ] Back navigation preserves inbox filters
  - [ ] Loading skeleton and error states
  - [ ] Frontend tests for key interactions

- **devPoints:** 4
- **businessPoints:** 5

---

### US-027: Review Status Management

- **As a** the organization strategist
- **I want** to change the review status of signals from the UI
- **So that** I can track which signals I've reviewed and which need attention

- **Description:** Implement status management for signals. Available statuses: `new` (default for unprocessed), `processed` (all LLM steps complete), `reviewing` (a strategist is looking at it), `reviewed` (strategist has reviewed), `actionable` (flagged for action), `archived` (dismissed/no longer relevant). Status changes available from: (1) Signal detail page: dropdown in the header to change status. (2) Signal inbox: quick-action button on each card/row for common transitions (e.g., "Mark Reviewed", "Archive"). (3) Bulk actions: checkbox selection in table view + bulk status change dropdown. All status changes are logged with timestamp and (future) user identity. Include a confirmation dialog for bulk operations affecting more than 10 signals. Show a toast notification on successful status change.

- **Acceptance Criteria:**
  - Given a signal with status `processed`, when I click the status dropdown on the detail page and select "Reviewing", then the status updates to `reviewing` and a toast confirms the change
  - Given the signal inbox in list view, when I click the quick-action "Mark Reviewed" on a signal card, then its status changes to `reviewed` without navigating away
  - Given the signal inbox in table view, when I select 5 signals via checkboxes and choose "Archive" from the bulk actions dropdown, then all 5 are archived and a toast confirms "5 signals archived"
  - Given a bulk action on 15 signals, when I trigger it, then a confirmation dialog appears asking "Are you sure you want to archive 15 signals?"
  - Given a status change, when I check the database, then a `status_history` entry is recorded with `old_status`, `new_status`, `changed_at`, and `changed_by`
  - Given the signal inbox, when I filter by status "new", then only unreviewed signals are shown
  - Given I change a signal's status, when the inbox list is visible, then the signal's status badge updates in real-time without a full page refresh

- **Technical Notes:**
  - Backend endpoint: `PATCH /api/v1/signals/{id}/status` with body `{"status": "reviewed"}`
  - Bulk endpoint: `PATCH /api/v1/signals/bulk-status` with body `{"ids": [...], "status": "archived"}`
  - Status history: separate table `status_history` or JSONB array on the paper record
  - Use optimistic updates in React Query for instant UI feedback
  - Toast: use a lightweight toast library (e.g., `sonner` or `react-hot-toast`)
  - Confirmation dialog: modal component for bulk actions
  - Status badge colors: new=blue, processed=purple, reviewing=yellow, reviewed=green, actionable=red, archived=gray

- **Dependencies:** US-024, US-026

- **Definition of Done:**
  - [ ] Status dropdown on signal detail page
  - [ ] Quick-action buttons in signal inbox (list and table view)
  - [ ] Bulk status change with checkbox selection in table view
  - [ ] Confirmation dialog for bulk actions (>10 signals)
  - [ ] Status change logged with timestamp
  - [ ] Toast notification on status change
  - [ ] Optimistic UI update (instant feedback)
  - [ ] Backend PATCH endpoints for single and bulk status change
  - [ ] Frontend and backend tests

- **devPoints:** 3
- **businessPoints:** 4

---

## EPIC 7: Configuration UI (E7)

> Admin interface for managing sources, themes, scoring weights, and settings.

---

### US-028: Source Management Panel

- **As a** platform administrator
- **I want** a panel to enable/disable source connectors and view their status
- **So that** I can control which scientific databases the system queries and monitor their health

- **Description:** Implement a source management page at `/config/sources`. Display each connector as a card showing: connector name, description, enabled/disabled toggle, last successful run timestamp, last run paper count, last run errors (if any), connection test button, and configuration fields (API key status: configured/missing, rate limit setting). Enable/disable toggles persist to the `connectors` table. The "Test Connection" button calls the connector's `test_connection()` method and shows the result (success/failure with details). Show a visual status indicator: green (healthy - ran successfully in last 24h), yellow (warning - ran with errors), red (failed - last run failed or no run in 48h), gray (disabled).

- **Acceptance Criteria:**
  - Given I navigate to `/config/sources`, when the page loads, then I see cards for all 5 connectors (PubMed, arXiv, ClinicalTrials, Crossref, Semantic Scholar)
  - Given a connector card, when I look at it, then I see its name, status indicator, last run info, and enable/disable toggle
  - Given the PubMed connector is enabled, when I toggle it to disabled, then the toggle persists to the database and the next ingestion run skips PubMed
  - Given I click "Test Connection" on the arXiv connector, when the test runs, then I see a spinner followed by a success or failure message with details
  - Given the Crossref connector ran successfully 2 hours ago and found 45 papers, when viewing its card, then the status is green and it shows "Last run: 2 hours ago - 45 papers"
  - Given the Semantic Scholar connector has no API key configured, when viewing its card, then the API key field shows a warning "Not configured" with a hint to add it to environment variables
  - Given a connector failed its last run, when viewing its card, then the status indicator is red and the error message is displayed

- **Technical Notes:**
  - Backend endpoints: `GET /api/v1/config/connectors`, `PATCH /api/v1/config/connectors/{id}` (enable/disable), `POST /api/v1/config/connectors/{id}/test`
  - Connector status derived from `ingestion_runs` table (last run for each source)
  - API key status: check environment variable presence (don't expose the actual key)
  - Test connection: async endpoint that runs the connector's `test_connection()` and returns result
  - Use Tailwind card components with status-colored borders
  - Optimistic toggle with rollback on failure

- **Dependencies:** US-023, US-005

- **Definition of Done:**
  - [ ] Source management page at `/config/sources`
  - [ ] Connector cards with all required information
  - [ ] Enable/disable toggle persists to database
  - [ ] Test connection button with async execution and result display
  - [ ] Status indicators (green/yellow/red/gray) based on run history
  - [ ] API key status display (configured/missing, never exposed)
  - [ ] Backend endpoints for connector management
  - [ ] Frontend and backend tests

- **devPoints:** 3
- **businessPoints:** 3

---

### US-029: Thematic Configuration (Topics, Keywords Positive/Negative)

- **As a** platform administrator
- **I want** to configure the thematic taxonomy and associated keywords
- **So that** I can tune the classification system to our evolving research interests

- **Description:** Implement a thematic configuration page at `/config/themes`. Display the current taxonomy as an editable list. For each theme: name, description (used in LLM prompt), positive keywords (boost classification toward this theme), negative keywords (reduce classification toward this theme), enabled/disabled toggle. Allow: adding new themes, editing existing themes, disabling themes (they stop appearing in new classifications but historical data is preserved), reordering themes by drag-and-drop. Include a "Preview" function that takes a sample paper title+abstract and runs the classification with the current configuration to show expected results. Changes are saved explicitly via a "Save Changes" button (not auto-save) with a confirmation dialog showing a diff of changes.

- **Acceptance Criteria:**
  - Given I navigate to `/config/themes`, when the page loads, then I see the current taxonomy with all themes listed with their descriptions and keywords
  - Given I click "Add Theme", when I fill in name, description, positive/negative keywords and save, then the new theme appears in the list and is available for future classifications
  - Given an existing theme, when I edit its description or keywords and click "Save Changes", then a confirmation dialog shows what changed and the theme is updated in the database
  - Given I disable a theme, when future classifications run, then the disabled theme is excluded from the taxonomy sent to the LLM
  - Given I disable a theme, when viewing historical classifications, then papers previously classified with that theme still show the classification
  - Given I enter a paper title and abstract in the "Preview" panel, when I click "Preview Classification", then the system runs a classification with the current (unsaved) configuration and shows the result
  - Given I reorder themes via drag-and-drop, when saved, then the new order is reflected in the LLM prompt and the configuration page

- **Technical Notes:**
  - Backend endpoints: `GET /api/v1/config/themes`, `PUT /api/v1/config/themes` (full replacement), `POST /api/v1/config/themes/preview` (preview classification)
  - Store themes in `config` table with `key=taxonomy` as a JSONB object
  - Preview endpoint: calls the LLM classification with the provided config (temporary, not persisted)
  - Drag-and-drop: use `dnd-kit` or similar React DnD library
  - Keywords: stored as arrays, used as additional context in the LLM prompt
  - Show a diff view before saving (old vs new configuration)
  - Include a "Reset to defaults" button

- **Dependencies:** US-023, US-017

- **Definition of Done:**
  - [ ] Thematic configuration page at `/config/themes`
  - [ ] Full CRUD for themes (add, edit, disable, reorder)
  - [ ] Positive/negative keywords per theme
  - [ ] Preview function with sample paper input
  - [ ] Save with confirmation dialog showing diff
  - [ ] Historical classifications preserved when theme disabled
  - [ ] Drag-and-drop reordering
  - [ ] Backend endpoints for theme configuration
  - [ ] Frontend and backend tests

- **devPoints:** 3
- **businessPoints:** 4

---

### US-030: Scoring Weights Editor

- **As a** the organization strategist
- **I want** to adjust the scoring weights used for scientific strength and strategic relevance
- **So that** the composite score reflects our current strategic priorities

- **Description:** Implement a scoring weights editor at `/config/scoring`. Display: (1) **Composite formula weights**: sliders for `scientific_strength_weight` (w1) and `strategic_relevance_weight` (w2) with a visual formula display showing `composite = (SS * w1 + SR * w2) / (w1 + w2)`. (2) **Scientific strength sub-weights**: sliders for `study_type`, `sample_size`, `methodology_rigor`, `journal_impact`, `citation_signal` (each 0-100, normalized). (3) **Strategic relevance sub-weights**: sliders for `organization_alignment`, `commercial_applicability`, `time_to_impact`, `competitive_advantage`, `market_potential` (each 0-100, normalized). Include a "Live Preview" panel showing how 5 sample papers would be rescored with the current weights. Include a "Reset to defaults" button. Changes saved explicitly with a confirmation showing the before/after of sample paper scores.

- **Acceptance Criteria:**
  - Given I navigate to `/config/scoring`, when the page loads, then I see the current weights for composite, scientific strength sub-weights, and strategic relevance sub-weights
  - Given I adjust `strategic_relevance_weight` from 0.6 to 0.8, when the live preview updates, then the sample papers' composite scores shift to favor strategic relevance
  - Given I change the `study_type` sub-weight from 20 to 40, when the live preview updates, then papers with high study-type scores (RCTs) rank higher
  - Given I click "Save Changes", when the confirmation dialog shows, then I see the old and new weights side-by-side and the before/after composite scores for sample papers
  - Given weights are saved, when new papers are processed, then they use the updated weights
  - Given weights are saved, when viewing previously scored papers, then their scores are NOT retroactively changed (the `weights_snapshot` preserves the original weights)
  - Given I click "Reset to defaults", when confirmed, then all weights return to the system defaults (w1=0.4, w2=0.6, equal sub-weights)

- **Technical Notes:**
  - Backend endpoints: `GET /api/v1/config/scoring-weights`, `PUT /api/v1/config/scoring-weights`, `POST /api/v1/config/scoring-weights/preview` (preview rescoring)
  - Store weights in `config` table with `key=scoring_weights` as JSONB
  - Sliders: use a range input component with labels and numeric display
  - Live preview: debounced (500ms) call to preview endpoint with current slider values
  - Formula visualization: render the formula with current weight values highlighted
  - Sample papers for preview: pick 5 papers spanning different score ranges
  - Sub-weight normalization: UI shows 0-100, backend normalizes to percentages summing to 1.0

- **Dependencies:** US-023, US-019

- **Definition of Done:**
  - [ ] Scoring weights editor page at `/config/scoring`
  - [ ] Composite weight sliders with formula visualization
  - [ ] Scientific strength and strategic relevance sub-weight sliders
  - [ ] Live preview with 5 sample papers
  - [ ] Save with confirmation and before/after comparison
  - [ ] Reset to defaults functionality
  - [ ] Previously scored papers not retroactively changed
  - [ ] Backend endpoints for weights management
  - [ ] Frontend and backend tests

- **devPoints:** 3
- **businessPoints:** 4

---

### US-031: Delivery and General Settings

- **As a** platform administrator
- **I want** a general settings page to configure delivery options and system preferences
- **So that** I can control how and when research signals are delivered to the team

- **Description:** Implement a settings page at `/config/settings`. Sections: (1) **Ingestion Schedule**: display current Cloud Run Job schedule (read-only for MVP, indicates it's managed via GCP), manual trigger button ("Run Ingestion Now"), last run summary. (2) **Delivery Settings**: Teams webhook URL (masked input), daily digest time (time picker), digest day filter (weekdays only toggle), digest language preference (EN, ES, or both). (3) **LLM Settings**: active provider display, model configuration per task (classify, score, insight), token budget per day (max spend), current day's token usage. (4) **System**: app version, database stats (total papers, total processed, storage estimate), export data button (CSV export of all signals). All settings saved to the `config` table.

- **Acceptance Criteria:**
  - Given I navigate to `/config/settings`, when the page loads, then I see all four settings sections
  - Given the ingestion schedule section, when I click "Run Ingestion Now", then the ingestion orchestrator is triggered and a progress indicator shows until completion
  - Given the delivery settings section, when I enter a Teams webhook URL and click save, then the URL is stored (masked in UI, encrypted at rest)
  - Given the digest time is set to 08:00, when the daily digest runs, then it sends at 08:00 in the configured timezone
  - Given the LLM settings section, when I view token usage, then it shows today's consumption vs the daily budget (e.g., "12,450 / 100,000 tokens used")
  - Given the daily token budget is reached, when the signal processor runs, then it queues remaining papers for the next day rather than exceeding the budget
  - Given I click "Export Data", when the export runs, then a CSV file downloads containing all signals with key fields (title, DOI, source, themes, bucket, scores, status, dates)
  - Given the system section, when I view database stats, then it shows total papers count, processed count, and approximate storage size

- **Technical Notes:**
  - Backend endpoints: `GET /api/v1/config/settings`, `PUT /api/v1/config/settings`, `POST /api/v1/config/settings/trigger-ingestion`, `GET /api/v1/config/settings/export`
  - Webhook URL: store encrypted in database using Fernet symmetric encryption (key from environment)
  - Token budget tracking: increment counter in `config` table per LLM call, reset daily via cron
  - CSV export: generate server-side using `pandas` or `csv` module, stream as download
  - Manual ingestion trigger: reuse the `POST /api/v1/ingestion/run` endpoint
  - Database stats: use PostgreSQL `pg_total_relation_size` for storage estimates

- **Dependencies:** US-023, US-014, US-015

- **Definition of Done:**
  - [ ] Settings page at `/config/settings` with all four sections
  - [ ] Manual ingestion trigger with progress feedback
  - [ ] Teams webhook URL management (masked, encrypted)
  - [ ] Digest schedule configuration
  - [ ] LLM token budget display and enforcement
  - [ ] CSV data export functionality
  - [ ] Database stats display
  - [ ] Backend endpoints for all settings operations
  - [ ] Frontend and backend tests

- **devPoints:** 3
- **businessPoints:** 3

---

## EPIC 8: Teams Integration (E8)

> Daily digest generation and delivery to Microsoft Teams.

---

### US-032: Daily Digest Generation Service

- **As a** system
- **I want** a service that generates a daily digest of the most relevant research signals
- **So that** the the organization team receives a curated summary without needing to visit the dashboard

- **Description:** Implement a `DigestService` in `backend/app/services/digest.py`. The service generates a daily digest containing: (1) **Header**: "Karajan Radar - Daily Digest" with date. (2) **Summary Stats**: new signals today, high-priority count, sources queried, breakdown by bucket. (3) **Top Signals** (max 10): ordered by composite score, each showing: title, source, composite score, strategic bucket, hype verdict, executive summary (first 2 sentences in configured language), and a link to the signal detail page. (4) **Alerts**: any signals with `actionability=immediate` highlighted separately. (5) **Trend Note**: if a particular theme or bucket has significantly more papers than usual (>2x 30-day average), flag it as a trend. The digest is generated as a structured object that can be rendered into different formats (Teams Adaptive Card, HTML email, plain text).

- **Acceptance Criteria:**
  - Given the daily digest runs after ingestion, when 15 new signals were processed today, then the digest includes summary stats showing 15 new signals with breakdown by bucket
  - Given the top signals section, when the digest is generated, then it includes up to 10 signals ordered by composite score descending
  - Given a signal with `actionability=immediate`, when the digest is generated, then it appears in a separate "Immediate Action Required" section at the top
  - Given the configured language is "es", when the digest is generated, then executive summaries are in Spanish
  - Given the `ai_ml_applications` theme has 8 papers today vs a 30-day average of 3, when the digest is generated, then a trend note highlights "Unusual activity in AI/ML Applications (8 vs avg 3)"
  - Given no new signals today, when the digest is generated, then it includes a "No new signals today" message instead of empty sections
  - Given the digest is generated, when rendered for Teams, then it produces a valid Adaptive Card JSON; when rendered for plain text, then it produces readable text

- **Technical Notes:**
  - Digest data model: `DigestContent(date, summary_stats, top_signals, alerts, trends)`
  - Trend detection: compare today's theme/bucket counts against 30-day rolling average from `ingestion_runs` + `classifications`
  - Renderer pattern: `DigestRenderer` base class with `TeamsCardRenderer`, `PlainTextRenderer`, `HtmlRenderer` implementations
  - Top signals query: `SELECT * FROM papers JOIN scores ON ... WHERE created_at >= today ORDER BY composite_score DESC LIMIT 10`
  - Signal detail link: `{FRONTEND_URL}/signals/{paper_id}`
  - Store generated digests in `digest_logs` table for history and debugging

- **Dependencies:** US-022, US-014

- **Definition of Done:**
  - [ ] `DigestService` generates daily digest with all sections
  - [ ] Top 10 signals by composite score included
  - [ ] Immediate action alerts highlighted separately
  - [ ] Trend detection flags unusual activity
  - [ ] Multi-language support (EN/ES) for executive summaries
  - [ ] Renderer pattern supports Teams, plain text, and HTML output
  - [ ] Empty day handling (no signals message)
  - [ ] Digest stored in `digest_logs` table
  - [ ] Unit tests for digest generation and trend detection

- **devPoints:** 3
- **businessPoints:** 5

---

### US-033: Teams Webhook Delivery

- **As a** the organization strategist
- **I want** the daily digest delivered to a Microsoft Teams channel via webhook
- **So that** the team sees the research radar summary in our primary communication tool without leaving Teams

- **Description:** Implement a `TeamsDeliveryService` in `backend/app/services/teams_delivery.py`. The service: (1) Renders the digest as a Microsoft Teams Adaptive Card (JSON format). (2) Posts the card to the configured Teams incoming webhook URL. (3) Handles delivery failures with retry (3 attempts, exponential backoff). (4) Logs delivery status in `digest_logs` (sent, failed, retrying). The Adaptive Card design: header with the organization logo and date, collapsible sections for stats/alerts/top signals/trends, each signal as a compact row with score badge and clickable title linking to the dashboard detail view. The card must comply with Teams Adaptive Card schema v1.4 and fit within the 28KB payload limit.

- **Acceptance Criteria:**
  - Given the digest is generated, when the Teams delivery service sends it, then a well-formatted Adaptive Card appears in the configured Teams channel
  - Given the Adaptive Card, when viewed in Teams, then it shows: header with date, summary stats, alerts section (if any), top signals with clickable titles, and trend notes
  - Given a signal title in the card, when clicked, then it opens the signal detail page in the browser
  - Given the webhook URL is invalid, when delivery fails, then the service retries 3 times with exponential backoff and logs the failure
  - Given the webhook URL is not configured, when the delivery service runs, then it logs a warning and skips delivery (no crash)
  - Given the Adaptive Card payload exceeds 28KB, when generated, then the service truncates lower-priority signals to fit within the limit
  - Given a successful delivery, when `digest_logs` is checked, then it records `status=sent`, `sent_at`, `webhook_status_code=200`, and `payload_size_bytes`
  - Given a failed delivery after all retries, when `digest_logs` is checked, then it records `status=failed` with the error details

- **Technical Notes:**
  - Teams Incoming Webhook accepts POST with Adaptive Card JSON wrapped in `{"type": "message", "attachments": [{"contentType": "application/vnd.microsoft.card.adaptive", "content": {...}}]}`
  - Adaptive Card schema: `"$schema": "http://adaptivecards.io/schemas/adaptive-card.json"`, `"version": "1.4"`
  - Use `TextBlock`, `ColumnSet`, `ActionSet`, `Action.OpenUrl` for card layout
  - Payload limit: 28KB for Adaptive Cards; monitor and truncate if needed
  - Retry: use `tenacity` with exponential backoff (1s, 2s, 4s)
  - Consider using Adaptive Card templating for cleaner code
  - Webhook URL from encrypted config (see US-031)

- **Dependencies:** US-032, US-031

- **Definition of Done:**
  - [ ] `TeamsDeliveryService` renders and posts Adaptive Card
  - [ ] Card complies with Adaptive Card schema v1.4
  - [ ] Card payload within 28KB limit (with truncation fallback)
  - [ ] Clickable signal titles link to dashboard
  - [ ] Retry logic on delivery failure (3 attempts)
  - [ ] Delivery status logged in `digest_logs`
  - [ ] Graceful handling of missing webhook URL
  - [ ] Unit tests with mocked webhook endpoint
  - [ ] Integration test with a real Teams webhook (manual verification)

- **devPoints:** 3
- **businessPoints:** 5

---

### US-034: Digest Configuration from Dashboard

- **As a** platform administrator
- **I want** to configure the daily digest parameters from the dashboard
- **So that** I can adjust what the team receives without modifying code or environment variables

- **Description:** Extend the settings page (US-031) with a dedicated "Daily Digest" configuration section. Options: (1) **Enable/disable digest**: master toggle. (2) **Delivery time**: time picker with timezone selector. (3) **Max signals in digest**: number input (default 10, max 20). (4) **Minimum composite score**: threshold slider - only signals above this score are included (default 50). (5) **Include sections**: checkboxes for Stats, Alerts, Top Signals, Trends (all enabled by default). (6) **Language**: radio buttons for EN, ES, or Both. (7) **Preview & Test**: button that generates the digest with current settings and either (a) displays a preview in the browser or (b) sends a test message to the Teams webhook. Show the last 7 digest deliveries with their status, timestamp, and signal count.

- **Acceptance Criteria:**
  - Given I navigate to the digest configuration section, when the page loads, then I see all 7 configuration options with their current values
  - Given the digest is disabled via the master toggle, when the scheduled delivery time arrives, then no digest is generated or sent
  - Given I set the minimum composite score to 70, when the next digest generates, then only signals with composite score >= 70 are included
  - Given I set max signals to 5, when the next digest generates, then no more than 5 signals appear in the top signals section
  - Given I select language "Both", when the digest generates, then each signal includes executive summaries in both EN and ES
  - Given I click "Preview", when the preview generates, then I see the digest rendered as it would appear in Teams, displayed in a modal on the dashboard
  - Given I click "Send Test", when the test message sends, then a test digest is delivered to the Teams webhook with a "[TEST]" prefix in the header
  - Given the delivery history section, when I view it, then I see the last 7 deliveries with status (sent/failed), timestamp, and number of signals included

- **Technical Notes:**
  - Backend endpoints: `GET /api/v1/config/digest`, `PUT /api/v1/config/digest`, `POST /api/v1/config/digest/preview`, `POST /api/v1/config/digest/test`
  - Store digest config in `config` table with `key=digest_settings` as JSONB
  - Preview endpoint: generates the digest and returns the Adaptive Card JSON + rendered HTML preview
  - Test endpoint: generates and sends a real digest to the webhook with `[TEST]` prefix
  - Delivery history: query `digest_logs` ordered by `created_at DESC LIMIT 7`
  - Time picker with timezone: use a timezone-aware component; store as UTC internally
  - Validate that delivery time is within a reasonable range and not in the past

- **Dependencies:** US-031, US-032, US-033

- **Definition of Done:**
  - [ ] Digest configuration section in settings page
  - [ ] All 7 configuration options functional
  - [ ] Master enable/disable toggle prevents digest generation when off
  - [ ] Preview renders digest in browser modal
  - [ ] Test send delivers to Teams webhook with [TEST] prefix
  - [ ] Delivery history shows last 7 digests
  - [ ] Configuration persisted to database
  - [ ] Backend endpoints for digest configuration
  - [ ] Frontend and backend tests

- **devPoints:** 3
- **businessPoints:** 4

---

## Summary Table

| Epic | Story | Title | devPoints | businessPoints | Priority Score |
|------|-------|-------|-----------|----------------|---------------|
| E1 | US-001 | Project Skeleton | 3 | 5 | 167 |
| E1 | US-002 | Database Schema and Alembic Migrations | 3 | 4 | 133 |
| E1 | US-003 | CI Pipeline | 2 | 4 | 200 |
| E1 | US-004 | Health Check and API Versioning | 2 | 3 | 150 |
| E2 | US-005 | Base Connector Interface | 3 | 5 | 167 |
| E2 | US-006 | PubMed Connector | 3 | 5 | 167 |
| E2 | US-007 | arXiv Connector | 3 | 4 | 133 |
| E2 | US-008 | ClinicalTrials.gov Connector | 3 | 4 | 133 |
| E2 | US-009 | Crossref Connector | 3 | 3 | 100 |
| E2 | US-010 | Semantic Scholar Connector | 3 | 3 | 100 |
| E3 | US-011 | Normalization Service | 3 | 4 | 133 |
| E3 | US-012 | Deduplication Service | 3 | 4 | 133 |
| E3 | US-013 | Ingestion Orchestrator | 4 | 5 | 125 |
| E3 | US-014 | Daily Ingestion Cloud Run Job | 3 | 4 | 133 |
| E4 | US-015 | LLM Provider Abstraction Layer | 4 | 5 | 125 |
| E4 | US-016 | OpenAI Provider Implementation | 3 | 4 | 133 |
| E4 | US-017 | Thematic Classification | 3 | 5 | 167 |
| E4 | US-018 | Strategic Bucket Classification | 2 | 5 | 250 |
| E4 | US-019 | Scoring with Explainability | 3 | 5 | 167 |
| E5 | US-020 | Executive Summary Generation (EN+ES) | 3 | 5 | 167 |
| E5 | US-021 | Impact Analysis and Hype Detection | 3 | 5 | 167 |
| E5 | US-022 | Full Signal Processing Pipeline | 4 | 5 | 125 |
| E6 | US-023 | Dashboard Layout and Navigation | 3 | 4 | 133 |
| E6 | US-024 | Signal Inbox (List/Table View) | 4 | 5 | 125 |
| E6 | US-025 | Signal Filters | 4 | 4 | 100 |
| E6 | US-026 | Signal Detail View | 4 | 5 | 125 |
| E6 | US-027 | Review Status Management | 3 | 4 | 133 |
| E7 | US-028 | Source Management Panel | 3 | 3 | 100 |
| E7 | US-029 | Thematic Configuration | 3 | 4 | 133 |
| E7 | US-030 | Scoring Weights Editor | 3 | 4 | 133 |
| E7 | US-031 | Delivery and General Settings | 3 | 3 | 100 |
| E8 | US-032 | Daily Digest Generation Service | 3 | 5 | 167 |
| E8 | US-033 | Teams Webhook Delivery | 3 | 5 | 167 |
| E8 | US-034 | Digest Configuration from Dashboard | 3 | 4 | 133 |

> **Priority Score** = (businessPoints / devPoints) * 100. Higher = implement first.

### Totals by Epic

| Epic | Stories | devPoints | businessPoints |
|------|---------|-----------|----------------|
| E1: Bootstrap & Infrastructure | 4 | 10 | 16 |
| E2: Source Connectors | 6 | 18 | 24 |
| E3: Ingestion Pipeline | 4 | 13 | 17 |
| E4: LLM & Classification | 5 | 15 | 24 |
| E5: Insight Generation | 3 | 10 | 15 |
| E6: Dashboard Core | 5 | 18 | 22 |
| E7: Configuration UI | 4 | 12 | 14 |
| E8: Teams Integration | 3 | 9 | 14 |
| **TOTAL** | **34** | **105** | **146** |

### Recommended Sprint Planning (3 Sprints)

**Sprint 1 - Foundation (devPoints: ~38)**
- E1 complete: US-001, US-002, US-003, US-004
- E2 start: US-005, US-006, US-007, US-008
- E3 start: US-011

**Sprint 2 - Pipeline & Intelligence (devPoints: ~37)**
- E2 finish: US-009, US-010
- E3 finish: US-012, US-013, US-014
- E4 complete: US-015, US-016, US-017, US-018, US-019

**Sprint 3 - Insights & Dashboard (devPoints: ~30)**
- E5 complete: US-020, US-021, US-022
- E6 complete: US-023, US-024, US-025, US-026, US-027
- E7 complete: US-028, US-029, US-030, US-031
- E8 complete: US-032, US-033, US-034

# Karajan Radar - TDD & Quality Strategy

## 1. TDD Workflow

Every feature follows the Red-Green-Refactor cycle:

1. **Red:** Write a failing test that defines the expected behavior
2. **Green:** Write the minimum code to make the test pass
3. **Refactor:** Clean up while keeping tests green

### Test-First Rules
- No production code without a failing test first
- Tests define the contract, not the implementation
- Run tests after EVERY significant change
- Failing tests must be fixed before continuing
- Never skip tests or mark them as `@pytest.mark.skip` without a tracked issue

## 2. Test Pyramid

```
         ┌───────────┐
         │   E2E     │  Playwright (critical user flows)
         │  (few)    │
         ├───────────┤
         │Integration│  pytest (pipeline flows, API + DB)
         │ (some)    │
         ├───────────┤
         │   Unit    │  pytest (backend) + vitest (frontend)
         │  (many)   │  Fast, isolated, no external deps
         └───────────┘
```

## 3. Backend Testing (pytest)

### Framework & Tools
- **pytest** with `pytest-asyncio` for async tests
- **pytest-cov** for coverage reporting
- **httpx** + `TestClient` (FastAPI) for API tests
- **factory_boy** for test data factories
- **freezegun** for time-dependent tests
- **respx** for mocking HTTP requests (connectors)

### Test Organization
```
tests/
├── conftest.py              # Shared fixtures, test DB session, factories
├── unit/
│   ├── test_normalization.py
│   ├── test_deduplication.py
│   ├── test_scoring.py
│   ├── test_classification.py
│   ├── test_connectors/
│   │   ├── test_pubmed.py       # Mocked XML responses
│   │   ├── test_arxiv.py        # Mocked Atom feed
│   │   └── ...
│   ├── test_llm/
│   │   ├── test_prompts.py      # Prompt formatting, JSON parsing
│   │   └── test_providers.py    # Provider interface compliance
│   └── test_api/
│       ├── test_signals.py
│       ├── test_health.py
│       └── test_configuration.py
├── integration/
│   ├── test_pipeline.py         # Full pipeline with test DB
│   └── test_ingestion.py        # Connector → normalize → persist
└── fixtures/
    ├── pubmed_response.xml
    ├── arxiv_response.xml
    ├── clinical_trials_response.json
    ├── crossref_response.json
    ├── semantic_scholar_response.json
    └── mock_research_items.json
```

### Coverage Targets
| Module | Minimum Coverage |
|--------|-----------------|
| `pipeline/` (normalization, dedup, scoring, classification) | 90% |
| `connectors/` | 85% |
| `llm/` | 80% |
| `api/` | 80% |
| `delivery/` | 80% |
| `models/`, `schemas/` | 70% |

### Key Test Strategies

#### Connector Tests
- Mock HTTP responses with realistic fixtures (actual XML/JSON from each API)
- Test parsing of edge cases: missing abstracts, malformed dates, empty results
- Test rate limiting behavior
- Test retry logic with simulated failures
- Integration tests marked `@pytest.mark.external` (not run in CI by default)

#### LLM Tests
- Mock LLM responses (no real API calls in unit tests)
- Test prompt formatting produces valid input
- Test JSON output parsing handles all expected structures
- Test error handling for malformed LLM responses
- Test anti-hallucination guards (confidence_level, facts vs interpretation split)
- Test prompt versioning (correct prompt loaded for version)

#### Pipeline Tests
- Test each stage independently (normalization, dedup, classification, scoring)
- Integration test: full pipeline with test database
- Test deduplication catches DOI matches, content hash matches, fuzzy title matches
- Test scoring produces explainable results with reasons

#### API Tests
- Test all CRUD operations for signals
- Test filter combinations (date + source + score + status)
- Test pagination
- Test error responses for invalid input
- Test health/ready endpoints with DB up and down

## 4. Frontend Testing (vitest + React Testing Library)

### Framework & Tools
- **vitest** for unit/integration tests
- **React Testing Library** for component tests
- **MSW (Mock Service Worker)** for API mocking
- **Playwright** for E2E tests (later phase)

### Coverage Targets
| Area | Minimum Coverage |
|------|-----------------|
| Components | 70% |
| Hooks | 80% |
| Utils/lib | 90% |

### Key Test Strategies
- Test components render correctly with mock data
- Test user interactions (click, filter, status change)
- Test API integration with MSW intercepting requests
- Test error states and loading states

## 5. Branch Strategy

### Branch Naming
```
main                          # Production-ready code
feat/KRD-TSK-XXXX-short-desc  # Feature branches (from user stories)
fix/KRD-BUG-XXXX-short-desc   # Bug fix branches
refactor/KRD-TSK-XXXX-desc    # Refactoring branches
chore/description              # Infrastructure, CI, config changes
```

### Branch Rules
- `main` is protected: no direct pushes
- All changes via Pull Request
- PRs require CI pass before merge
- One branch per user story or coherent slice
- Branches are short-lived (merge within days, not weeks)
- Delete branch after merge

### Workflow
```
main ─────────────────────────────────────────────
       \                    /
        feat/KRD-TSK-0001 ─  (PR → review → merge)
         \         /
          commits (small, atomic)
```

## 6. Commit Convention

**Conventional Commits** format:
```
<type>(<scope>): <short description>

[optional body with more details]

[optional footer: BREAKING CHANGE, Refs, etc.]
```

### Types
| Type | When |
|------|------|
| `feat` | New feature |
| `fix` | Bug fix |
| `refactor` | Code refactoring (no behavior change) |
| `test` | Adding or updating tests |
| `docs` | Documentation only |
| `chore` | Build, CI, config, dependencies |
| `style` | Formatting (no logic change) |

### Scope Examples
- `connectors`, `pipeline`, `llm`, `api`, `dashboard`, `config`, `delivery`, `db`, `ci`

### Examples
```
feat(connectors): add PubMed connector with E-utilities API
test(connectors): add unit tests for PubMed XML parsing
fix(pipeline): handle missing abstracts in normalization
refactor(llm): extract prompt formatting to separate module
chore(ci): add PostgreSQL service to backend CI workflow
```

### Rules
- First line < 70 characters
- Imperative mood ("add" not "added")
- No references to AI/Claude in commit messages
- Body explains WHY, not WHAT (the diff shows the what)

## 7. PR Strategy

### PR Size
- **Maximum ~300 lines changed** (ideal < 200)
- One PR per user story or per coherent vertical slice
- If a story is too big, split into sub-PRs

### PR Template
```markdown
## Summary
- Brief description of what this PR does

## Changes
- Bullet list of key changes

## Testing
- [ ] Unit tests added/updated
- [ ] Integration tests (if applicable)
- [ ] Manual testing done

## Screenshots
(if UI changes)

## Checklist
- [ ] Tests pass locally
- [ ] Linting clean
- [ ] No new warnings
- [ ] Documentation updated (if applicable)
```

### Review Strategy
- All PRs require at least 1 review
- Reviewer checks: correctness, tests, quality, security
- Use GitHub suggested changes for small fixes
- Block merge if quality gates fail
- Prefer "squash and merge" for clean history

## 8. Quality Gates

### CI Pipeline (GitHub Actions)

#### Backend (`ci-backend.yml`)
```
Trigger: push to main, all PRs
Steps:
  1. Setup Python 3.12
  2. Install dependencies (uv)
  3. Ruff check (lint + format)
  4. Mypy (type checking)
  5. Pytest with coverage
  6. Upload coverage report
  7. Fail if coverage < thresholds
```

#### Frontend (`ci-frontend.yml`)
```
Trigger: push to main, all PRs
Steps:
  1. Setup Node 20 + pnpm
  2. Install dependencies
  3. ESLint
  4. TypeScript check (tsc --noEmit)
  5. Vitest with coverage
  6. Upload coverage report
  7. Fail if coverage < thresholds
```

### SonarQube Integration
- `sonar-project.properties` configured at project root
- Analyze before commit (local) or in CI
- Quality gate rules:
  - No new bugs
  - No new vulnerabilities
  - No new security hotspots (unreviewed)
  - Coverage on new code >= 80%
  - Duplicated lines on new code < 3%

### Merge Requirements
- CI passes (both backend and frontend)
- At least 1 approval
- No unresolved review comments
- Branch up to date with main

## 9. Linting & Formatting

### Backend
- **Ruff** for linting and formatting (replaces flake8 + black + isort)
  - Line length: 120
  - Rules: E, W, F, I, N, UP, B, SIM, TCH
- **Mypy** for type checking (strict for new code)

### Frontend
- **ESLint** with Next.js recommended + TypeScript rules
- **Prettier** for formatting (integrated with ESLint)
- **TypeScript** strict mode

## 10. Test Data & Fixtures

### Mock Scientific Data
Create realistic fixtures from actual API responses:
- PubMed: 10+ papers with varied metadata (with/without abstracts, multiple authors)
- arXiv: 10+ preprints in relevant categories
- ClinicalTrials: 5+ trials in different phases and statuses
- Crossref: 10+ works with DOIs and citation counts
- Semantic Scholar: 10+ papers with TLDR and citation metrics

### Mock LLM Responses
- Classification output (thematic tags, strategic buckets)
- Scoring output (scores with structured reasons)
- Insight output (summaries EN+ES, impact, hype assessment)
- Error/malformed responses for testing error handling

### Factory Patterns
```python
# Example with factory_boy
class ResearchItemFactory(factory.Factory):
    class Meta:
        model = ResearchItem

    title = factory.Faker("sentence", nb_words=10)
    abstract = factory.Faker("paragraph", nb_sentences=5)
    doi = factory.LazyAttribute(lambda o: f"10.1234/{factory.Faker('uuid4')}")
    publication_date = factory.Faker("date_between", start_date="-1y")
    document_type = "paper"
    review_status = "review"
    ...
```

## 11. Development Environment

### Tools Required
- Docker + Docker Compose
- Python 3.12+ with `uv`
- Node.js 20+ with `pnpm`
- Git

### Quick Start
```bash
# Clone and setup
git clone git@github.com:manufosela/karajan-radar.git
cd karajan-radar
cp .env.example .env

# Start all services
make up

# Run backend tests
make test-backend

# Run frontend tests
make test-frontend

# Run all tests
make test

# Lint everything
make lint
```

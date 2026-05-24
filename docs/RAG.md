# RAG — Retrieval-Augmented Generation

> Since v2.22.0. Auto-bootstrapped since v2.26.0. Per-project isolation since v2.27.0.

Karajan ships a local RAG (Retrieval-Augmented Generation) stack that indexes your project's plans, onboarding briefs and (optionally) source files into a vector store, then lets any consumer — CLI, agents via MCP, slash commands, the HU Board, or the pre-loop stage — query it semantically before deciding what to build, refactor or research.

## Quick start

```bash
# Bootstrap (already done by kj init since v2.26.0)
kj init                       # provisions Ollama in Docker + nomic-embed-text

# Index this project
kj rag index                  # plans + onboarding only
kj rag index --with-sources   # plans + onboarding + every .js/.ts under src/

# Query
kj rag query "how does the model router pick a coder"
kj rag query "auth flow" --scope plans
kj rag query "rate limiting" --top-k 10 --json
```

## Architecture

```
┌───────────────────────────────────────────────────────┐
│ Consumers                                             │
│ ───────────                                           │
│ • kj rag query              (CLI)                     │
│ • MCP kj_rag_query tool     (Claude Desktop, Cursor)  │
│ • /kj-rag-query slash       (Skills hosts w/o MCP)    │
│ • HU Board search panel     (web UI)                  │
│ • Pre-loop auto-retrieval   (transparent to agents)   │
│ • Role instructions         (per-role guidance)       │
└───────────────────────────────────────────────────────┘
                       │
                       ▼
┌───────────────────────────────────────────────────────┐
│ src/rag/retriever.js  ─ over-fetch + kind boost       │
│ src/rag/vec-store.js  ─ sqlite-vec cosine search      │
│ src/rag/embedder.js   ─ OllamaEmbedder                │
│ src/rag/chunker.js    ─ md / plan / source chunkers   │
│ src/rag/indexer.js    ─ project walker + idempotence  │
└───────────────────────────────────────────────────────┘
                       │
                       ▼
        ┌────────────────────────────┐
        │ ~/.karajan/rag.db          │
        │ (sqlite-vec, ~21 MB / 7K   │
        │  chunks per medium repo)   │
        └────────────────────────────┘
                       │
                       ▼
        ┌────────────────────────────┐
        │ Docker: kj-ollama          │
        │ http://localhost:11434     │
        │ nomic-embed-text (274 MB)  │
        └────────────────────────────┘
```

## Installation

`kj init` provisions everything automatically when Docker is available and the host has ≥ 4 GB free RAM:

1. **Capability check** (`src/rag/ollama-capability.js`) — confirms Docker daemon + RAM threshold.
2. **Container start** — `docker compose up -d` against `~/.karajan/docker-compose.ollama.yml`.
3. **Health gate** — `waitForOllamaReady` polls `/api/tags`.
4. **Model pull** — `docker exec kj-ollama ollama pull nomic-embed-text` (~270 MB on first run, cached afterwards in the `kj_ollama_data` volume).

Opt out with `kj init --no-ollama`. On hosts where Karajan refuses to bootstrap, the wizard logs the reason (`docker:not-installed`, `docker:daemon-unreachable`, `ram:insufficient`) and continues — init never crashes.

If Ollama is already running on `:11434` (e.g. installed manually), Karajan detects it via discover-before-spawn and **reuses** that instance instead of starting a second container.

## Workflows

### 1. Index

```bash
kj rag index                  # plans + onboarding
kj rag index --with-sources   # + .js/.ts/.tsx/.jsx under projectDir
```

Walked dirs are filtered by `SKIP = {node_modules, .git, dist, build, coverage, .karajan, .next, .kj, _diet}`. `.kj/` and `_diet/` are scratch sandboxes Karajan itself creates during `kj run` and the test-diet audit harness — never user code.

Indexing is **idempotent**: calling `indexFile` on the same path replaces its chunks, never duplicates.

### 2. Query (CLI)

```bash
kj rag query "<text>" [flags]

# Flags
--scope <s>      plans | code | onboarding | all   (default: all)
--top-k <n>      number of hits to return          (default: 5)
--project <s>    project slug filter               (default: cwd basename)
                 use "all" to query across every indexed project
--json           emit { hits, empty, topK, scope } as JSON
```

On empty store, the CLI emits `[warn] No chunks indexed yet`. With `--json`, the same shape as the MCP tool: `{ hits: [], empty: true, topK, scope }`.

### 3. Query (MCP — for agents)

```jsonc
// Tool: kj_rag_query
{ "text": "auth flow", "scope": "plans", "topK": 5, "project": "my-app" }
```

Same contract as the CLI. Empty corpus → `{ hits: [], empty: true, ... }` so the agent has a deterministic recovery signal.

### 4. Query (Skills slash command — for hosts without MCP)

```text
/kj-rag-query <text> [--scope <s>] [--top-k <n>]
```

Shipped by `kj init` to `.claude/commands/kj-rag-query.md`. Thin wrapper over the CLI; passes flags through, renders hits as background context (not raw JSON), surfaces empty-store as a one-line hint without blocking.

### 5. HU Board search panel

Web UI at `http://localhost:4000` includes a RAG search box between the preflight panel and the kanban. `POST /api/rag/query` backs it; same shape as MCP.

### 6. Pre-loop auto-retrieval (Camino C, since v2.24.0)

When `config.rag.preload.enabled = true`, `runRagContextStage` runs between triage and `domainCurator`. It queries the store with the task text and **mutates** the task parameter to prepend a "Prior context from RAG" markdown block. Because `task` flows through `runPlanningPhases` to researcher/architect/planner/coder via parameter chain, **one mutation feeds six downstream consumers**.

The decisor (`shouldPreloadRag`, since v2.25.0) decides **whether** to pay the cost based on triage signals. See Configuration below.

### 7. Role instructions (Camino A, since v2.23.0)

`templates/roles/{coder,researcher,architect,planner,spec-reviewer}.md` each carry a "Prior context (RAG, opt-in)" section calibrated per role. Coder/architect/spec-reviewer get `topK: 3, scope: all`; researcher/planner get `topK: 5, scope: plans`. Shared rule: when the store responds `empty: true`, proceed without retrieval — don't block, don't ask the human to seed.

## Configuration

```yaml
# ~/.karajan/kj.config.yml
rag:
  embedder:
    url: http://localhost:11434
    model: nomic-embed-text
    dim: 768
    port: 11434
    container_name: kj-ollama
    external: false           # true = Karajan won't manage the container
  preload:
    enabled: false            # opt-in; default false
    policy: auto              # auto | always | never
    topK: 5
    scope: all                # all | plans | code | onboarding
    brownfield: false         # auto policy: force pull when true
```

### `rag.preload.policy`

| Policy | When `enabled: true` |
|---|---|
| `always` | Pull every run (back-compat with v2.24.0 default) |
| `never` | Never pull (benchmarking, debugging) |
| `auto` (default) | Pull when any of: `triage.shouldDecompose`, `triage.level ∈ {complex, high, epic}`, `task.length ≥ 200`, or `brownfield: true` |

Skipped runs persist `ragPreload: { skipped: true, reason: 'auto:low-value' }` so `kj resume` and `kj audit` can see why retrieval was skipped.

## Limitations

### Single shared DB

`~/.karajan/rag.db` is **global** across all your projects. Use `--project <slug>` (CLI/MCP) or set `KJ_RAG_DB=/per-project/path.db` to keep corpora separate. Since v2.27.0, the indexer auto-stamps every chunk with the projectDir basename; queries default to that slug.

### Cosine-only ranking

Pure semantic similarity is biased: long descriptive prose (often in tests) outranks terse source files for natural-language queries. Mitigated since v2.27.0 by an asymmetric kind-boost (code +0.05 when query doesn't mention test/spec/expect). For exact-symbol queries (`projectSlug`, `runRagContextStage`), BM25 hybrid is on the v2.28.0+ roadmap.

### No live watcher

Re-run `kj rag index` after editing files. Chokidar watcher with debounced re-index is on the v2.28.0+ roadmap.

### Source chunker is regex-based

`chunkSource` splits by `export <symbol>` lines + sliding window. Function bodies past the symbol line may be split mid-statement. AST-aware chunking (tree-sitter or `@babel/parser`) is on the v2.28.0+ roadmap.

## Troubleshooting

### `kj rag index` returns 0 chunks

```bash
kj ollama status       # is the container reachable?
# If not:
kj ollama start
docker exec kj-ollama ollama list    # nomic-embed-text present?
# If not:
kj ollama pull nomic-embed-text
```

### Queries return chunks from another project

You're in a project that doesn't match any indexed slug — `--project` auto-detection falls back to "no filter" when the cwd basename doesn't match. Use `--project <slug>` explicitly or `--project all` if you really do want a cross-project query.

### Re-index after major changes

`kj rag index` deletes per-source chunks before rewriting them, so re-running it is safe and replaces stale embeddings. To start from scratch: `rm ~/.karajan/rag.db && kj rag index --with-sources`.

### Bootstrap failed on `kj init`

Run `kj doctor` to surface why. Most common causes:

- Docker daemon not running → `sudo systemctl start docker`
- Less than 4 GB free RAM → free memory or use `kj init --no-ollama` and wire an external embedder
- Port 11434 occupied by another process → kill the offender or set `rag.embedder.port` to a free port

## See also

- `src/rag/*` — implementation
- `templates/skills/kj-rag-query.md` — slash command (Camino B)
- `templates/roles/{coder,researcher,architect,planner,spec-reviewer}.md` — per-role guidance (Camino A)
- `src/orchestrator/stages/rag-context-stage.js` — pre-loop stage (Camino C)
- `src/orchestrator/stages/rag-preload-decisor.js` — heuristic decisor (Camino D)
- CHANGELOG.md entries for v2.22 through v2.27

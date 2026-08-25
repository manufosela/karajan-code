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

## Internals — the six questions

### 1. Chunking

Each consumer (plan, markdown, source) has its own chunker, all routed through `src/rag/chunker.js → chunkSource`. The source chunker delegates to a per-language adapter looked up by extension (`src/lang/registry.js → adapterForPath`).

| Language | Strategy | File |
|---|---|---|
| JS / TS | `@babel/parser` AST + leading JSDoc + `export <symbol>` fallback | `src/rag/chunker.js` |
| Python  | tree-sitter `function_definition` / `class_definition` + regex fallback | `src/lang/chunk-python.js` |
| Rust    | tree-sitter `function_item` / `struct_item` / `enum_item` / `impl_item` + regex fallback | `src/lang/chunk-rust.js` |
| Go      | tree-sitter `function_declaration` / `method_declaration` / `type_declaration` + regex fallback | `src/lang/chunk-go.js` |
| Java    | tree-sitter 2-level walker (class/interface/enum/record → method/constructor) + regex fallback | `src/lang/chunk-java.js` |
| Markdown / plans | Heading-based split | `src/rag/chunker.js` |

Common contract: every chunk emits `{ text, metadata: { source, kind, symbol, language } }`. Oversize bodies are passed through `windowText(text, limit=800, overlap=100)` so embeddings stay under the model context. When no top-level symbol is found (e.g. comment-only file), the whole text is windowed with `symbol: null`.

The AST path is opt-in per index run — the indexer calls `prepareAdapters()` (`src/rag/indexer.js`) once before walking, which awaits every `adapter.prepare()` (cached after first load via `src/lang/tree-sitter-loader.js`). Grammars are vendored under `vendor/tree-sitter-grammars/*.wasm` so SEA binaries stay self-contained.

### 2. Embedder

`createEmbedderFromConfig(config)` (`src/rag/embedder-factory.js`) returns one of six adapters, all implementing `{ embed(text), dim }`:

| Provider | Default model | Dim | Notes |
|---|---|---|---|
| Ollama (default) | `nomic-embed-text` | 768 | Local, no API key. Auto-pulled by `kj init` |
| OpenAI | `text-embedding-3-small` | 1536 | `OPENAI_API_KEY` |
| Voyage AI | `voyage-3-lite` | 512 | `VOYAGE_API_KEY` — code-specialized variants available |
| Cohere | `embed-multilingual-v3.0` | 1024 | `COHERE_API_KEY` |
| Mistral | `mistral-embed` | 1024 | `MISTRAL_API_KEY` |
| ONNX local | `Xenova/all-MiniLM-L6-v2` | 384 | `@xenova/transformers`, no Docker, slowest |

Decisions:
- **Ollama default** — zero cost, runs in `kj-ollama` Docker container, works offline. The price is ~270 MB model download once and ~2 GB RAM while indexing.
- **No code-specialized default** — Voyage/Cohere have code-tuned variants but they're paid and the cross-language quality gap on small corpora doesn't justify the cost gate. Users wanting it can flip `rag.embedder.provider`.
- **No Matryoshka truncation** — sqlite-vec stores the full dim; truncated re-ranking is on backlog for very large corpora where storage matters.

Switching providers requires a re-index (`kj rag index` after editing `rag.embedder.provider/model`) — dimensions and embedding spaces are not interchangeable.

### 3. Search

Two-stage retrieval over `~/.karajan/rag.db` (sqlite + `sqlite-vec` extension):

1. **Vector recall** — exact cosine via `vec_distance_cosine`, over-fetched (`topK × 3`) to leave headroom for re-ranking. Exact (not ANN) is fine up to ~100K chunks; ANN switch is on backlog.
2. **Hybrid rerank** — when `rag.search.mode = hybrid` (default since v2.28.0), the same query is run against an FTS5 BM25 index and scores are normalised + blended:
   `final = alpha * cosine + (1 - alpha) * bm25`, with `alpha = 0.7` by default.
3. **Kind boost** — asymmetric: `code +0.05` when the query has no test/spec/expect tokens; `test +0.05` otherwise. Pulls relevant source up over verbose test prose for natural-language queries.
4. **Optional cross-encoder rerank** — `rag.search.rerank = true` re-scores top-N with a local cross-encoder (`Xenova/ms-marco-MiniLM-L-6-v2`). Adds ~80 ms / 5 hits but lifts precision@5 on ambiguous queries.
5. **Metadata filter** — `--where "kind='code' AND language='java'"` is parsed into a parameterised SQL WHERE clause applied before the vector search.

Tweak from the HU Board config panel or `~/.karajan/kj.config.yml`. Both knobs (`alpha`, `mode`, `rerank`) are wired to the pre-loop stage and the CLI.

### 4. Update strategy

Re-indexing is **incremental** and tracked by commit SHA stamped in the `vec_store_meta` table:

| Trigger | How | Since |
|---|---|---|
| Manual | `kj rag index [--with-sources]` | v2.22.0 |
| Live watcher | `kj watch` — chokidar debounced re-index per changed file | v2.28.0 |
| Post-merge git hook | `kj rag index --since <last-indexed-sha>` after `git merge`/`git pull` | v2.31.0 |
| Pre-run drift check | Compares `HEAD` to last indexed SHA before every `kj run`; emits a hint if drift > N files | v2.31.0 |

`--since <sha>` walks `git diff --name-only <sha>...HEAD` and re-indexes only changed paths, calling `deleteChunksForSource` first to avoid duplicates. Idempotent.

### 5. What gets embedded

Only the `text` field of each chunk is embedded. Everything else (`source`, `kind`, `symbol`, `language`, `commit`, `project`) lives in queryable columns and is exposed to the `--where` filter. No PII heuristics — the indexer trusts the project tree; secrets that leak into the corpus leak into the embeddings. Run `kj audit` to flag obvious secret files before indexing if you don't trust the tree.

Project isolation is enforced by stamping each row with the projectDir basename. Queries default to the cwd's slug; `--project all` opts out, `--project <slug>` targets another.

### 6. Validation

Two tiers:

- **Pipeline tests** — `tests/rag/*.test.js` covers the chunkers, embedder factory, retriever ranking, hybrid scoring, watcher and CLI. Pre-merge gate ensures green CI before any change to `src/rag/` lands.
- **Retrieval quality** — `kj rag eval` (KJC-TSK-0483) runs a frozen set of golden queries against the current index and reports `recall@k` and MRR. Used to detect regressions when changing chunkers, embedders or alpha. The retrieval-quality dashboard in the HU Board surfaces the same metric live per query. See [Retrieval quality baseline](#retrieval-quality-baseline) below for the harness and current numbers.

Known gaps:

- **Content-hash dedup** is not on by default — KJC-TSK-0484. Re-indexing identical bodies wastes embeddings; a SHA-256 column + skip-on-match is on backlog.
- **Near-duplicate clustering** (cosine > 0.97 between chunks) is exploratory under the same card.

## Retrieval quality baseline

`kj rag eval` is the regression gate for the retriever. It loads a JSON file of golden queries — each with `query`, `expected_sources` (path suffixes) and optional `expected_symbols` — runs the current retriever against every entry, and reports `recall@5`, `recall@10` and MRR per query and aggregated.

```bash
# Default: tests/rag/golden-queries.json, topK=10, scope=all
kj rag eval

# Custom golden set + JSON for CI consumption
kj rag eval --golden ./my-golden.json --json > eval-report.json

# CI gate: fail (exit 1) if aggregated recall@5 drops below 0.7
kj rag eval --min-recall 0.7
```

`--project all` queries across every indexed project; the default detects the cwd slug, matching the rest of the `kj rag` family.

The harness is decoupled from the retriever: `runEval(queries, runQuery, { topK, ks })` in `src/rag/eval.js` is pure and takes the retriever as a callback, so unit tests cover the math (`scoreQuery` for binary recall@k + reciprocal rank, `aggregate` for the mean over queries) with a stub. `tests/rag/golden-queries.json` ships 20 entries covering the public surface of `src/rag/` (vec-store, retriever, indexer, chunker, every embedder, watcher, where-parser, ollama-manager).

A query "hits" when any expected source is a path-suffix of the chunk's `source`, or the chunk's `metadata.symbol` is listed in `expected_symbols`. `recall@k` is binary (1 if any expected match lands in the top-k, 0 otherwise); MRR is the mean of `1 / firstRelevantRank` across queries.

Baseline numbers depend on the embedder and the indexed corpus. Re-run `kj rag eval` after any change to chunkers, embedders, hybrid `alpha`, BM25 weights or the metadata schema and check that aggregated recall@5 does not regress. The intended use in CI is a single `kj rag eval --min-recall <threshold>` step after `kj rag index`.

## Use from external IDEs

The `karajan-mcp` server exposes all 27 Karajan tools to MCP-aware clients (Claude Code, Codex, Cursor, Windsurf, etc.). For agents that only need semantic search over a Karajan-indexed project — without the full 27-tool orchestrator surface — ship the lighter `kj-rag-mcp` binary instead. It exposes only `kj_rag_query` and `kj_rag_index` and re-uses the same handlers as `karajan-mcp`, so behaviour stays in sync.

Use `kj-rag-mcp` when:

- You are working in a project that has already been indexed (`kj rag index` ran at least once)
- You want the agent to consult the vector store before answering, but you do not want it to be able to launch the pipeline, edit files via `kj_run`, or reach any of the orchestration tools
- You are mixing Karajan with another orchestrator (Cursor's built-in agent, Continue's pipeline, etc.) and only need Karajan's retrieval layer

### Cursor (`.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "kj-rag": {
      "command": "kj-rag-mcp"
    }
  }
}
```

### Windsurf / Continue / Zed

Any MCP client that accepts a stdio command works the same way — point it at `kj-rag-mcp` (installed by `npm install -g @karajan-family/code`). The binary auto-detects the project from the current working directory; override with the `projectDir` argument on each call if the IDE launches the server from a different cwd.

### What the agent gets

`tools/list` returns exactly two tools, `kj_rag_query` (required: `text`; optional: `topK`, `scope`, `projectDir`) and `kj_rag_index` (optional: `withSources`, `projectDir`). No `kj_run`, no `kj_review`, no shell side-effects beyond the local vector store.

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

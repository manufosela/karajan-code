# RAG — Retrieval-Augmented Generation

> Desde v2.22.0. Auto-bootstrapped desde v2.26.0. Aislamiento per-proyecto desde v2.27.0.

Karajan incluye un stack RAG (Retrieval-Augmented Generation) local que indexa los planes del proyecto, los briefs de onboarding y (opcionalmente) los archivos fuente en una vector store, y luego deja que cualquier consumidor — CLI, agentes vía MCP, slash commands, HU Board, o el pre-loop stage — los consulte semánticamente antes de decidir qué construir, refactorizar o investigar.

## Quick start

```bash
# Bootstrap (ya lo hace kj init desde v2.26.0)
kj init                       # provisiona Ollama en Docker + nomic-embed-text

# Indexar el proyecto
kj rag index                  # planes + onboarding
kj rag index --with-sources   # planes + onboarding + todo .js/.ts bajo src/

# Consultar
kj rag query "cómo elige model router un coder"
kj rag query "auth flow" --scope plans
kj rag query "rate limiting" --top-k 10 --json
```

## Arquitectura

```
┌───────────────────────────────────────────────────────┐
│ Consumidores                                          │
│ ───────────                                           │
│ • kj rag query              (CLI)                     │
│ • MCP kj_rag_query tool     (Claude Desktop, Cursor)  │
│ • /kj-rag-query slash       (hosts Skills sin MCP)    │
│ • HU Board panel búsqueda   (web UI)                  │
│ • Pre-loop auto-retrieval   (transparente a agentes)  │
│ • Role instructions         (guía por rol)            │
└───────────────────────────────────────────────────────┘
                       │
                       ▼
┌───────────────────────────────────────────────────────┐
│ src/rag/retriever.js  ─ over-fetch + kind boost       │
│ src/rag/vec-store.js  ─ sqlite-vec cosine search      │
│ src/rag/embedder.js   ─ OllamaEmbedder                │
│ src/rag/chunker.js    ─ chunkers md / plan / source   │
│ src/rag/indexer.js    ─ walker proyecto + idempotencia│
└───────────────────────────────────────────────────────┘
                       │
                       ▼
        ┌────────────────────────────┐
        │ ~/.karajan/rag.db          │
        │ (sqlite-vec, ~21 MB / 7K   │
        │  chunks por repo medio)    │
        └────────────────────────────┘
                       │
                       ▼
        ┌────────────────────────────┐
        │ Docker: kj-ollama          │
        │ http://localhost:11434     │
        │ nomic-embed-text (274 MB)  │
        └────────────────────────────┘
```

## Instalación

`kj init` provisiona todo automáticamente cuando Docker está disponible y el host tiene ≥ 4 GB RAM libre:

1. **Capability check** (`src/rag/ollama-capability.js`) — confirma demonio Docker + umbral RAM.
2. **Container start** — `docker compose up -d` contra `~/.karajan/docker-compose.ollama.yml`.
3. **Health gate** — `waitForOllamaReady` polea `/api/tags`.
4. **Pull modelo** — `docker exec kj-ollama ollama pull nomic-embed-text` (~270 MB primer run, cacheado luego en el volumen `kj_ollama_data`).

Opt-out con `kj init --no-ollama`. En hosts donde Karajan rehúsa hacer bootstrap, el wizard loguea el motivo (`docker:not-installed`, `docker:daemon-unreachable`, `ram:insufficient`) y continúa — init nunca peta.

Si Ollama ya está corriendo en `:11434` (instalado manualmente), Karajan lo detecta vía discover-before-spawn y **reutiliza** esa instancia en vez de levantar un segundo container.

## Workflows

### 1. Indexar

```bash
kj rag index                  # planes + onboarding
kj rag index --with-sources   # + .js/.ts/.tsx/.jsx bajo projectDir
```

Directorios filtrados por `SKIP = {node_modules, .git, dist, build, coverage, .karajan, .next, .kj, _diet}`. `.kj/` y `_diet/` son sandboxes scratch que Karajan crea durante `kj run` y el harness de audit test-diet — nunca código de usuario.

Indexar es **idempotente**: llamar a `indexFile` en el mismo path reemplaza sus chunks, no duplica.

### 2. Query (CLI)

```bash
kj rag query "<texto>" [flags]

# Flags
--scope <s>      plans | code | onboarding | all   (default: all)
--top-k <n>      número de hits a devolver         (default: 5)
--project <s>    filtro por slug de proyecto       (default: basename cwd)
                 usa "all" para consultar todos los proyectos indexados
--json           emite { hits, empty, topK, scope } como JSON
```

En store vacío, el CLI emite `[warn] No chunks indexed yet`. Con `--json`, el mismo shape que la herramienta MCP: `{ hits: [], empty: true, topK, scope }`.

### 3. Query (MCP — para agentes)

```jsonc
// Tool: kj_rag_query
{ "text": "auth flow", "scope": "plans", "topK": 5, "project": "my-app" }
```

Mismo contrato que el CLI. Corpus vacío → `{ hits: [], empty: true, ... }` para que el agente tenga señal determinista de recovery.

### 4. Query (slash command — para hosts sin MCP)

```text
/kj-rag-query <texto> [--scope <s>] [--top-k <n>]
```

Desplegado por `kj init` a `.claude/commands/kj-rag-query.md`. Wrapper delgado sobre el CLI; passes flags through, renderiza hits como background context (no JSON crudo), surface empty-store como hint de una línea sin bloquear.

### 5. Panel búsqueda HU Board

Web UI en `http://localhost:4000` incluye un cuadro búsqueda RAG entre el panel preflight y el kanban. `POST /api/rag/query` lo backea; mismo shape que MCP.

### 6. Pre-loop auto-retrieval (Camino C, desde v2.24.0)

Cuando `config.rag.preload.enabled = true`, `runRagContextStage` corre entre triage y `domainCurator`. Consulta el store con el texto de la task y **muta** el parámetro task para anteponer un bloque markdown "Prior context from RAG". Como `task` fluye por `runPlanningPhases` hacia researcher/architect/planner/coder vía parameter chain, **una mutación alimenta seis consumidores downstream**.

El decisor (`shouldPreloadRag`, desde v2.25.0) decide **si** pagar el coste basado en señales de triage. Ver Configuración abajo.

### 7. Role instructions (Camino A, desde v2.23.0)

`templates/roles/{coder,researcher,architect,planner,spec-reviewer}.md` llevan cada uno una sección "Prior context (RAG, opt-in)" calibrada por rol. Coder/architect/spec-reviewer reciben `topK: 3, scope: all`; researcher/planner reciben `topK: 5, scope: plans`. Regla compartida: cuando el store responde `empty: true`, proceder sin retrieval — no bloquear, no pedir al humano que haga seed.

## Configuración

```yaml
# ~/.karajan/kj.config.yml
rag:
  embedder:
    url: http://localhost:11434
    model: nomic-embed-text
    dim: 768
    port: 11434
    container_name: kj-ollama
    external: false           # true = Karajan no gestiona el container
  preload:
    enabled: false            # opt-in; default false
    policy: auto              # auto | always | never
    topK: 5
    scope: all                # all | plans | code | onboarding
    brownfield: false         # policy auto: fuerza pull cuando true
```

### `rag.preload.policy`

| Policy | Cuando `enabled: true` |
|---|---|
| `always` | Pull cada run (back-compat con v2.24.0 default) |
| `never` | Nunca pull (benchmarking, debugging) |
| `auto` (default) | Pull cuando cualquiera de: `triage.shouldDecompose`, `triage.level ∈ {complex, high, epic}`, `task.length ≥ 200`, o `brownfield: true` |

Runs skipeados persisten `ragPreload: { skipped: true, reason: 'auto:low-value' }` para que `kj resume` y `kj audit` puedan ver por qué se saltó retrieval.

## Limitaciones

### DB compartida única

`~/.karajan/rag.db` es **global** entre todos los proyectos. Usa `--project <slug>` (CLI/MCP) o define `KJ_RAG_DB=/per-proyecto/path.db` para mantener los corpus separados. Desde v2.27.0, el indexer estampa cada chunk con el basename del projectDir; las queries default a ese slug.

### Ranking solo cosine

Similitud semántica pura tiene sesgo: prosa descriptiva larga (frecuente en tests) rankea encima de source files concisos para queries en lenguaje natural. Mitigado desde v2.27.0 con kind-boost asimétrico (code +0.05 cuando query no menciona test/spec/expect). Para queries exact-symbol (`projectSlug`, `runRagContextStage`), BM25 híbrido está en el roadmap de v2.28.0+.

### Sin watcher en vivo

Re-correr `kj rag index` después de editar archivos. Chokidar watcher con re-index debounced está en el roadmap de v2.28.0+.

### Source chunker basado en regex

`chunkSource` separa por líneas `export <symbol>` + sliding window. Cuerpos de función pasada la línea del símbolo pueden separarse mid-statement. Chunking AST-aware (tree-sitter o `@babel/parser`) está en el roadmap de v2.28.0+.

## Troubleshooting

### `kj rag index` devuelve 0 chunks

```bash
kj ollama status       # ¿está alcanzable el container?
# Si no:
kj ollama start
docker exec kj-ollama ollama list    # ¿está nomic-embed-text?
# Si no:
kj ollama pull nomic-embed-text
```

### Queries devuelven chunks de otro proyecto

Estás en un proyecto que no matchea ningún slug indexado — la auto-detección de `--project` cae a "sin filtro" cuando el basename de cwd no matchea. Usa `--project <slug>` explícitamente o `--project all` si realmente quieres una query cross-project.

### Re-indexar tras cambios mayores

`kj rag index` borra chunks per-source antes de reescribirlos, así que re-correrlo es seguro y reemplaza embeddings stale. Para empezar de cero: `rm ~/.karajan/rag.db && kj rag index --with-sources`.

### Bootstrap falló en `kj init`

Corre `kj doctor` para sacar a la luz el motivo. Causas comunes:

- Demonio Docker no corriendo → `sudo systemctl start docker`
- Menos de 4 GB RAM libre → libera memoria o usa `kj init --no-ollama` y cablea un embedder externo
- Puerto 11434 ocupado por otro proceso → mata al ofensor o define `rag.embedder.port` a un puerto libre

## Ver también

- `src/rag/*` — implementación
- `templates/skills/kj-rag-query.md` — slash command (Camino B)
- `templates/roles/{coder,researcher,architect,planner,spec-reviewer}.md` — guía per-rol (Camino A)
- `src/orchestrator/stages/rag-context-stage.js` — pre-loop stage (Camino C)
- `src/orchestrator/stages/rag-preload-decisor.js` — decisor heurístico (Camino D)
- Entradas CHANGELOG.md para v2.22 hasta v2.27

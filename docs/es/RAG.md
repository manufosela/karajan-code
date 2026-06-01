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

## Internals — las seis preguntas

### 1. Chunking

Cada consumidor (plan, markdown, source) tiene su propio chunker, todos enrutados a través de `src/rag/chunker.js → chunkSource`. El source chunker delega a un adapter por lenguaje consultado por extensión (`src/lang/registry.js → adapterForPath`).

| Lenguaje | Estrategia | Fichero |
|---|---|---|
| JS / TS | AST con `@babel/parser` + JSDoc líder + fallback `export <symbol>` | `src/rag/chunker.js` |
| Python  | tree-sitter `function_definition` / `class_definition` + fallback regex | `src/lang/chunk-python.js` |
| Rust    | tree-sitter `function_item` / `struct_item` / `enum_item` / `impl_item` + fallback regex | `src/lang/chunk-rust.js` |
| Go      | tree-sitter `function_declaration` / `method_declaration` / `type_declaration` + fallback regex | `src/lang/chunk-go.js` |
| Java    | tree-sitter walker 2 niveles (class/interface/enum/record → method/constructor) + fallback regex | `src/lang/chunk-java.js` |
| Markdown / planes | Split por headings | `src/rag/chunker.js` |

Contrato común: cada chunk emite `{ text, metadata: { source, kind, symbol, language } }`. Cuerpos grandes pasan por `windowText(text, limit=800, overlap=100)` para no salirse del contexto del modelo. Si no hay símbolo top-level (fichero solo con comentarios), el texto entero se ventana con `symbol: null`.

El camino AST es opt-in por run — el indexer llama a `prepareAdapters()` (`src/rag/indexer.js`) una vez antes del walk, que await-ea cada `adapter.prepare()` (cacheado tras la primera carga vía `src/lang/tree-sitter-loader.js`). Las gramáticas viven en `vendor/tree-sitter-grammars/*.wasm` para que los binarios SEA sigan siendo self-contained.

### 2. Embedder

`createEmbedderFromConfig(config)` (`src/rag/embedder-factory.js`) devuelve uno de seis adapters, todos con `{ embed(text), dim }`:

| Provider | Modelo por defecto | Dim | Notas |
|---|---|---|---|
| Ollama (default) | `nomic-embed-text` | 768 | Local, sin API key. Auto-pull en `kj init` |
| OpenAI | `text-embedding-3-small` | 1536 | `OPENAI_API_KEY` |
| Voyage AI | `voyage-3-lite` | 512 | `VOYAGE_API_KEY` — variantes code-specialized |
| Cohere | `embed-multilingual-v3.0` | 1024 | `COHERE_API_KEY` |
| Mistral | `mistral-embed` | 1024 | `MISTRAL_API_KEY` |
| ONNX local | `Xenova/all-MiniLM-L6-v2` | 384 | `@xenova/transformers`, sin Docker, más lento |

Decisiones:
- **Ollama por defecto** — coste cero, corre en el container Docker `kj-ollama`, funciona offline. El precio: ~270 MB de descarga una vez y ~2 GB RAM mientras indexa.
- **Sin code-specialized por defecto** — Voyage/Cohere tienen variantes ajustadas a código pero son de pago y la brecha de calidad cross-language en corpus pequeños no justifica la barrera. Quien lo quiera, cambia `rag.embedder.provider`.
- **Sin truncado Matryoshka** — sqlite-vec guarda el dim completo; re-ranking con truncado está en backlog para corpus muy grandes donde el storage importa.

Cambiar de provider exige re-indexar (`kj rag index` tras editar `rag.embedder.provider/model`) — las dimensiones y los espacios de embedding no son intercambiables.

### 3. Search

Retrieval en dos etapas sobre `~/.karajan/rag.db` (sqlite + extensión `sqlite-vec`):

1. **Vector recall** — cosine exacto vía `vec_distance_cosine`, over-fetch (`topK × 3`) para dejar margen al rerank. Exacto (no ANN) va bien hasta ~100K chunks; el switch a ANN está en backlog.
2. **Rerank híbrido** — cuando `rag.search.mode = hybrid` (default desde v2.28.0), la misma query corre contra un índice FTS5 BM25 y los scores se normalizan + mezclan:
   `final = alpha * cosine + (1 - alpha) * bm25`, con `alpha = 0.7` por defecto.
3. **Boost por kind** — asimétrico: `code +0.05` cuando la query no tiene tokens test/spec/expect; `test +0.05` si los tiene. Empuja source files relevantes encima de prosa verbosa de tests para queries en lenguaje natural.
4. **Rerank cross-encoder opcional** — `rag.search.rerank = true` re-puntúa el top-N con un cross-encoder local (`Xenova/ms-marco-MiniLM-L-6-v2`). Añade ~80 ms / 5 hits pero sube la precisión@5 en queries ambiguas.
5. **Filtro de metadata** — `--where "kind='code' AND language='java'"` se parsea a un WHERE SQL parametrizado aplicado antes del vector search.

Ajustable desde el panel de config del HU Board o `~/.karajan/kj.config.yml`. Los tres knobs (`alpha`, `mode`, `rerank`) están cableados al pre-loop stage y al CLI.

### 4. Estrategia de update

La re-indexación es **incremental** y se rastrea por SHA de commit guardado en la tabla `vec_store_meta`:

| Trigger | Cómo | Desde |
|---|---|---|
| Manual | `kj rag index [--with-sources]` | v2.22.0 |
| Watcher en vivo | `kj watch` — chokidar con re-index debounced por fichero | v2.28.0 |
| Hook post-merge | `kj rag index --since <last-indexed-sha>` tras `git merge`/`git pull` | v2.31.0 |
| Pre-run drift check | Compara `HEAD` con el último SHA indexado antes de cada `kj run`; emite hint si el drift supera N ficheros | v2.31.0 |

`--since <sha>` recorre `git diff --name-only <sha>...HEAD` y reindexa solo las rutas cambiadas, llamando primero a `deleteChunksForSource` para evitar duplicados. Idempotente.

### 5. Qué se embebe

Solo se embebe el campo `text` de cada chunk. Todo lo demás (`source`, `kind`, `symbol`, `language`, `commit`, `project`) vive en columnas consultables y queda expuesto al filtro `--where`. Sin heurísticas de PII — el indexer confía en el árbol del proyecto; lo que se cuele al corpus se cuela en los embeddings. Si no confías en el árbol, corre `kj audit` para marcar los ficheros sospechosos antes de indexar.

El aislamiento por proyecto se hace estampando cada fila con el basename del projectDir. Las queries default al slug del cwd; `--project all` se sale, `--project <slug>` apunta a otro.

### 6. Validación

Dos niveles:

- **Tests del pipeline** — `tests/rag/*.test.js` cubre los chunkers, embedder factory, retriever ranking, scoring híbrido, watcher y CLI. Gate pre-merge garantiza CI verde antes de que ningún cambio sobre `src/rag/` aterrice.
- **Calidad de retrieval** — `kj rag eval` (KJC-TSK-0483, en curso) corre un conjunto frozen de golden queries contra el índice actual y reporta `recall@k` y MRR vs. baseline guardada. Sirve para detectar regresiones al cambiar chunkers, embedders o alpha. El dashboard de retrieval-quality del HU Board surfacea la misma métrica viva por query.

Huecos conocidos:

- **Content-hash dedup** no va activo por defecto — KJC-TSK-0484. Re-indexar cuerpos idénticos malgasta embeddings; columna SHA-256 + skip-on-match en backlog.
- **Clustering de near-duplicates** (cosine > 0.97 entre chunks) es exploratorio dentro de la misma card.

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

# Changelog

Todos los cambios notables en este proyecto se documentan aquí.

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y
este proyecto sigue [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Migración asistida entre stores** (KJR-TSK-0119, roadmap 0.5.0):
  `scan({batchSize})` como async generator en los tres stores (Pg pagina
  en SQL con orden estable; Lance trocea `query().toArray()` —
  documentado) y `migrateVectorStore(source, target, {batchSize,
  onProgress})`: valida dimensiones antes de escribir, propaga el
  fingerprint vía `ensureIndexFingerprint` (destino con otro espacio →
  corta sin escribir), upsert por lotes idempotente. Sin re-embedding:
  cambiar de backend (p. ej. LanceDB local → pgvector en cloud) sin
  reindexar.

- **Fingerprint persistente en el store** (KJR-TSK-0118, roadmap 0.5.0 —
  ADR-002 generalizado): los tres stores exponen
  `get/setIndexFingerprint` (campo en InMemory, tabla `<tabla>_meta` en
  Postgres, fichero sidecar `.karajan-fingerprint` en LanceDB — cópialo
  si mueves la tabla de sitio) y el helper `ensureIndexFingerprint`
  registra/valida el espacio vectorial fallando con error accionable
  ante mismatch. El indexer easy lo aplica como defensa en profundidad:
  escribir con un embedder/dimensiones incompatibles corta antes de
  mezclar espacios, tenga o no manifest el directorio.

- **`deleteByDocument(documentId)`** en los tres vector stores
  (KJR-TSK-0117, roadmap 0.5.0): borra todos los chunks de un documento
  en una llamada. InMemory filtra por `metadata.documentId`; PgVector por
  `metadata->>'documentId'`; LanceDB estrena columna top-level
  `document_id` (las tablas creadas antes de 0.5.0 no la tienen —
  `deleteByDocument` sobre ellas falla con instrucción de reindexar). El
  indexer easy la usa al invalidar documentos, con fallback al borrado
  por `chunkIds` del manifest. Queda documentado y testeado que la
  `EmbeddingCache` (content-addressed: fingerprint + sha256) no requiere
  invalidación ante borrados/reindexados.

## [0.4.0] — 2026-07-22

### Added

- **Métricas locales de evaluación** (KJR-TSK-0111, roadmap 0.4.0):
  `faithfulness`, `contextPrecision`, `contextRecall`, `answerRelevance`
  y el agregador `evaluateAnswer` en `src/evaluation/local-metrics.js`.
  Variantes léxico-deterministas (solape de tokens de contenido, con
  stopwords/interrogativos es-en filtrados) sin LLM ni dependencias:
  aptas para baselines offline y CI. Valores siempre en [0,1], entradas
  degeneradas con semántica definida y `relevantIds` vacío → error
  explícito. Re-exportadas en el barrel.

- **Golden set offline** (KJR-TSK-0112, roadmap 0.4.0): corpus mínimo en
  `examples/golden/` (facturación/envíos/soporte) + `golden.json` con
  preguntas, respuestas esperadas, fuentes relevantes y baseline
  calibrado al pipeline de stubs. Runner en
  `src/evaluation/golden-runner.js` (`loadGoldenSet`, `validateGoldenSet`,
  `runGoldenSet`): indexa con HashEmbedder + InMemoryVectorStore, lanza
  el retrieval híbrido y compara las medias de las métricas locales
  contra el baseline — cualquier caída falla señalando métrica y peores
  casos. Corre como test (`tests/golden-set.test.js`): guardián de
  regresión en CI sin credenciales.

- **Disagreement auto-labelling** (KJR-TSK-0113, roadmap 0.4.0): cada
  `JudgeVerdict` de `evaluateMultiJudge` incluye ahora `label`
  (`consensus`/`outlier`, null si el score no es parseable) y `deviation`
  respecto a la mediana; el `EvaluationReport` agrega `outliers` con los
  providers desviados ≥ threshold. La mediana como consenso resiste a un
  juez desviado; con dos jueces enfrentados ambos quedan como outlier
  (no hay consenso posible). Cambio aditivo: `aggregateScore` y
  `disagreement` no cambian.

- **Prompt-template auditado del Reranker LLM** (KJR-TSK-0114, roadmap
  0.4.0): el prompt inline de `RerankerRole` (modo llm) se extrae a
  `src/retrieval/rerank-prompt.js` (`buildRerankPrompt`,
  `RERANK_PROMPT_VERSION`, `RERANK_SNIPPET_MAX_CHARS`) sin cambio de
  redacción (v1). Tests snapshot congelan el texto exacto: cambiarlo
  exige actualizar snapshot y versión conscientemente en el mismo PR.

- **`karajan-rag eval <golden.json> [corpus]`** (KJR-TSK-0115, roadmap
  0.4.0): evaluación declarativa desde CLI. Ejecuta el golden set offline
  (stubs deterministas), reporta cada métrica contra su baseline (✓/✗ con
  peores casos) y termina con exit code 1 si el baseline falla — apto
  para CI. `--judges claude,ollama` añade veredictos LLM-as-judge por
  caso con `aggregateScore` y outliers etiquetados. `--dimensions N`
  para el embedder del run. `runEvalCommand` re-exportado en el barrel.

### Fixed

- **Easy RAG — guarda de integridad manifest↔store** (KJR-BUG-0005,
  PR #93): si `.karajan/manifest.json` declara ficheros pero el store
  está vacío (in-memory recién creado o persistente vaciado),
  `indexDirectory` reportaba "sin cambios" y las queries devolvían vacío
  en silencio. Ahora descarta el manifest y reindexa completo,
  notificándolo por `onEvent`.

Bugs detectados durante la validación del despliegue real en GCP
(KJR-TSK-0110, primer caso de uso en producción del módulo `deploy/gcp`):

- **deploy/gcp — Cloud SQL** (KJR-BUG-0001, PR #87): el provider google
  ~>6.0 crea instancias con edición ENTERPRISE_PLUS por defecto, que
  rechaza tiers compartidos; se fija `edition = "ENTERPRISE"`, compatible
  con el default `db-f1-micro`.
- **Migración pgvector** (KJR-BUG-0002, PR #90): `karajan_rag_chunks.id`
  pasa de `uuid` a `text` — los chunk ids de la capa Easy RAG son texto
  estable (`doc:ruta.md#0`) y el INSERT fallaba. Se retira `pgcrypto` y se
  documenta el ajuste de dimensión según el fingerprint del manifest.
- **deploy/gcp — Cloud Run** (KJR-BUG-0003, PR #88): `deletion_protection
  = false` explícito; el default del provider impedía reemplazar
  revisiones fallidas y rompía `terraform destroy`.
- **Dockerfile** (KJR-BUG-0004, PR #89): `pg` no llegaba a la imagen — la
  stage de deps heredaba el `package.json` del repo y npm lo omitía por
  figurar en devDependencies. Ahora los backends (`pg`,
  `@lancedb/lancedb`) se instalan sobre un `package.json` aislado.

## [0.3.0] — 2026-07-22

### Documentation

- **Guía "RAG en 5 minutos"** (`docs/easy-rag.md`, KJR-TSK-0108): flujo
  completo de la capa Easy RAG — index/query/serve en local, contenedor y
  GCP — con las garantías transversales (sensitivity first, sin fallbacks
  silenciosos, determinismo). Sección nueva en el README y ROADMAP
  reestructurado: Easy RAG pasa a ser la 0.3.0 (entregada en main),
  evaluación avanzada → 0.4.0, persistencia → 0.5.0, ecosistema → 0.6.0+.

### Added

- **Módulo Terraform `deploy/gcp/`** (KJR-TSK-0107): monta el RAG en
  Google Cloud con `terraform apply -var project_id=...`. Cloud Run v2
  (imagen del Dockerfile, startup probe sobre `/health`, scale-to-zero),
  Cloud SQL Postgres 16 con pgvector por socket Cloud SQL, bucket GCS con
  el índice montado read-only en `/data` vía GCS FUSE, `PG_URL` en Secret
  Manager (contraseña generada por Terraform), Artifact Registry y service
  account con permisos mínimos. API privada por defecto
  (`allow_unauthenticated=false`); `terraform destroy` sin huérfanos con
  protecciones explícitas para la base y el bucket. README con el flujo
  completo (build+push, migración pgvector, index vía cloud-sql-proxy,
  rsync del índice, query con identity token). Validado con
  `terraform fmt` + `validate`. Layout preparado para `deploy/aws|azure`.

- **Imagen Docker del servidor RAG** (KJR-TSK-0106): `Dockerfile`
  multi-stage sobre `node:22-slim`, usuario no root, con los backends
  opcionales preinstalados (`pg`, `@lancedb/lancedb`). Sirve el índice
  montado en `/data` vía HTTP; configuración solo por entorno (`PORT`,
  `KARAJAN_STORE=lancedb|pgvector`, `PG_URL`) — sin secretos horneados.
  `docker-compose.yml` añade el servicio `rag` junto a `pgvector` para un
  RAG local end-to-end. Verificado con smoke real: index + serve + curl
  a `/health` y `/query` dentro del contenedor.

- **`karajan-rag serve [ruta]`** (ADR-005, KJR-TSK-0105): sirve el índice
  Easy RAG sin dependencias nuevas. Modo **MCP stdio** por defecto
  (JSON-RPC 2.0 delimitado por líneas: initialize, tools/list, tools/call)
  con dos tools — `rag_query` (híbrido vector+BM25) y `rag_status` —
  consumibles desde Claude Code o cualquier cliente MCP. Modo **HTTP**
  (`--http --port N`): `POST /query {question, topK?}` y `GET /health`,
  con validación estricta y errores JSON. El mismo `RagService` sirve
  índices locales (lancedb) o remotos (`--store pgvector` + `PG_URL`) —
  contrato que empaquetarán la imagen Docker y el Terraform de GCP.
  Módulos nuevos `src/easy/{rag-service,http-server,mcp-server}.js`,
  re-exportados en el barrel.

- **`karajan-rag init [ruta]`** (ADR-005, KJR-TSK-0104): scaffold de
  `karajan.config.json` con la sección `easy` (store, embedder,
  dimensions, topK, adapter). Wizard interactivo con defaults; `--yes`
  para modo no interactivo (CI/scripts); no sobreescribe sin `--force`;
  añade `.karajan/` al `.gitignore`. `index` y `query` leen la config
  como defaults del proyecto — los flags de CLI siempre ganan, y una
  config inválida falla con el error exacto (nunca se ignora). Nuevo
  módulo `src/easy/config.js` (`loadEasyConfig`, `saveEasyConfig`,
  `validateEasyConfig`, `DEFAULT_EASY_CONFIG`) re-exportado en el barrel.

- **`karajan-rag query "<pregunta>" [ruta]`** (ADR-005, KJR-TSK-0103):
  consulta el índice local sin escribir pipeline. Retrieval híbrido en dos
  etapas (vector search sobre el store persistente + BM25 sobre los
  candidatos, merge 50/50 de scores normalizados), dedupe por overlap y
  salida `fichero:línea (score)` + pasaje. El embedder y las dimensiones
  se derivan del fingerprint del manifest (imposible consultar con un
  espacio vectorial distinto al indexado). `--answer --adapter <cli>`
  genera respuesta con contexto vía `GeneratorRole` (claude/codex/gemini/
  ollama/azure/bedrock/vertex). Índice inexistente → error con el comando
  exacto para crearlo. Nuevos `queryIndex` y `runQueryCommand` en el barrel.

- **`karajan-rag index <ruta>`** (ADR-005, KJR-TSK-0102): construye o
  actualiza un índice RAG persistente local en `.karajan/` con un solo
  comando. Autodetecta código/docs/datos vía presets, embebe en batch y
  hace upsert al store. Reindex **incremental**: `manifest.json` guarda el
  fingerprint del índice (ADR-002) y el hash por fichero — solo se
  reprocesan añadidos/cambiados, los borrados se invalidan del store, y
  un cambio de embedder/dimensiones fuerza reindex completo (nunca se
  mezclan espacios vectoriales). Flags: `--store lancedb|pgvector|in-memory`
  (default `lancedb`, error accionable si falta el peer; `pgvector`
  requiere `PG_URL`), `--embedder hash|transformers`, `--dimensions N`.
  Módulos nuevos `src/easy/{manifest,indexer,cli}.js`, re-exportados en el
  barrel (`indexDirectory`, `diffManifest`, `runIndexCommand`, etc.).

- **Easy RAG — autodetección de fuentes y presets** (ADR-005, KJR-TSK-0101):
  `detectSourceType`, `resolvePreset`, `classifySources` y `chunkWithPreset`
  en `src/easy/presets.js`. Clasifican ficheros por extensión (código /
  docs / datos, con binarios y desconocidos excluidos de forma explícita)
  y devuelven presets inmutables que reutilizan los chunkers existentes
  con defaults deterministas (`hash` + `lancedb`, ADR-005). Los presets
  nunca tocan la policy de sensibilidad ni la redacción PII.
- **Chunker `chunkByRecords`**: para fuentes tabulares (CSV/TSV/JSONL) en
  lotes de N registros; CSV/TSV prependen la cabecera a cada chunk para
  conservar el contexto de columnas, JSONL trocea por objeto. Detección
  `auto` de formato por la primera línea. Re-exportado en el barrel.

## [0.2.0] — 2026-07-22

### Added

- **Helper `collectPipelineEvents`**: en `src/pipeline/collect-events.js`.
  Devuelve `{events, hooks}` listo para pasar como `options.events` a
  `runPipeline`. Elimina el boilerplate de escribir tres callbacks y da
  un array vivo con entradas `{kind, stageName, stageIndex, durationMs?,
  inputSize?, outputSize?, error?}`. Re-exportado en el barrel.
- **Helper `wrapAdapterAsStream`**: en `src/ai/adapters/wrap-adapter-as-stream.js`.
  Convierte cualquier `AdapterFunction` (Claude CLI, Azure HTTP, etc.) en
  un `StreamAdapterFunction` troceando el answer en chunks de `chunkSize`
  caracteres con `delayMs` opcional. Homogeneiza el código cliente entre
  proveedores con y sin streaming nativo y sirve para simular UX
  progresiva en demos. No es streaming real (el adapter sigue siendo
  blocking); úsalo como fallback o conveniencia. Re-exportado en barrel.

### Documentation

- **README — sección "API pública"**: lista los símbolos re-exportados por
  capa (pipeline, adapters, ingestion, embedding, vector stores, retrieval,
  generation/evaluation, policy/redaction, config-driven) y un ejemplo
  mínimo ejecutable de pipeline (retriever + generator) con imports desde
  `'karajan-rag'`. Tabla con los 4 ejemplos de `examples/`.

### Changed

- **API pública** estructurada en `index.js` como barrel de re-exports sin
  side effects. `import * as kr from 'karajan-rag'` expone 62 símbolos
  (runPipeline, Role, SolomonRole, GeneratorRole, parallelRetrieve,
  createOllamaStreamAdapter, chunkers, embedders, vector stores, policy,
  redactPII, config-driven runs, etc.). El demo previo de CLIs múltiples
  se ha movido a `examples/multi-cli-demo.js`; `npm start` apunta ahí.
  Tests de contrato en `tests/public-api.test.js` detectan regresiones.

### Added

- **Ollama streamAdapter**: `createOllamaStreamAdapter({baseUrl, model, fetchImpl?, options?})`
  en `src/ai/adapters/ollama-stream-adapter.js`. Devuelve una función
  `(prompt) => AsyncIterable<string>` compatible con
  `GeneratorRole.streamGenerate`. Consume `POST /api/generate` con
  `stream: true`, parsea NDJSON (trozos partidos reensamblados), emite
  `response` token a token y corta cuando `done === true`. Líneas
  malformadas se ignoran silenciosamente sin romper el stream.
- **Demo multi-source**: `examples/solomon-multi-source.js` encadena
  `parallelRetrieve` (3 sources con timeout), `SolomonRole` en modo
  `weighted` con pesos por fuente y `GeneratorRole.streamGenerate` con un
  streamAdapter simulado. Imprime retrievals por source, verdict Solomon
  con rationale y la respuesta token a token. Ejecutable sin credenciales.
- **Helper `parallelRetrieve`**: en `src/retrieval/parallel-retrieve.js`.
  Paraleliza retrievers por source con `Promise.allSettled`, tolera fallos
  y timeouts individuales (`timeoutMs` opcional), y devuelve el formato
  `SolomonSourceResult[]` listo para alimentar `SolomonRole`. Cierra el
  loop multi-source que dejaba abierto ADR-004 (la paralelización está en
  el caller, no en Solomon).
- **Generator streaming**: `GeneratorRole.streamGenerate(input, tools)` como
  async generator. Si el constructor (o `tools`) provee un `streamAdapter`
  (`(prompt) => AsyncIterable<string>`), se reenvía chunk por chunk; si no,
  fallback al adapter no-streaming con un único yield del answer completo.
  Compatible con `for await` directo; la API `run()` tradicional no cambia.
- **ADR-004** — Solomon: implementación real de estrategias de arbitraje.
  Documenta las tres estrategias (`majority`, `weighted`, `llm-arbiter`), la
  decisión explícita de no paralelizar retrievers dentro de Solomon y el
  formato de `ctx.metadata.solomonDecision`. ADR-003 pasa a `superseded`.
- **SolomonRole real**: sustituye el stub de ADR-003 por una implementación
  con tres estrategias configurables: `majority` (chunks que aparecen en
  más sources suben, bonus por co-ocurrencia), `weighted` (combinación
  lineal con `sourceWeights` por fuente) y `llm-arbiter` (delega a un
  callback externo auditable). La decisión se registra en
  `ctx.metadata.solomonDecision` con `strategy`, `rationale`, `sourceWeights`,
  `sourcesCount` y `selectedIds`.
- **Demo de observabilidad**: `examples/observability-demo.js` muestra cómo
  conectar los nuevos hooks de pipeline, capturar los eventos e imprimir
  una tabla con `console.table`. Ejecutable con `node examples/observability-demo.js`.
- **Pipeline events**: `runPipeline(stages, input, ctx, { events })` acepta
  hooks `onStageStart`, `onStageEnd` y `onStageError`. Cada evento incluye
  `stageName`, `stageIndex`, `durationMs` (medido con `performance.now()`) e
  `inputSize`/`outputSize` estimados heurísticamente. Los hooks que lancen
  no propagan errores al pipeline (se logean en `ctx.logger.warn`). Primera
  pieza de observabilidad en 0.2.0.
- **EmbeddingCache metrics**: `stats` ahora expone `{hits, misses, evictions, size}`
  con `size` calculado dinámicamente desde el store si implementa `.size` (como
  `Map`). Stores custom con política de eviction pueden incrementar
  `stats.evictions` llamando al helper `onEviction()` expuesto por el embedder
  cacheado. Compatibilidad retro total (hits/misses siguen accesibles igual).

### Changed

- **Pre-publish gate**: `scripts.prepublishOnly` en `package.json` ejecuta
  `pnpm lint && pnpm test` antes de cualquier `npm publish`. Red de seguridad
  para evitar liberar un tarball con lint rojo o tests rotos.
- **Tarball npm**: añadido campo `files` en `package.json` para restringir el
  paquete publicado a `bin/`, `src/`, `migrations/`, `index.js` y la
  documentación canónica (README, CHANGELOG, ROADMAP, SECURITY, LICENSE).
  Reduce de 99 → 49 ficheros (de 105 kB → 63 kB), excluyendo tests, ejemplos,
  CI config, docker-compose, eslint config y scripts de dev.

### Added

- **ROADMAP.md** con visión pública de versiones 0.2.0 → 1.0 (observabilidad,
  Solomon real, evaluación avanzada, reindex, SDK embebible, estabilidad de API).
  Enlazado desde README reemplazando el "Roadmap (Sprint 1)" obsoleto.
- **.nvmrc** con Node 22 para unificar la versión activa por defecto con la
  recomendada de CI.
- **Repo polish**: badges en README (CI, release, license, Node, status), `.github/CODEOWNERS`
  con owners por defecto y áreas sensibles (policy, redaction, adapters),
  `.editorconfig` y `.gitattributes` fijando indentación 2sp, LF y UTF-8.
- **Repo automation**: `.github/dependabot.yml` vigila npm y github-actions
  semanalmente (lunes 06:00 Europe/Madrid) con PRs etiquetadas.
- **Templates**: `.github/ISSUE_TEMPLATE/{bug_report,feature_request,config}.yml`
  y `.github/pull_request_template.md` con checklist de tests/lint/card ID.
- **Release workflow**: `.github/workflows/release.yml` publica GitHub Release
  automáticamente al push de tags `v*.*.*`, validando que `package.json`
  coincide con el tag y extrayendo notas desde `CHANGELOG.md` mediante
  `scripts/extract-changelog.js` (con tests).

## [0.1.0] — 2026-04-19

Primer release etiquetado tras el Sprint 1. Incluye el esqueleto completo del
orquestador RAG multi-CLI con stubs locales y puertas de entrada para backends
reales.

### Added

- **Pipeline Engine & Role System**: `runPipeline` secuencial con policy de
  errores (abort/continue), `RoleRegistry` inyectable, clase base `Role`
  portada de Karajan Code con atribución.
- **CLI Adapters**: Claude, Codex (NDJSON streaming), Gemini, Ollama on-premise,
  `AdapterRegistry` y `multi-cli-orchestrator` con `Promise.allSettled`.
- **Ingestión**: loaders `loadTextFile`/`loadTextDirectory`; chunkers
  `chunkByFixedSize`, `chunkBySeparators`, `chunkByTokens` (heurística /4) y
  `chunkByHeadings` (Markdown).
- **Embedding**: `HashEmbedder` determinista, `OpenAICompatibleEmbedder` con
  preset `createOllamaEmbedder`, `EmbeddingCache` decorator por
  `sha256(model|dimensions|text)`, `TransformersJsEmbedder` peer-optional.
- **Vector Stores**: `InMemoryVectorStore` (cosine), `PgVectorStore` con schema
  pgvector + índice HNSW, `LanceDBStore` peer-optional.
- **Retrieval**: `RetrieverRole` con modos vector/hybrid/bm25, `RerankerRole`
  score/llm, BM25 vanilla JS, `dedupeChunksByOverlap` (Jaccard >60%),
  similarity threshold.
- **Generation**: `GeneratorRole` con prompt+contexto y `forceCitation`
  configurable + `extractCitations`.
- **Evaluation**: `evaluateMultiJudge` multi-agente con disagreement
  detection, `EvaluatorRole` como stage de pipeline.
- **Data Sensitivity**: metadata `sensitivity` en Document/Chunk,
  `SensitivityPolicy` con routing por nivel, `redactPII` (email/teléfono/NIF/
  NIE/tarjeta), `RedactionRole` Stage 2.5 pre-generación.
- **Private Cloud**: adapters Azure OpenAI (HTTP), AWS Bedrock (SDK dyn-import),
  Vertex AI (SDK dyn-import) con policy `internal` actualizada.
- **Config-Driven Runs**: `loadPipelineConfig` + `buildPipelineFromConfig` +
  binario CLI `karajan-rag run` + `createDefaultRoleRegistry`.
- **Examples**: corpus demo en `examples/sample-corpus/`, `run-demo.js` end-to-end,
  `pipeline.json` declarativo.
- **Quality**: ESLint flat config ES2025, c8 coverage con umbrales 80%, CI
  GitHub Actions matriz Node 20/22, smoke tests opt-in por proveedor.
- **Documentación**: README con quickstart, `docs/mining-kjc.md`, ADR-001
  (Karajan-style patterns), ADR-002 (reindex policy), ADR-003 (Solomon slot).
- **Solomon slot**: `SolomonRole` stub + typedefs para multi-source arbitrage.

### Notable

- 221 tests unitarios en node:test, todos verdes en Node 20 y Node 22.
- Proyecto licenciado AGPL-3.0-or-later.
- Sin dependencias runtime (excepto `pg` devDep para PgVectorStore y peer-opts
  para TransformersJs/LanceDB/Bedrock/VertexAI).

[Unreleased]: https://github.com/manufosela/karajan-rag/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/manufosela/karajan-rag/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/manufosela/karajan-rag/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/manufosela/karajan-rag/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/manufosela/karajan-rag/releases/tag/v0.1.0

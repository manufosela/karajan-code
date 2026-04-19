# Changelog

Todos los cambios notables en este proyecto se documentan aquí.

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y
este proyecto sigue [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/manufosela/karajan-rag/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/manufosela/karajan-rag/releases/tag/v0.1.0

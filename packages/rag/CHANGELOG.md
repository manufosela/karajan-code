# Changelog

Todos los cambios notables en este proyecto se documentan aquí.

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y
este proyecto sigue [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

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

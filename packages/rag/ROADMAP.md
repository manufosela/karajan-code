# Karajan RAG — Roadmap

> Versión viva del plan. Se revisa al cierre de cada sprint y al publicar un release.
> Para el estado actual y los detalles tácticos, ver el backlog privado en **Planning Game** (`KJR-TSK-XXXX`).

Última revisión: **2026-07-22** (post-release 0.2.0; épica Easy RAG entregada en main como 0.3.0).

---

## Principios que guían el roadmap

1. **Sensitivity first.** Ninguna feature puede degradar el routing por sensibilidad ni el redactor PII.
2. **Determinismo por defecto.** Los stubs locales (HashEmbedder, InMemoryVectorStore) siguen operativos sin credenciales externas.
3. **Dependencias runtime mínimas.** Las integraciones pesadas (transformers.js, LanceDB, SDKs de cloud) entran vía `peerDependencies` opcionales y dynamic import.
4. **API pública estable a partir de 1.0.** Hasta entonces (serie 0.x), los cambios breaking se documentan en `CHANGELOG.md` pero no requieren ciclo de deprecación.

---

## 0.1.x — Estabilización (activo)

**Objetivo**: consolidar la superficie actual, pulir documentación, automatización del repo y bugfixes.

- Automatización del repo: Dependabot, templates, workflow de release (✅ `0.1.0+`).
- Badges, CODEOWNERS, `.editorconfig`, `.nvmrc`, `ROADMAP.md` (✅).
- Parches menores de documentación y ejemplos.
- No se añaden features nuevas en esta serie.

## 0.2.0 — Observabilidad y Solomon real (✅ publicada 2026-07-22)

**Estado**: publicada. Los dos flecos que quedaron fuera (adapter OpenTelemetry y
stream adapters nativos Claude/Azure/Vertex) pasan a la serie 0.2.x/0.3.0.

**Objetivo**: instrumentar el pipeline y sustituir el stub de Solomon por una implementación de referencia.

- **Observabilidad**
  - ✅ Emisión estructurada de eventos por stage (`onStageStart`, `onStageEnd`, `onStageError`) con duración y tamaño de entrada/salida (PR #50).
  - ✅ Helper `collectPipelineEvents` para captura sin boilerplate (PR #62).
  - ✅ Demo `examples/observability-demo.js` (PR #51).
  - ✅ Métricas de cache de embeddings (`hits, misses, size, evictions`) en `EmbeddingCache.stats` (PR #49).
  - ⏳ Adapter opcional a OpenTelemetry (peer-dep) — pospuesto a 0.2.x/0.3.0.
- **Solomon real**
  - ✅ Tres estrategias: `majority`, `weighted`, `llm-arbiter` (PR #53).
  - ✅ `ctx.metadata.solomonDecision` como log de auditoría.
  - ✅ Helper `parallelRetrieve(sources, query, {timeoutMs})` en el caller (PR #56).
  - ✅ Demo `examples/solomon-multi-source.js` end-to-end (PR #57).
  - ✅ [ADR-004](./docs/adrs/ADR-004-solomon-implementation.md) cerrando la fase de "stub" (PR #54).
- **Generator streaming**
  - ✅ `GeneratorRole.streamGenerate()` como async iterable con fallback a adapter no-streaming (PR #55).
  - ✅ `createOllamaStreamAdapter` (HTTP NDJSON) como primer streamAdapter real (PR #58).
  - ✅ Helper `wrapAdapterAsStream` para adapters blocking (PR #61).
  - ⏳ Stream adapters nativos para Claude/Azure/Vertex — pospuestos a 0.2.x/0.3.0.
- **API pública**
  - ✅ `index.js` barrel con 63 símbolos re-exportados (PR #59) + documentación en README (PR #60).
  - ✅ Tests de contrato (`tests/public-api.test.js`).

## 0.3.0 — Easy RAG: crear RAGs en minutos

**Estado**: núcleo entregado en main (épica KJR-PCS-0016, ADR-005). Pendiente el tag.

**Objetivo**: que montar un RAG sobre código, documentos o datos cueste minutos y cero código, en local y en cloud.

- ✅ Autodetección de fuentes (código/docs/datos) y presets con defaults deterministas.
- ✅ `karajan-rag index` — índice persistente local (LanceDB) con manifest ADR-002 y reindex incremental.
- ✅ `karajan-rag query` — retrieval híbrido (vector+BM25) con `fichero:línea` y `--answer` opcional.
- ✅ `karajan-rag init` — scaffold de `karajan.config.json` como defaults del proyecto.
- ✅ `karajan-rag serve` — servidor MCP stdio (`rag_query`/`rag_status`) y HTTP (`/query`, `/health`).
- ✅ Imagen Docker multi-stage + servicio en docker-compose.
- ✅ Módulo Terraform `deploy/gcp/` (Cloud Run + Cloud SQL pgvector + GCS FUSE + Secret Manager), privado por defecto.
- ✅ Guía end-to-end [docs/easy-rag.md](./docs/easy-rag.md).
- Adelanta de 0.5.0: el manifest incremental de ADR-002 (la migración entre stores sigue ahí).

## 0.4.0 — Evaluación avanzada y golden set

**Objetivo**: elevar la calidad del módulo de evaluación y proporcionar un baseline reproducible.

- **Golden set incluido** en `examples/golden/` (preguntas + answers + contextos mínimos) para smoke-tests offline.
- **Métricas**: faithfulness, context precision/recall, answer relevance (variantes locales sin depender de frameworks externos).
- **Disagreement auto-labelling**: marcar automáticamente pares (answer, judge) donde la varianza entre jueces supera un threshold configurable.
- **Reranker LLM** con prompt-template auditado y tests snapshot.
- **`karajan-rag eval`** subcomando CLI para lanzar evaluaciones declarativas.

## 0.5.0 — Persistencia y reindexado

**Objetivo**: políticas robustas de reindex, migración entre stores y modelos.

- Completar la política de reindex de `ADR-002` sobre la base entregada en 0.3.0 (manifest por fingerprint ya operativo en la capa Easy RAG; falta generalizarla al pipeline declarativo).
- Migración asistida `InMemoryVectorStore` ↔ `PgVectorStore` ↔ `LanceDBStore`.
- Soporte de `DELETE`/`UPDATE` por `documentId` con invalidación coherente de caché.
- Backpressure en ingestas grandes (streaming + lotes configurables).

## 0.6.0+ — Integraciones embebidas y ecosistema

**Objetivo**: abrir la orquestación a casos fuera del CLI puro.

- SDK embebible para frameworks (Astro/Next/Fastify) — sin CLI, solo API.
- Adapter `openai` estándar (para OpenAI público cuando la política lo permita).
- Adapter `anthropic` HTTP (complemento al CLI de Claude para entornos sin shell).
- Adapter `ollama` bidireccional (embeddings + generación con el mismo proceso).
- `karajan-rag doctor` — diagnóstico de configuración, credenciales, pgvector, etc.

## 1.0 — Estabilidad de API

**Criterios de salida de la serie 0.x:**

- API pública documentada, versionada y con tests de contrato.
- Superficie mínima cubierta al 90% (vs 80% actual).
- Política de deprecación formalizada (2 menores de pre-aviso).
- Golden set + runbook de evaluación publicados.
- Auditoría externa de la política de sensibilidad y del redactor PII.
- Al menos un caso de uso real en producción documentado públicamente.

---

## Fuera del roadmap (por ahora)

Cosas que pueden llegar, pero no están priorizadas:

- Integración con bases de conocimiento propietarias (Confluence, Notion, SharePoint).
- UI web propia — el foco es la librería/CLI, la capa visual queda para terceros.
- Soporte a modelos cerrados sin API compatible (cualquier proveedor requerirá adapter mantenible).

---

## Feedback

Ideas, quejas o propuestas: abre un issue en la categoría **Feature request** o comparte en Discussions. El backlog táctico vive en el Planning Game privado.

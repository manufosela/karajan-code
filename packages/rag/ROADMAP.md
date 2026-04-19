# Karajan RAG — Roadmap

> Versión viva del plan. Se revisa al cierre de cada sprint y al publicar un release.
> Para el estado actual y los detalles tácticos, ver el backlog privado en **Planning Game** (`KJR-TSK-XXXX`).

Última revisión: **2026-04-19** (post-release 0.1.0).

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

## 0.2.0 — Observabilidad y Solomon real

**Objetivo**: instrumentar el pipeline y sustituir el stub de Solomon por una implementación de referencia.

- **Observabilidad**
  - Emisión estructurada de eventos por stage (`onStageStart`, `onStageEnd`, `onStageError`) con duración y tamaño de entrada/salida.
  - Adapter opcional a OpenTelemetry (peer-dep) sin acoplar el core.
  - Métricas de cache de embeddings (hits/misses) expuestas por `EmbeddingCache`.
- **Solomon real**
  - Ejecución multi-source paralela con `Promise.allSettled`.
  - Estrategias de arbitraje: `majority`, `weighted`, `llm-arbiter` (usa `evaluateMultiJudge`).
  - Registro de decisiones en el resultado para auditoría.
  - ADR-004 cerrando la fase de "stub".
- **Generator streaming**
  - Interfaz `streamGenerate()` para CLIs que emiten tokens (Claude, Codex, Gemini).
  - Compatible con consumidores síncronos (buffer interno).

## 0.3.0 — Evaluación avanzada y golden set

**Objetivo**: elevar la calidad del módulo de evaluación y proporcionar un baseline reproducible.

- **Golden set incluido** en `examples/golden/` (preguntas + answers + contextos mínimos) para smoke-tests offline.
- **Métricas**: faithfulness, context precision/recall, answer relevance (variantes locales sin depender de frameworks externos).
- **Disagreement auto-labelling**: marcar automáticamente pares (answer, judge) donde la varianza entre jueces supera un threshold configurable.
- **Reranker LLM** con prompt-template auditado y tests snapshot.
- **`karajan-rag eval`** subcomando CLI para lanzar evaluaciones declarativas.

## 0.4.0 — Persistencia y reindexado

**Objetivo**: políticas robustas de reindex, migración entre stores y modelos.

- Implementación completa de la política de reindex descrita en `ADR-002` (fingerprint por `model|dimensions|chunkSize`).
- Migración asistida `InMemoryVectorStore` ↔ `PgVectorStore` ↔ `LanceDBStore`.
- Soporte de `DELETE`/`UPDATE` por `documentId` con invalidación coherente de caché.
- Backpressure en ingestas grandes (streaming + lotes configurables).

## 0.5.0+ — Integraciones embebidas y ecosistema

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

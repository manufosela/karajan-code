# Changelog

## 0.1.0 — 2026-07-26

Primera versión publicada. Producto completo de las tres fases del diseño:

### F1 — RAG compartido vivo
- Esquema de configuración `karajan-watch.config.json` validado
  estrictamente (repos, corpus code/docs, sensibilidad heredando el
  modelo de karajan-rag, umbrales, destinos de aviso, policy opcional).
- Ingesta por merge sobre workspace multi-repo (`karajan-watch ingest` +
  workflow reusable `ingest.yml`): reindex incremental con embedder
  local, sensibilidad estampada por repo, verificación de workspace
  completo (un workspace parcial destruiría el corpus) y reindex
  serializado por corpus.

### F2 — Impacto cross-repo
- Pipeline completo (`karajan-watch impact` + `impact.yml`): parser de
  diff a chunks-query, retrieval con exclusión del repo origen, minero
  de co-cambios git por ventanas temporales, juicio LLM gobernado por la
  sensitivity policy (sin degradación silenciosa de adapters) y ranking
  de riesgo con evidencia — nunca "probabilidades". Avisos por comentario
  de PR y/o webhook https con PII redactada.
- Eval con golden set de incidentes (`karajan-watch eval`):
  precision/recall@k como gate de calibración.

### F3 — Deriva de documentación
- `karajan-watch drift` + `drift.yml`: secciones de docs que mencionan
  lo cambiado, con enlaces fichero:línea y juicio LLM opcional.

### Seguridad y operación
- Embedders locales (el código nunca viaja a terceros), redactPII en
  toda salida, tokens fuera de URLs de clone, sin fallbacks silenciosos:
  el sistema funciona o falla en rojo.

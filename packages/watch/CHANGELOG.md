# Changelog

## No publicado

### Nuevo

- **Se puede usar sin base de datos.** El store `lancedb` —un directorio en
  disco, sin servidor— ya estaba admitido en la configuración, pero no lo
  ejercía nada: era una promesa. Ahora el smoke end-to-end corre contra los
  dos stores desplegables, y el de `lancedb` va en CI **sin service
  container**, que es justo la demostración. Empezar ya no exige decidir
  dónde alojar un Postgres.
- **El paquete anuncia lo que necesita**: `@lancedb/lancedb` y `pg` quedan
  declarados como peers opcionales. El motor no arrastra ninguno, así que
  quien usa un store no paga el binario del otro; hasta ahora quien instalaba
  karajan-watch no podía indexar con **ningún** store y solo lo descubría al
  ejecutar.
- Documentado el límite real de la vía sin servidor —el corpus vive en el
  disco de quien indexa, así que en runners efímeros hay que persistirlo o
  usar `pgvector`— y que los scores no son comparables entre backends.

## 0.2.0 — 2026-07-29

> **Si estás en 0.1.0, actualiza.** Aquella versión tenía la ingesta rota:
> `karajan-watch ingest` moría con `ENOENT` antes de indexar nada salvo que
> tuvieras karajan-rag instalado globalmente.

### Nuevo

- **Cuarta señal del impacto: contratos.** Las otras tres son heurísticas
  (similitud, correlación temporal, juicio LLM); esta busca acoplamiento
  declarado: identificadores del diff —rutas HTTP y paths de OpenAPI,
  topics de evento, tablas SQL— buscados **literalmente** en los demás
  repos. Un fichero con contrato compartido entra al ranking aunque el
  retrieval no lo hubiera traído, y va por delante del resto; los
  contratos **rotos** (identificadores que desaparecen) van primero.
  Configurable con la sección `contracts` (`enabled`, `types`).
- **Arranque por prompt de agente**: `docs/prompts/start.md`, servido en
  <https://watch.karajancode.com/start.md>. El agente pregunta lo que solo
  tú puedes decidir, monta tu repo de despliegue y se detiene a esperarte;
  nunca maneja tus secretos.
- `--no-judge` en el CLI para correr solo con señales, sin LLM.
- El pipeline informa de cada fase (chunks, candidatos, contratos,
  co-cambios, juicio) en vez de ser una caja negra.

### Corregido

Todo esto salió de ejecutar el producto de verdad contra pgvector con un
corpus de 13.894 chunks; los tests con dobles no lo veían.

- **La ingesta no funcionaba** salvo con karajan-rag global: el binario de
  la dependencia se resuelve ahora desde el propio paquete.
- **El prompt del juicio no estaba acotado**: 88.727 caracteres en un caso
  real. Ahora tiene topes por señal y declara lo que omite.
- **El guardia anti-alucinación tumbaba juicios legítimos** apoyados en
  co-cambios: ahora valida contra las tres señales, no solo el retrieval.
- **El juicio no tenía timeout**: un adapter lento dejaba el job ocupado
  hasta el tope del runner.
- **El proceso nunca terminaba**: el pipeline abría la conexión al store y
  no la cerraba, así que el job seguía vivo *después* de hacer el trabajo.

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

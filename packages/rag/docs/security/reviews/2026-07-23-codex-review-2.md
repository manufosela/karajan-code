<!--
Contexto: pasada 2 de la revisión independiente asistida (OpenAI Codex,
codex-cli 0.124.0, sandbox read-only) — verificación hostil de las
correcciones de la pasada 1, sobre main en cafdc79. Informe íntegro sin
edición. Triaje: los residuales se corrigieron en las PRs #124 (suelo
autoritativo del manifest en query), #125 (rechazo de prefijos ambiguos)
y #126 (zero-width eliminados + límite de homoglifos declarado); el BAJO
de §6 se corrigió en la misma PR que añade este informe.
-->

# Informe de re-verificación — política de sensibilidad y redacción PII (pasada 2)
Auditor: OpenAI Codex (codex-cli, sandbox read-only) — revisión independiente asistida  
Fecha: 2026-07-23

## Veredicto
RECHAZADO — la parte de reindexado sí ha mejorado materialmente, pero el cierre no es completo en el perímetro de la capa easy. La decisión de adapter en `query --answer` sigue dependiendo de la `metadata.sensitivity` devuelta por el store, no de una fuente de verdad verificada, así que un store con metadata alterada o desfasada todavía puede degradar el routing. Además, el redactor ha cerrado los bypasses citados en la pasada 1, pero no resiste todavía ofuscaciones Unicode realistas adicionales. La API de bajo nivel sí queda mejor delimitada documentalmente.

## Verificación de los hallazgos de la pasada 1
[PARCIAL] CRÍTICO — reestampado de sensibilidad en reindex  
Evidencia: [src/easy/indexer.js](/home/manu/ws_npm-packages/karajan-rag/src/easy/indexer.js:198), [src/easy/indexer.js](/home/manu/ws_npm-packages/karajan-rag/src/easy/indexer.js:232), [src/easy/indexer.js](/home/manu/ws_npm-packages/karajan-rag/src/easy/indexer.js:253), [src/easy/manifest.js](/home/manu/ws_npm-packages/karajan-rag/src/easy/manifest.js:23), [src/easy/indexer.js](/home/manu/ws_npm-packages/karajan-rag/src/easy/indexer.js:143), [src/easy/indexer.js](/home/manu/ws_npm-packages/karajan-rag/src/easy/indexer.js:156), [src/easy/indexer.js](/home/manu/ws_npm-packages/karajan-rag/src/easy/indexer.js:213).  
Verificación hostil: el nivel ya se persiste por fichero en manifest, un nivel distinto o ausente promueve el fichero desde `unchanged` a reprocesado, y los caminos de `legacy manifest`, `fullReindex` por fingerprint y `removed` están contemplados. Lo que no ha quedado cerrado es el otro medio del hallazgo original: la query sigue calculando la sensibilidad efectiva desde la metadata que devuelve el store (`src/easy/query.js:95-124`), así que una marca corrupta/antigua en el store todavía puede sobrevivir hasta el gate.  
Tests: [tests/easy-sensitivity-reindex.test.js](/home/manu/ws_npm-packages/karajan-rag/tests/easy-sensitivity-reindex.test.js:28), [tests/easy-sensitivity-reindex.test.js](/home/manu/ws_npm-packages/karajan-rag/tests/easy-sensitivity-reindex.test.js:61), [tests/easy-sensitivity-reindex.test.js](/home/manu/ws_npm-packages/karajan-rag/tests/easy-sensitivity-reindex.test.js:92). Prueban reestampado por cambio de nivel, noop con mismo nivel y migración legacy; no prueban `store` sin `size`, `fullReindex`, `removed` ni metadata del store manipulada.

[PARCIAL] ALTO — inventario / afirmaciones falsas  
Evidencia: [docs/security/sensitivity-audit.md](/home/manu/ws_npm-packages/karajan-rag/docs/security/sensitivity-audit.md:46), [docs/security/sensitivity-audit.md](/home/manu/ws_npm-packages/karajan-rag/docs/security/sensitivity-audit.md:47), [docs/security/sensitivity-audit.md](/home/manu/ws_npm-packages/karajan-rag/docs/security/sensitivity-audit.md:125), [src/retrieval/reranker-role.js](/home/manu/ws_npm-packages/karajan-rag/src/retrieval/reranker-role.js:22), [src/evaluation/evaluator-role.js](/home/manu/ws_npm-packages/karajan-rag/src/evaluation/evaluator-role.js:19).  
Verificación hostil: §3 y §5 ya son sustancialmente honestos; la frontera “API de bajo nivel, responsabilidad del integrador” está expresada y los JSDoc avisan explícitamente que esos roles no aplican policy ni redacción. La pega es §6: el documento afirma que los “4 hallazgos accionables” quedaron “todos corregidos el mismo día” ([docs/security/sensitivity-audit.md](/home/manu/ws_npm-packages/karajan-rag/docs/security/sensitivity-audit.md:137)), lo que no sostengo tras esta re-verificación porque el cierre del hallazgo crítico sigue incompleto.

[PARCIAL] MEDIO — frontera de prefijo  
Evidencia: [src/easy/sensitivity.js](/home/manu/ws_npm-packages/karajan-rag/src/easy/sensitivity.js:32), [src/easy/config.js](/home/manu/ws_npm-packages/karajan-rag/src/easy/config.js:104), [tests/easy-sensitivity-metadata.test.js](/home/manu/ws_npm-packages/karajan-rag/tests/easy-sensitivity-metadata.test.js:76).  
Verificación hostil: el bug original de `startsWith` sin frontera está corregido; `docs/public` ya no captura `docs/public-secrets` ni `docs/publico.md`, y eso sí está testeado. Quedan casos borde sin canonizar: prefijos con `./`, con backslashes, y `"/"` que tras quitar la barra queda vacío y pasa validación pero no matchea nada útil. Tampoco hay definición explícita de mayúsculas/minúsculas fuera de la semántica del filesystem.

[PARCIAL] MEDIO — Unicode en `redactPII`  
Evidencia: [src/redaction/pii-redactor.js](/home/manu/ws_npm-packages/karajan-rag/src/redaction/pii-redactor.js:28), [src/redaction/pii-redactor.js](/home/manu/ws_npm-packages/karajan-rag/src/redaction/pii-redactor.js:75), [tests/policy-redactor.test.js](/home/manu/ws_npm-packages/karajan-rag/tests/policy-redactor.test.js:147), [tests/policy-redactor.test.js](/home/manu/ws_npm-packages/karajan-rag/tests/policy-redactor.test.js:163).  
Verificación hostil: NFKC + mapeo de espacios sí cierra los vectores citados en la pasada 1: `＠` fullwidth, thin spaces y NIF/NIE con separadores; un IBAN con guiones también cae por `[ -]?`. Intentos nuevos: `cliente‍@empresa.com` con ZWJ `U+200D` dentro del localpart y `clieпte@empresa.com` con homoglifos cirílicos. Ambos sobreviven: `U+200D` no se elimina en la normalización actual y la regex de email sigue siendo ASCII.

## Hallazgos nuevos o residuales
[CRÍTICO] La capa easy sigue confiando en la metadata del store como fuente de verdad para sensibilidad  
Evidencia: [src/easy/query.js](/home/manu/ws_npm-packages/karajan-rag/src/easy/query.js:95), [src/easy/query.js](/home/manu/ws_npm-packages/karajan-rag/src/easy/query.js:124), [src/easy/cli.js](/home/manu/ws_npm-packages/karajan-rag/src/easy/cli.js:365).  
Escenario: si el store devuelve un hit con `metadata.sensitivity: "public"` aunque el manifest/documento real sea `confidential`, `effectiveSensitivityOfHits` degradará el routing y `query --answer` podrá escoger un adapter demasiado permisivo. Esto afecta al perímetro easy, no solo a la API de bajo nivel.  
Recomendación: la decisión de sensibilidad en query debe verificarse contra una fuente autoritativa separada del metadata retornado por el store.

[MEDIO] `matchesPathPrefix` no canoniza prefijos antes de compararlos  
Evidencia: [src/easy/sensitivity.js](/home/manu/ws_npm-packages/karajan-rag/src/easy/sensitivity.js:32), [src/easy/config.js](/home/manu/ws_npm-packages/karajan-rag/src/easy/config.js:104).  
Escenario: reglas como `./docs/public`, `docs\\public` o `/` son aceptadas o al menos no rechazadas claramente, pero no tienen semántica consistente con las rutas relativas que usa la capa easy.  
Recomendación: normalizar prefijos de config a una forma canónica o rechazar explícitamente formas ambiguas.

[MEDIO] `redactPII` sigue siendo evadible con Unicode no cubierto por la normalización actual  
Evidencia: [src/redaction/pii-redactor.js](/home/manu/ws_npm-packages/karajan-rag/src/redaction/pii-redactor.js:20), [src/redaction/pii-redactor.js](/home/manu/ws_npm-packages/karajan-rag/src/redaction/pii-redactor.js:75).  
Escenario: emails con `U+200C/U+200D` insertados en el localpart o con letras cirílicas/greigas homoglifas no son plegados a ASCII ni limpiados antes de aplicar la regex, por lo que llegan intactos al prompt.  
Recomendación: ampliar la normalización/canonización o documentar explícitamente este límite como conocido.

[BAJO] §6 del documento de auditoría sobredeclara el estado de cierre  
Evidencia: [docs/security/sensitivity-audit.md](/home/manu/ws_npm-packages/karajan-rag/docs/security/sensitivity-audit.md:137).  
Escenario: el texto dice que los cuatro hallazgos de la revisión del 2026-07-23 quedaron “todos corregidos el mismo día”, pero esta segunda pasada no lo confirma.  
Recomendación: ajustar el estado para no presentar como cerrado lo que sigue siendo residual.

## Limitaciones
Revisión estática únicamente. No he ejecutado tests ni binarios: el entorno read-only/sandbox de esta sesión no me permitió validación dinámica por shell. El veredicto se basa en inspección directa de código, documentación y tests presentes a fecha de 2026-07-23.

<!--
Contexto: revisión independiente asistida (criterio 1.0). Ejecutada con
OpenAI Codex (codex-cli 0.124.0, modelo de proveedor distinto al que
desarrolló el código, sin contexto compartido), en sandbox read-only sobre
el repo en v0.7.0 (commit c170371), con el checklist §5 de
docs/security/sensitivity-audit.md como guion. Informe reproducido íntegro
y sin edición. Triaje: hallazgos registrados como KJR-BUG-0007..0010.
-->

# Informe de revisión independiente — política de sensibilidad y redacción PII
Auditor: OpenAI Codex (codex-cli, sandbox read-only) — revisión independiente asistida  
Fecha: 2026-07-23

## Veredicto
RECHAZADO — la garantía central no se sostiene de forma robusta. El routing de sensibilidad de la capa easy confía en metadata de chunks no verificada ni invalidada por cambios de policy/configuración, y además el inventario de flujos hacia LLM no es exhaustivo: existen caminos de reranking y evaluación en la API de bajo nivel que envían contenido sin gates locales. La redacción PII también es fácilmente evadible con ofuscaciones Unicode y separadores no ASCII.

## Hallazgos
[CRÍTICO] La sensibilidad efectiva depende de metadata de chunk no verificada ni reindexada por cambios de policy  
Evidencia: `src/easy/indexer.js:136`, `src/easy/indexer.js:188`, `src/easy/indexer.js:194`, `src/easy/indexer.js:215`, `src/easy/query.js:124`, `src/easy/manifest.js:17-22`, `src/easy/manifest.js:146-148`.  
El indexador solo vuelve a estampar `metadata.sensitivity` cuando el fichero entra en `added/changed`; los `unchanged` se preservan tal cual. El fingerprint no incorpora sensibilidad/policy, y el manifest no persiste una copia verificable de esa sensibilidad. En query, el nivel se toma ciegamente del `hit.metadata` que devuelve el store.  
Escenario de explotación: indexas un corpus como `public`, luego endureces `karajan.config.json` a `internal` o `confidential` y vuelves a ejecutar `karajan-rag index`. Si el contenido no cambió, los chunks quedan con la marca antigua y `query --answer --adapter claude` sigue saliendo por un proveedor público. Variante: si el store devuelve metadata corrupta/manipulada con `sensitivity: "public"`, el gate también falla abierto.  
Recomendación: la sensibilidad debe invalidar/reprocesar el índice o verificarse en query contra una fuente de verdad separada del metadata devuelto por el store.

[ALTO] El inventario de flujos §3 no es exhaustivo y la afirmación “los prompts solo se usan tras los gates” es falsa  
Evidencia: `src/retrieval/reranker-role.js:56-57`, `src/evaluation/evaluator-role.js:50-58`, `src/evaluation/multi-judge-evaluator.js:33`, `src/evaluation/multi-judge-evaluator.js:83`, `src/registry/default-role-registry.js:85`, `src/registry/default-role-registry.js:112`.  
`RerankerRole` en modo LLM construye un prompt con `metadata.content` de los hits y lo envía al adapter sin aplicar policy ni redacción local. `EvaluatorRole` hace lo mismo con `contextChunks[].metadata.content` antes de llamar a `evaluateMultiJudge`. Ambos roles se registran por defecto cuando hay `adapterRegistry`, aunque no exista `RedactionRole` ni gate equivalente.  
Escenario de explotación: un integrador monta un pipeline con `reranker-llm` o `evaluator` y un adapter público; fragmentos sensibles salen a ese proveedor aunque el documento de auditoría declare inventario exhaustivo y gates previos.  
Recomendación: o se añaden gates/redacción equivalentes en esos caminos, o se corrige la documentación para dejar de afirmar exhaustividad y uso exclusivo “tras los gates”.

[MEDIO] `sensitivityRules` usa `startsWith` sin semántica de frontera de ruta  
Evidencia: `src/easy/sensitivity.js:34`, `src/easy/config.js:103`.  
Las reglas aceptan cualquier string no vacío como prefijo y la resolución usa `relPath.startsWith(rule.prefix)`. No hay normalización de separadores ni comprobación de frontera de directorio.  
Escenario de explotación: una regla pensada para `docs/public` también clasifica `docs/public-secrets/nominas.md`. Si el operador omitió la barra final o un atacante puede elegir nombres de fichero dentro del corpus, puede forzar una clasificación menos restrictiva de la deseada.  
Recomendación: tratar los prefijos como rutas canónicas, no como prefijos de string arbitrarios.

[MEDIO] `redactPII` se evade con Unicode y separadores no contemplados  
Evidencia: `src/redaction/pii-redactor.js:28`, `src/redaction/pii-redactor.js:33`, `src/redaction/pii-redactor.js:38`, `src/redaction/pii-redactor.js:43`.  
Las regex están limitadas a ASCII y a separadores `[ -]` o `[ .-]`. No hay normalización Unicode previa.  
Escenario de explotación: sobreviven variantes como `cliente＠empresa.com`, `c l i e n t e@empresa.com`, `12345678-Z`, `X-1234567-L`, `ES91 2100 0418 4502 0005 1332` con thin spaces. Esas cadenas pueden llegar intactas al prompt aunque el redactor “pase” en casos nominales.  
Recomendación: normalizar Unicode/separadores antes de aplicar patrones y ampliar la cobertura de IDs y cuentas con variantes comunes de ofuscación.

[NOTA] Los tests prueban el camino nominal, pero no los casos que más tensionan la garantía  
Evidencia: `tests/easy-sensitivity-metadata.test.js:86-97`, `tests/easy-sensitivity-enforcement.test.js:83-129`, `tests/policy-redactor.test.js:98-140`.  
Sí cubren el máximo nominal de hits, el bloqueo de adapters explícitos y varios patrones ASCII del redactor. No cubren: cambio de `karajan.config.json` seguido de reindex incremental, metadata de store manipulada, colisiones de prefijo (`docs/public` vs `docs/public-secrets`), ni PII ofuscada con Unicode/separadores. Tampoco veo cobertura para los caminos `reranker-llm`/`EvaluatorRole` respecto a gates de sensibilidad.  
Recomendación: añadir pruebas de regresión sobre esos casos antes de sostener la garantía como cerrada.

[NOTA] Punto limpio: no he encontrado `fetch(`, `spawn`, `execFile` o `exec` fuera de `src/ai/` y `src/embedding/` que abran un flujo nuevo no documentado  
Evidencia: barrido estático del árbol `src/`. El único `spawn` relevante sigue en `src/ai/cli-runner.js:2,44`, ya dentro del perímetro inventariado.  
Resultado: limpio en este punto concreto.

[NOTA] Punto limpio: los eventos de observabilidad y logs no incluyen contenido de chunks  
Evidencia: `src/pipeline/types.js:90-128`, `src/pipeline/pipeline.js:175-202`, `src/pipeline/collect-events.js:39-41`, `src/easy/cli.js:302-364`, `src/easy/cli.js:603-628`.  
Los hooks de observabilidad solo transportan nombres de stage, tamaños, duración y errores. Los logs de la capa easy reportan estado, no contenido.  
Matiz: `src/easy/cli.js:327` sí imprime `hit.content` por stdout en `query`, pero eso es salida funcional del comando, no telemetría ni log interno.

[NOTA] Punto limpio: `karajan.config.json` y el manifest no persisten contenido de documentos  
Evidencia: `src/easy/config.js:151-153`, `src/easy/manifest.js:17-22`, `src/easy/manifest.js:146-148`.  
La config guarda solo parámetros `easy`; el manifest guarda `hash`, `sourceType` y `chunkIds`. No he visto persistencia de texto de chunks en esos dos ficheros.

## Cobertura del checklist

| Punto §5 | Verificado | Resultado |
|---|---|---|
| 1. Inventario de flujos exhaustivo | Sí | No. No aparecen nuevos `fetch/spawn/exec` fuera de `src/ai` y `src/embedding`, pero faltan los caminos `RerankerRole(llm)` y `EvaluatorRole`. |
| 2. Fix KJR-BUG-0006 | Sí | No. El “máximo de los chunks recuperados” depende de metadata no verificada; además, cambios de sensibilidad/config no fuerzan reindex de chunks sin cambios. |
| 3. Intento de romper `redactPII` | Sí | No. Se evade con Unicode, separadores no ASCII y NIF/NIE con separadores. El solapamiento IBAN/tarjeta/teléfono está razonablemente cubierto. |
| 4. Observabilidad/logs sin contenido | Sí | Sí, con matiz. Hooks y logs internos limpios; la salida funcional de `query` sí muestra chunks al usuario. |
| 5. Prompts de sistema solo tras gates | Sí | No. `buildRerankPrompt` y `buildJudgePrompt` también se usan desde roles de bajo nivel sin gate local obligatorio. |
| 6. Config y manifest no persisten contenido | Sí | Sí. Solo metadatos y hashes en los ficheros revisados. |

## Limitaciones de esta revisión
Revisión estática solamente. No he ejecutado tests ni binarios: la sandbox read-only bloqueó la ejecución de comandos de shell, así que el análisis se basa en inspección de código y tests existentes, no en reproducción dinámica.

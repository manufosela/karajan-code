# Governance kernel: @karajan-family/governance como paquete de familia

Status: accepted
Date: 2026-08-18

## Context

La policy layer (ADR 0001, PL-A/PL-B) construyó un motor de políticas, un gate de decisión y un registro de excepciones — y esos tres objetos no son específicos de desarrollo de software: son un kernel de gobernanza de acciones de agentes. Acoplados a code (git, diffs, tools del harness, rutas .karajan) habría que reescribirlos para rag, watch y radar, y serían inexportables a dominios donde el artefacto no es un diff sino una transacción o un expediente. Restricción de diseño fijada por el usuario 2026-08-18 (validada): el núcleo de gobierno es un paquete independiente; Karajan Code es su primer consumidor, no su dueño.

## Decision

El kernel vive en packages/governance (@karajan-family/governance; patrón hu-board hasta publicarse: workspace npm + imports relativos + whitelist en files del tarball de kj — GOV-D lo convierte en dependencia real). El kernel conoce EXACTAMENTE tres conceptos abstractos: Política (reglas declarativas versionadas, vocabulario CERRADO fail-loud, con subconjunto inexcepcionable), Decisión (evaluación determinista y local de una acción contra una política, sin red ni LLM, con regla citada y enforcement) y Excepción (objeto de primera clase: identidad de quien aprueba, regla exacta, justificación escrita en el momento, alcance con caducidad, hash del artefacto). El kernel NO conoce git, diffs, Sonar, tool calls concretas, agentes ni LLMs: la noción de artefacto es una interfaz (algo con identidad referenciable y hasheable) y cada adaptador la implementa (code: el diff; rag: documento/chunk; watch: evento; radar: informe). Los defaults inexcepcionables son DATOS que cada consumidor inyecta ({id, pattern, message}); en code protegen los ficheros del supervisor del Sentinel. El criterio de frontera: si una constante nombra una tool de harness, una ruta de un proyecto o un comando de git, es del adaptador; si es evaluación de patrones, vocabulario o flujo warn/deny/inexcepcionable/excepción, es del kernel.

Nota de nombre (2026-08-19): el scope npm "karajan" estaba ocupado; el usuario creó la organización "karajan-family" y el paquete queda como @karajan-family/governance — el nombre dice lo que la org ES (una familia de herramientas) y no ata el kernel al dominio código.

## Consequences

Positivas: rag/watch/radar consumen el mismo kernel (index/collection, trigger, source/publish como capabilities futuras) sin reescritura; PL-C se construye ya sobre la frontera correcta; el kernel es exportable a dominios regulados. Aceptadas: una capa de indirección (adaptador) y tests del kernel bajo la raíz hasta que exista CI por paquete (card 0742); publicación npm bloqueada hasta que el usuario cree el scope @karajan (GOV-D); las firmas criptográficas, los approvers autenticados y los plugins de terceros quedan explícitamente FUERA del v1 — el kernel tiene exactamente las abstracciones que la familia actual necesita, ni una más. La identidad de las excepciones es hoy DECLARADA (git+os), no autenticada: el tipo lo dice para no vender atribución como evidencia.

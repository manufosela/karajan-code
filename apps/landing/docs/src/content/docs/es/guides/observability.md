---
title: Observabilidad y veracidad de las reviews
description: Qué registra kj de su propio trabajo, las páginas Usage y Accounts del HU Board, cómo mide kj report si las reviews dicen la verdad y la base de OpenTelemetry (opt-in, y que aún no envía spans).
---

kj guarda un registro pequeño y local de lo que hace, para que puedas preguntar «¿cuánto ha costado esto?» y «¿me puedo fiar de esta review?» y obtener la respuesta de unos ficheros, no de un modelo. Esta página dice qué se registra, dónde leerlo y qué aún no está construido.

## Qué registra kj y qué no registra nunca

| Registro | Dónde | Qué contiene |
| --- | --- | --- |
| Uso | `~/.karajan/usage/YYYY-MM.jsonl` (un fichero por mes UTC) | Una línea por llamada a un agente que lanzó kj: cuándo, proyecto, cuenta, rol, duración, tokens, coste, líneas añadidas y quitadas. |
| Trazas del repo | `.karajan/traces/` en el proyecto | Registros locales de lo que pasó en ese repo, por ejemplo qué agentes trabajan ahora (`agent-activity.jsonl`) y los intentos del gate de commit. |
| Decision log | `.karajan/policy-decisions.jsonl` | Lo que decidieron los gates (permiso, aviso, denegación, exención) y los barridos del Steward, encadenado por hash para que una cadena rota se detecte. |
| Veredictos de review | `.karajan/reviews/` | El veredicto de cada review cruzada, que lee `kj report`. |

El registro de uso no contiene prompts, código ni claves: dice quién ejecutó qué, cuánto tardó y cuánto costó, y nada más. Las trazas del repo sí pueden llevar contenido: una denegación guarda el comando exacto que denegó, y un veredicto de review guarda los hallazgos, que citan código. Todo se queda en tu máquina: kj lee estos ficheros, no los sube.

## El HU Board: Usage y Accounts

Arranca el board (`kj board start`) y abre dos páginas desde su cabecera.

**Usage** (`/usage.html`) muestra cada llamada a un agente que lanzó kj en un rango de meses. Elige un proyecto (o todos), un rango con **From** y **To**, y agrupa por día, mes, año o total. Cada fila suma, por proyecto y cuenta, las llamadas, los tokens de entrada y salida, los tokens en caché, el coste, la duración y las líneas añadidas y quitadas. Una cifra queda vacía mientras ninguna llamada del grupo la haya informado: nunca se muestra como cero. Con un proyecto elegido, **Export CSV** descarga las llamadas de ese proyecto en el mes de **To**.

**Accounts** (`/accounts.html`) muestra los logins de proveedor que conoce kj (claude y codex), el orden en que cada proyecto los prueba, su ritmo y las reglas de rescate. Lee `~/.karajan/accounts.json`, y de `~/.karajan/rescue.json` solo las reglas y si existe una clave. Nombra un proyecto por el último segmento de su ruta en vez de la ruta entera y no lleva nunca una clave: la sección de rescate solo dice si existe una. Cada cambio que haces ahí ejecuta el mismo comando `kj account` que teclearías en una terminal. Mira [Varias cuentas](/docs/es/v4/accounts/).

## Veracidad de las reviews en `kj report`

Un revisor puede citar una línea que no existe. kj lo comprueba sin un modelo. Para cada hallazgo bloqueante mira tres cosas: que el fichero está en el proyecto, que la línea existe en ese fichero y que el código que el hallazgo cita entre backticks está a tres líneas o menos de ella (en cualquier parte del fichero si no cita línea). Un hallazgo fuera del diff también ancla, y uno que no nombra fichero se toma como sobre todo el diff. Un hallazgo que no se sostiene se aparta como **no anclado**. No bloquea. Uno de seguridad o crítico sigue bloqueando aunque no ancle. kj nunca convierte un rechazo en una aprobación.

Cuando ejecutas `kj code --retry`, los hallazgos que se sostienen llegan al coder como la review. Los que no anclan van en una sección aparte, **Not verified**, que dice que no los arregle, porque puede que no estén ahí.

`kj report` imprime entonces un bloque **Cross-AI review truth**, leído de `.karajan/reviews`:

- por revisor: cuántos hallazgos, y cuántos (y qué porcentaje) no se anclaron al código citado;
- rondas de corrección: la media de rechazos antes de una aprobación;
- arbitrajes de Solomon: cuántos, y cuántos dictaminaron approve o reject.

Los rechazos firmados por los gates propios de kj (sonar, rag-first, mutation...) se cuentan en su propia línea, nunca como un revisor ni como una ronda de corrección.

Un rechazo guardado antes de existir esta comprobación no tiene datos de anclaje. Se cuenta aparte como «no medido», nunca como anclado. Un porcentaje alto de no anclados en un revisor es un motivo para mirarlo, no un veredicto sobre él.

## `kj stage`

`kj stage` es una vista en vivo de quién trabaja ahora en tus repos. Lee los ficheros que kj ya escribe en el repo (las denegaciones del Sentinel, el decision log, el gate de commit, las comprobaciones del método, la actividad de los agentes, las cards, los veredictos de review y los traspasos), y su hook nunca bloquea a tu agente. Es una vista: no guarda nada propio.

## OpenTelemetry

kj tiene la base para los spans de OpenTelemetry. **Todavía no envía spans.** El tracer, la parte que los exporta, es el siguiente paso. Lo que existe hoy es la decisión de cuándo se quiere un span y qué puede llevar:

- **Opt-in.** Solo está activo cuando `OTEL_EXPORTER_OTLP_ENDPOINT` está definida. `OTEL_SDK_DISABLED=true` lo desactiva incluso entonces. Sin ninguna de las dos, no se importa nada, no se abre ningún socket y no se escribe ningún fichero.
- **Lista de atributos permitidos.** Un span solo puede llevar `kj.card`, `kj.role`, `kj.outcome`, `kj.provider`, `kj.model`, `kj.duration_ms`, `kj.tokens_in`, `kj.tokens_out` y `kj.cost_usd`. Un valor de texto de más de 200 caracteres se descarta. Los prompts, el código y las claves no están en la lista.
- **Preview.** `kj telemetry preview` imprime el span exacto que llevaría una llamada de rol y si OpenTelemetry está activado o no. Nunca abre un socket. `kj telemetry status` es otro interruptor: dice si la telemetría anónima de uso de kj está activada o no.

## Lo que viene

Una sección **Observability** en el HU Board (ADR 0068), construida sobre estos mismos registros. La página aún no está construida; sus primeros agregadores (`src/observe/`) sí.

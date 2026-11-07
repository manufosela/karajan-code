---
title: Trabaja con tu agente
description: El modelo v4, tú encargas, el agente orquesta, Karajan gobierna.
---

La cadena en v4 es: **tú → tu agente → kj → git**. Tú describes resultados; tu agente (cualquier CLI: Claude Code, Codex, Gemini, Cursor) hace el trabajo; kj le da método, memoria y un segundo par de ojos; git rechaza lo que no venga verificado.

Casi nunca tecleas `kj` tú. Lo hace tu agente, el playbook que instala `kj env install` se lo ordena.

## Afirmaciones con fuente

**Desde tu agente:** cada hecho firme que tu agente va a publicar, un número en un PR, un "los tests pasan" en un resumen, se contrasta con lo que su propia sesión ejecutó de verdad. Respaldado, sin respaldo, o *desmentido por su propio terminal*, y un hecho que su propio terminal desmiente es una alucinación probada, cazada antes de salir. Lees el PR sabiendo que sus afirmaciones sobrevivieron a esa comprobación.

**Bajo el capó:** `kj claims check` corre el contraste sobre el transcript de la sesión, el transcript ES el registro de fuentes, así que "¿esto pasó de verdad?" es una pregunta con respuesta, no un acto de fe.

## La confianza caduca, el Steward

**Desde tu agente:** el proyecto declara sus garantías ("la suite pasa", "hay una auditoría reciente"), y el **Steward** las re-verifica de forma periódica. La evidencia vieja deja de contar, una garantía caducada se lee como *desconocida*, nunca como verde, y cada rotura aterriza en el board como trabajo PROPUESTO que nada ejecuta sin revisar. Los proyectos se pudren justo cuando nadie mira; esto mira.

**Bajo el capó:** `kj steward sweep` corre la comprobación a demanda, o como una Action programada opcional.

## Qué ordena el playbook

Una tarea está HECHA cuando su enunciado-de-hecho es literalmente cierto, la suite está verde y cada commit lleva veredicto de IA cruzada. Los invariantes:

- **RAG antes de suponer**, `kj rag query` responde preguntas sobre el código; el índice se construye en la instalación y se refresca solo.
- **Card primero, en TU board**, el trabajo se registra antes de empezar en el board que el proyecto declare (`state_backend` en config): el HU Board de kj (`kj hu add|move|list`, tu agente crea la card antes de codificar), tu Planning Game, o el board que ya uses, Linear, Trello, Jira, GitHub Issues, trabajado con los MCP/tools de tu propio agente (`state_backend: external` + `board.name`; kj jamás lo espeja). `kj env install` verifica que el board es alcanzable, Karajan no funciona sin uno. Las decisiones de arquitectura viven como ADRs trackeados en git: `kj adr add|list`.
- **Un equipo en el mismo repo**: `kj hu backend github` activa una vez el HU Board compartido. Escribe `.karajan/board.yml`, que subes en una PR para que todos los clones lo hereden. Desde ahí cada HU es una issue de GitHub: su id es `HU-<número de issue>`, así que dos personas nunca crean el mismo; `kj hu move <id> running` te la asigna (el asignado es la reserva) y mover una HU en marcha que lleva otra persona necesita `--release`. Cada clon declara su usuario de GitHub con `kj identity set`. Sin `board.yml`, kj sigue con el board local.
- **Trabajo paralelo en carriles**, ¿más de una tarea a la vez? `kj worktree start <slug>` da a cada una su worktree aislado; cada veredicto de review queda estampado con el workspace desde el que corrió, así las afirmaciones de aislamiento son auditables.
- **Los tests prueban el comportamiento**, test que falla primero, suite nunca en rojo.
- **Revisión cruzada antes del commit**, una IA *distinta* revisa cada diff.
- **Los hallazgos de seguridad no los anula nadie.**
- **Rama primero**, la rama base solo se mueve por PR.

## Las herramientas de tu agente

- **`kj brief <rol>`**, el método destilado de un rol (triage, planner, researcher, architect, tester, security, audit) como misión + invariantes + entregable. Tu agente absorbe esos roles; los briefs lo mantienen honesto.
- **`kj agent run <agente> "<tarea>"`**, delega trabajo a otra IA. kj pone la fontanería de subprocess; tu agente lee la salida y decide.
- **`kj solomon --position "<por qué>"`**, cuando tu agente discrepa de una revisión rechazada, arbitra una **tercera** IA (nunca el brain, nunca el reviewer). Su fallo queda registrado y se obedece, salvo los hallazgos de seguridad, que no anula nadie.
- **`kj report-issue`**, ¿tu agente choca con un bug de kj? Lo diagnostica y abre una issue **sanitizada** upstream (sin código del proyecto, sin rutas, sin datos personales), tras pedírtelo. El ecosistema se repara solo.

## Tu agente orquesta, kj code escribe

La conversación de tu agente no para de crecer, y cada turno la vuelve a leer entera con su modelo más alto. Escribir ahí todas las cards cuesta más de lo necesario: la mayoría no necesita el modelo más alto y ninguna necesita la conversación entera. Por eso el trabajo se reparte, como lo repartía `kj run` antes de la 5.0:

1. **Planifica con nivel.** Mientras planifica, tu agente juzga cuánto modelo necesita cada card y lo dice al crearla: `kj hu add "<card>" --tier trivial|standard|deep --tier-reason "<por qué>"`. kj lo cruza con su propia señal: gana el más alto, y todo lo que toca auth, secretos, migraciones o el Sentinel es siempre `deep`. El nivel vive en la card (una etiqueta `kj:tier:<nivel>` en el board compartido de GitHub), así que cualquiera puede cambiarlo ahí. `kj hu tier <id>` lo lee.
2. **La escribe kj code.** `kj code --card <id> --brief` lanza el coder de tu panel con contexto limpio y el modelo del nivel de la card: con Claude, haiku para `trivial`, sonnet para `standard` y el modelo de siempre para `deep`. `--brief` le devuelve a tu agente solo el final de la respuesta del coder, para que su contexto no crezca. Un modelo que elijas tú siempre manda.
3. **La review la juzga, y un rechazo sube de modelo.** Tu agente pasa `kj review --staged` como siempre. Si la review la rechaza, `kj code --card <id> --retry --brief` le da al coder los hallazgos de esa review, con el modelo más capaz.

La primera vez que tu agente va a escribir él el código de una card planificada, el Sentinel le para una vez con el comando (ver [la guía del Sentinel](/docs/es/guides/sentinel/#delegate)). Puede escribirla igualmente: un segundo intento pasa y la decisión queda anotada.

## Por qué revisa una IA distinta

La auto-revisión sella en falso. En v4 el reviewer es siempre una familia de modelos distinta del orquestador (Claude orquesta → Codex revisa, y viceversa), y su veredicto se liga al sha256 del diff exacto: cambia un byte y el veredicto caduca. No es una convención, lo fuerza el gate de pre-commit. En el desarrollo de este mismo repo, el reviewer cruzado ha rechazado varias veces la primera versión del autor con hallazgos reales. Funciona con nosotros; funcionará contigo.

---
title: Referencia de comandos
description: Todos los comandos vivos de kj, agrupados como los agrupa kj advanced.
---

Los comandos que usa un setup v4. Todo soporta `--help`; los comandos para agentes ofrecen `--json` (stdout = exactamente un objeto JSON). Las tres primeras secciones son por donde empezar; las siguientes listan el resto de comandos, en los mismos grupos que `kj advanced`. Para trabajar sin que kj estorbe, ver [Trabajar sin kj](/docs/es/guides/working-without-kj/).

Un **acto humano** lo teclea una persona en su propia terminal; kj lo rechaza si viene de un agente. Van marcados como tales.

## Setup (una vez por proyecto, humano o su agente)

| Comando | Hace |
|---|---|
| `kj init` | Config + reglas + tooling de calidad. Seguro para agentes: sin TTY cae a defaults, resumen `--json`. |
| `kj start [tarea]` | Punto de entrada único: evalúa el proyecto y recomienda el siguiente paso (`--maturity new\|existing\|legacy`, `--yes` no aplica nada, `--json`). |
| `kj go` | Arranca Karajan desde cero: detecta tu agente, prepara el proyecto, abre el tablero y te deja en la conversación (`--window` mantiene la conversación dentro del tablero del navegador). |
| `kj bootstrap` | Del directorio vacío al método listo: repositorio, configuración, harness, gate y RAG, en el orden que funciona. |
| `kj update` | Actualiza karajan-code a la última versión de npm. |
| `kj env install` | Instala o refresca el playbook del método en AGENTS.md, el único fichero que leen todos los agentes anfitrión (`--target`), construye el índice RAG (`--no-rag`) e instala los git hooks y el gate de veredictos (`--no-enforce` los omite). Sale con 3 si el RAG no puede indexar: hay una acción pendiente tuya. |
| `kj harden` | Hooks de git (lint, política de commits, runner del gate), configs, workflows de CI. Encadena tus hooks globales previos. `kj harden --commit` es un acto humano: lo teclea una persona en su propia terminal; kj lo rechaza si viene de un agente. |
| `kj review --install-gate` | Declara el gate de revisión en pre-commit (`.karajan/review-gate`, para commitear). Solo se aplica si lo ejecuta el hook pre-commit de `kj harden`; si no, lo dice y sale con 1. |

## Diario (lo ejecuta el agente)

| Comando | Hace |
|---|---|
| `kj hu add\|move\|list` | El [HU Board](/docs/es/guides/hu-board/) desde cualquier agente anfitrión, primero la card. `add "<título>"` pone el trabajo en el tablero (`--tier trivial\|standard\|deep`, `--ac`, `--ref`), `move <id> <estado>` lo mueve (pending, running, done, failed, skipped), `list` lo muestra. |
| `kj code --card <id> --brief` | Hace que escriba la card el coder declarado en tu panel, con contexto limpio. `--brief` devuelve solo el final de la respuesta del coder; `--retry`, tras una revisión rechazada, le da sus hallazgos y usa el modelo más capaz. Si el coder quitó una aserción de un test existente, falla, lista cada aserción quitada y pide restaurarla y `--retry`. |
| `kj handoff` | Lo que un gate le negó al agente, o lo que solo puede hacer el humano, registrado para que el humano lo ejecute por id: `add`, `list`, `show`, `done`, `wait`, `watch`. |
| `kj rag query "<q>"` | Búsqueda semántica sobre el proyecto (se refresca sola con el drift). |
| `kj brief <rol>` | Misión + invariantes + entregable de un rol. Sin rol → lista. |
| `kj review --staged` | Primero los pre-gates deterministas, en este orden: card primero, Steward, tamaño de PR, privacidad, tests con el código, policy, Sonar sobre los ficheros cambiados (BLOCKER/CRITICAL rechazan), RAG, mutación si está declarada, los ficheros de test del propio diff, cooldown. El primer rechazo la termina sin modelo. Después la revisión cruzada: un diff mayor que un prompt del revisor se revisa entero, en lotes de ficheros completos, aprobado solo si lo está cada lote, y un fichero demasiado grande para un prompt rechaza el veredicto. Veredicto ligado al sha256 del diff y estampado con su workspace. Exit 0/1. |
| `kj worktree start\|list\|done <slug>` | Carriles de tarea aislados: worktree + rama `feat/<slug>` + bootstrap de dependencias; `start --base <rama>` saca el carril de `origin/<rama>` (por ejemplo, una rama de épica) y la guarda como base del carril para `pr-size`, `check` y la puerta de revisión; `done` desmonta un carril mergeado. `list --json` da los commits por delante de la base de cada carril y las cards que nombra su rama (por ID o referencia); `--prs` añade la PR de cada carril (una sola llamada a `gh`). El HU Board los muestra en cada card. |
| `kj review --check` | ¿Hay veredicto approved para el diff staged exacto? (Lo que ejecuta el hook.) |
| `kj review --range <a..b>` / `--lane <slug>` | Revisa un rango git en vez del diff staged / ejecuta el gate en ese carril desde cualquier directorio. |
| `kj review --publish-pr <n>` / `--verify-pr <n>` | Publica los veredictos de los commits de una PR en ella como una review de GitHub / el check de CI: cada commit de la PR aparece, con el hash de su diff, en la kj review que publicó un miembro. |
| `kj review --third-party` | Revisa la PR de otro (`--range base...head`): solo revisor, sin los gates del trabajo propio y sin guardar veredicto (`--lens qa`, `--verifier`, `--reviewers`, `--json`). |
| `kj solomon --position "<por qué>"` | Arbitraje de tercera IA sobre un veredicto rechazado. Exit 0 approve / 1 reject. |
| `kj solomon --finding <id> --position "<por qué>"` | Arbitra un solo hallazgo del veredicto. Si lo aprueba, lo quita; el gate solo se abre cuando no queda ninguno. Un hallazgo de seguridad nunca se arbitra. |
| `kj agent run <agente> "<tarea>"` | Delega una tarea a otra IA e imprime su salida. |
| `kj report-issue --title "<t>"` | Reporta un bug de kj upstream, sanitizado. Nunca publica sin `--publish`. |

## Inspección (humano)

| Comando | Hace |
|---|---|
| `kj check` | Verifica el harness de calidad que instaló `kj harden` (gate de deriva). |
| `kj doctor` | Comprueba los requisitos del entorno y arregla lo que puede (`--check-only`, `--json`). |
| `kj report` | Resumen de la última sesión: presupuesto, iteraciones. |
| `kj board` | Dashboard del HU Board. No arranca si el tablero es externo (`state_backend: external`) o si `hu_board.enabled` es false, salvo con `--force`. |

## Agentes y revisión

| Comando | Hace |
|---|---|
| `kj code` | Hace que escriba la tarea el coder declarado en tu panel (`--agent`, `--card`, `--brief`, `--retry`). |
| `kj solomon` | Una tercera IA arbitra un veredicto de revisión rechazado (`--position`, `--finding`, `--range`). Cerebro, revisor y Solomon son tres IAs distintas. |
| `kj agent run <agente> <tarea>` | Delega una tarea a otro agente de IA e imprime su salida. Exit 0/1. |
| `kj scan` | Ejecuta un análisis de SonarQube. |
| `kj tournament` | Reparte la misma tarea entre N coders (`--coders`) en carriles aislados y recoge el diff, la suite y el log de cada carril. `--score`, `--judge` y `--crown` puntúan, ordenan y commitean al ganador a través del gate de revisión. |

## Análisis

| Comando | Hace |
|---|---|
| `kj discover [tarea]` | Analiza una tarea en busca de huecos, ambigüedades e información que falta (`--mode gaps\|momtest\|wendel\|classify\|jtbd`). |
| `kj spec refine` | Propone una spec detallada, y sus tests e2e, a partir de una de alto nivel, para aceptarla antes del plan. Nunca sobrescribe la salida. |
| `kj onboard` | Analiza un código existente y produce un Architecture Brief. |
| `kj brief [rol]` | Muestra el método destilado de un rol: triage, planner, researcher, architect, tester, security, board o audit. Sin rol, los lista. |
| `kj plan` | Gestión de planes: `list`, `show`, `ready`, `validate`, `delete`, `share`, `unshare`, `add-hu`, `remove-hu`, `license`, `fix`, `migrate-result`. |

## Búsqueda / RAG

| Comando | Hace |
|---|---|
| `kj rag` | Búsqueda semántica sobre planes, briefs de onboarding y código del proyecto: `index`, `query`, `covers <fichero>`, `migrate`, `install-hooks`, `eval`, `mcp`. |
| `kj qmd query <texto>` | Búsqueda semántica sobre la wiki QMD del proyecto (`docs/`, `.reviews/`, `.karajan/plans/`); `--scope docs\|reviews\|plans`. |
| `kj watch start\|stop\|status` | Un demonio que reindexa el RAG a medida que cambian los ficheros (`--with-sources`, `--foreground`). |
| `kj doc index\|section` | Lee un fichero markdown por sus encabezados: `index` los lista, `section <fichero> <encabezado>` imprime una sección entera. |

## Calidad / auditoría

Para ver cómo usan esto los gates, [Gates](/docs/es/v4/gates/); para el modelo de reglas, [Gobierno](/docs/es/v4/governance/).

| Comando | Hace |
|---|---|
| `kj audit [tarea]` | Análisis de salud del código; nunca cambia tu código (cada ejecución se guarda en `.karajan/audit-history.db`). `--deterministic-only` no gasta tokens; `--security` es una pasada de seguridad sin tokens; `--sbom <fichero>` escribe el SBOM CycloneDX. |
| `kj check` | Verifica el harness de calidad que instaló `kj harden` (gate de deriva). |
| `kj mutate [ruta]` | Mutation testing acotado a tu diff (`--since`, `--max-survivors`): ¿cazan tus tests los mutantes de tu cambio? |
| `kj webperf <url>` | Análisis Lighthouse de una URL: Core Web Vitals y oportunidades (`--mobile`). |
| `kj sonar status\|start\|stop\|logs\|open` | Gestiona el contenedor de SonarQube. |
| `kj privacy scan [rutas...]` | Busca datos personales en ficheros, en el diff staged (`--staged`) o en un rango (`--range`), siempre enmascarados en la salida. Un acierto de la denylist sale con 1; el PII genérico avisa. |
| `kj release` | Ceremonia de release: `check`, `propose <versión>`, `status <issue>`, `ack <issue> ok\|hold\|include`, `verify <tag>` (el gate de CI). `kj release approve <issue>` es un acto humano: lo teclea una persona en su propia terminal; kj lo rechaza si viene de un agente. |
| `kj policy eval\|check\|grant\|report\|anchor\|add\|seal` | Política como código en `.karajan/policy.yml`. `eval` y `check` son deterministas (`--strict` sale con 2 en deny); `grant` da una excepción no de seguridad con caducidad; `add` traduce una regla hablada al vocabulario de la política y solo escribe con `--yes`; `anchor` sella el hash de cabeza del decision log; `report` resume el log y las concesiones; `seal` lo invoca el Sentinel. |
| `kj rules list\|eval\|test\|check\|compile\|decide\|review\|approve\|coverage` | Las reglas escritas en tus ficheros MD, compiladas en `.karajan/rules.yml`. `review` hace que otra IA revise una propuesta; `coverage` muestra el gate de cada regla. `kj rules approve` es un acto humano: lo teclea una persona en su propia terminal; kj lo rechaza si viene de un agente. |
| `kj rulesync adopt\|release <clave>` | El libro de propiedad de `.rulesync/`: `adopt` toma el contenido actual de una entrada como de kj, `release` te la entrega y kj deja de escribirla. |
| `kj claims check\|gate` | Cruza los datos que la IA afirma en un turno con las salidas de ese turno. Sale con 2 solo si un dato lo desmiente su propia fuente. |
| `kj continuation gate` | Lo invoca el hook de parada: el turno no termina mientras queden cards de la sesión, salvo por un motivo que kj pueda comprobar (`method_gates.continuation`: block, warn u off). |
| `kj steward sweep\|bench` | El Steward gobierna el estado del proyecto: `sweep` es un barrido de solo lectura de los invariantes y deja un informe versionado; `bench` corre un detector commit a commit sobre un rango. |
| `kj pr-size` | Líneas que añade la rama frente a su base, con el presupuesto de CI (`--limit` sale con 1 si lo supera). |
| `kj main-guard` | Audita un push a la rama protegida: merges sin sus checks requeridos, y la protección. Sale con 1 y un informe markdown. |
| `kj main-guard-except <pr>` | Un acto humano: lo teclea una persona en su propia terminal; kj lo rechaza si viene de un agente. Firma en el móvil una excepción para una PR mergeada sin sus checks requeridos (`--why`). La lee `kj main-guard`; `kj harden` no instala ningún workflow que lo ejecute. Mira [un sello en una pull request](/docs/es/guides/sentinel/#un-sello-en-una-pull-request). |
| `kj merge-gate` | Si un comando `gh pr merge` puede ejecutarse ahora: sale con 2, con el motivo, mientras los checks de la PR corren o están en rojo. |
| `kj gates [value <regla>\|set <regla> <valor>]` | Lista las reglas con las que kj gobierna, cada una ajustable con su valor y quién lo fijó; `value` imprime un valor resuelto (para los hooks); `set` cambia una ajustable: endurecerla es libre, aflojarla es un acto humano (lo teclea una persona en su propia terminal; kj lo rechaza si viene de un agente). Con `--from-contributing "<frase>"` el valor lo justifica esa frase exacta del CONTRIBUTING del proyecto, sin acto humano. Las reglas fijas no cambian nunca. |
| `kj hooks [set <paso> <comando>\|unset <paso>]` | Lista el comando que ejecuta cada paso de los hooks y de dónde viene; `set` fija uno, `unset` lo libera. `set` y `unset` son actos humanos: los teclea una persona en su propia terminal; kj los rechaza si vienen de un agente. Los hooks solo cambian tras `kj harden` y su sello. |

## Sesión / board

| Comando | Hace |
|---|---|
| `kj report` | Muestra el último informe de sesión (`--list`, `--session-id`, `--trace`, `--format`). |
| `kj board start\|stop\|status\|open\|cleanup` | El [HU Board](/docs/es/guides/hu-board/). Sin acción arranca un servidor persistente en segundo plano. |
| `kj hu add\|adopt\|tier\|move\|start\|list\|migrate\|backend` | Cards desde cualquier agente anfitrión. `start <id>` abre el carril y mueve la card a running; `adopt <número>` convierte una issue de GitHub en card; `backend github\|linear\|local` enciende el tablero. |
| `kj stage` | Abre el escenario 3D en vivo del proyecto: lo que hacen el Sentinel, `kj review` y el Ledger, mientras ocurre. |
| `kj adr add\|list` | Registros de decisiones de arquitectura en `.karajan/adrs/`, versionados en git. |
| `kj worktree start\|list\|note\|done\|prune` | Carriles de tarea aislados. `note` deja una nota breve en un carril; `prune` retira los carriles demostrablemente abandonados (`--dry-run`). |
| `kj sentinel status\|verify\|hook\|panel-check\|board-gate` | El [Sentinel](/docs/es/guides/sentinel/): el supervisor determinista del método, enganchado a los hooks del harness. `status` imprime los hechos de la sesión, `verify` comprueba los scripts del harness contra el kj instalado. |
| `kj identity show\|set\|enroll-phone\|phone-invite` | Con qué cuenta de gh y email de git se trabaja este clon. `kj identity enroll-phone` es un acto humano: lo teclea una persona en su propia terminal; kj lo rechaza si viene de un agente. |
| `kj security show\|max\|critical\|normal` | El nivel de seguridad del proyecto. `max` no necesita firma. `critical` y `normal` son actos humanos: los teclea una persona en su propia terminal; kj los rechaza si vienen de un agente. Con un móvil enrolado, los firma el móvil; sin ninguno, el nivel queda registrado sin firma y vuelve a valer `max` en cuanto se enrola un móvil. |
| `kj handoff add\|list\|show\|done\|wait\|watch` | Traspasos: `add` registra un comando denegado, o con `--why` una acción que solo puede hacer el humano; `wait <id>` bloquea hasta que se hace (exit 0) o vence el tiempo (exit 2); `watch` es la ventana de tareas del humano. |
| `kj link send\|inbox\|threads\|limits\|ceremony` | Enlace entre agentes: publica en `issue:<n>` o `pr:<n>`, o lee lo que ha llegado (a demanda, nunca empujado). `ceremony convene\|gather\|close` convoca una daily, refinement o retro, recoge lo dicho, o escribe su resultado como pull request y la cierra. |

## Infra / setup

| Comando | Hace |
|---|---|
| `kj install-tools` | Instala las herramientas que kj necesita (git, CLIs de agentes) y las de auditoría externas (semgrep, osv-scanner, lighthouse, docker, sonar) con tu gestor de paquetes (`--only`, `--yes`, `--dry-run`). |
| `kj ollama start\|stop\|status\|pull <modelo>` | Gestiona el contenedor del embedder del RAG (Ollama en Docker). |
| `kj skills` | Gestiona la caché de skills (`list`, `clear-cache`, `sync-addyosmani`, `list-addyosmani`) y el almacén `.karajan`: `search` (propio de kj, traduce primero una consulta que no está en inglés) y, a través de atril, `route`, `scan`, `install`, `remove`, `graph`, `enrich`, `config`. |
| `kj atril` | Ejecuta la CLI propia de atril sobre el almacén `.karajan`; todos los argumentos van a atril sin tocar. |
| `kj roles [show <rol>]` | Lista los roles del pipeline; `show <rol>` imprime las instrucciones de la plantilla de un rol. |
| `kj agents [list\|set <rol> <proveedor>]` | Lista o cambia el agente de IA de cada rol (`--local`, `--global`). |
| `kj account add\|list\|remove\|default\|use\|check\|pace\|rescue` | Cuentas de agentes: el login con el que corren los agentes de cada proveedor. Ver [Cuentas](/docs/es/v4/accounts/). |
| `kj env install` | Instala o refresca en AGENTS.md el playbook para agentes anfitrión, y los git hooks y el gate de veredictos (`--no-enforce` los omite). |
| `kj init` | Config, reglas de revisión y SonarQube. Se ejecuta una vez por proyecto. |
| `kj config` | Muestra la config actual (`--json`, `--edit`, `--check-secrets <fichero>`). |

## Mantenimiento

| Comando | Hace |
|---|---|
| `kj clean` | Recoge planes, sesiones y lotes de HU caducados. Es un simulacro salvo que pases `--yes`. |
| `kj sync` | Detecta deriva entre el código y el último plan. Solo lectura; `--apply` escribe el informe de vuelta en el Canvas. |
| `kj telemetry preview\|status` | Muestra exactamente qué envía la telemetría y si está activada. Nunca abre un socket. |
| `kj report-issue` | Reporta un bug o fricción de kj al repo público, sanitizado. Publicar exige `--publish`. |

## Retirados en la 5.0

`kj run`, `kj autorun`, `kj resume`, `kj standby`, `kj plan generate`, `kj status`, `kj undo`, `kj triage`, `kj researcher`, `kj architect` y `kj review "<tarea>"` movían el antiguo pipeline de subprocesos y se retiraron con él: responden con un aviso y no arrancan nada. Qué sustituye a cada uno: [Migrar a la 5.0](/docs/es/v4/migration/). Para CI y scripts, ver [Ejecuciones desatendidas](/docs/es/v4/headless/).

`kj advanced` lista los comandos por grupos, como arriba. El pipeline antiguo está documentado en el **archivo histórico V3** ([aquí](/docs/es/getting-started/introduction/)).

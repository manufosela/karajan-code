---
title: Trabaja con tu agente
description: El modelo v4 — tú encargas, el agente orquesta, Karajan gobierna.
---

La cadena en v4 es: **tú → tu agente → kj → git**. Tú describes resultados; tu agente (cualquier CLI: Claude Code, Codex, Gemini, Cursor) hace el trabajo; kj le da método, memoria y un segundo par de ojos; git rechaza lo que no venga verificado.

Casi nunca tecleas `kj` tú. Lo hace tu agente — el playbook que instala `kj env install` se lo ordena.

## Qué ordena el playbook

Una tarea está HECHA cuando su enunciado-de-hecho es literalmente cierto, la suite está verde y cada commit lleva veredicto de IA cruzada. Los invariantes:

- **RAG antes de suponer** — `kj rag query` responde preguntas sobre el código; el índice se construye en la instalación y se refresca solo.
- **Card primero, en TU board** — el trabajo se registra antes de empezar en el board que el proyecto declare (`state_backend` en config): el HU Board de kj (`kj hu add|move|list` — tu agente crea la card antes de codificar), tu Planning Game, o el board que ya uses — Linear, Trello, Jira, GitHub Issues — trabajado con los MCP/tools de tu propio agente (`state_backend: external` + `board.name`; kj jamás lo espeja). `kj env install` verifica que el board es alcanzable — Karajan no funciona sin uno. Las decisiones de arquitectura viven como ADRs trackeados en git: `kj adr add|list`.
- **Trabajo paralelo en carriles** — ¿más de una tarea a la vez? `kj worktree start <slug>` da a cada una su worktree aislado; cada veredicto de review queda estampado con el workspace desde el que corrió, así las afirmaciones de aislamiento son auditables.
- **Los tests prueban el comportamiento** — test que falla primero, suite nunca en rojo.
- **Revisión cruzada antes del commit** — una IA *distinta* revisa cada diff.
- **Los hallazgos de seguridad no los anula nadie.**
- **Rama primero** — la rama base solo se mueve por PR.

## Las herramientas de tu agente

- **`kj brief <rol>`** — el método destilado de un rol (triage, planner, researcher, architect, tester, security, audit) como misión + invariantes + entregable. Tu agente absorbe esos roles; los briefs lo mantienen honesto.
- **`kj agent run <agente> "<tarea>"`** — delega trabajo a otra IA. kj pone la fontanería de subprocess; tu agente lee la salida y decide.
- **`kj solomon --position "<por qué>"`** — cuando tu agente discrepa de una revisión rechazada, arbitra una **tercera** IA (nunca el brain, nunca el reviewer). Su fallo queda registrado y se obedece — salvo los hallazgos de seguridad, que no anula nadie.
- **`kj report-issue`** — ¿tu agente choca con un bug de kj? Lo diagnostica y abre una issue **sanitizada** upstream (sin código del proyecto, sin rutas, sin datos personales), tras pedírtelo. El ecosistema se repara solo.

## Por qué revisa una IA distinta

La auto-revisión sella en falso. En v4 el reviewer es siempre una familia de modelos distinta del orquestador (Claude orquesta → Codex revisa, y viceversa), y su veredicto se liga al sha256 del diff exacto: cambia un byte y el veredicto caduca. No es una convención — lo fuerza el gate de pre-commit. En el desarrollo de este mismo repo, el reviewer cruzado ha rechazado varias veces la primera versión del autor con hallazgos reales. Funciona con nosotros; funcionará contigo.

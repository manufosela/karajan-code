---
title: Lo que kj instala en tu agente
description: Las reglas, la skill, los hooks y el RAG que kj le da a tu agente. Qué son, por qué existen, cuándo actúan, cómo se usan y qué no hacen.
---

## Qué es

Tu agente (Claude Code, Codex, Gemini CLI) no es parte de kj, pero kj le da lo que necesita para seguir el método:

| Qué | Dónde | Para qué agente |
|---|---|---|
| **Las reglas del método** | Un bloque que gestiona kj dentro de `AGENTS.md` | Lo leen todos. kj ya no escribe `CLAUDE.md` ni `GEMINI.md`. |
| **La skill working-with-karajan** | `.claude/skills/working-with-karajan/SKILL.md` | Claude Code. Cómo seguir cuando un gate lo para. |
| **Los hooks del Sentinel** | `.claude/settings.local.json`, personal y fuera de git | Claude Code. Mira [el Sentinel](/docs/es/pieces/sentinel/). |
| **El RAG del proyecto como herramienta** | Tu configuración personal de Claude Code | Claude Code. Mira [el RAG](/docs/es/pieces/rag/). |
| **Skills a demanda** | `kj skills search`, `kj skills install` | Busca en el catálogo de skills y las instala en el proyecto. |

## Por qué existe

Un agente empieza cada sesión sin saber nada del método de tu proyecto. Si tiene que aprenderlo de ti cada vez, lo aprende distinto cada vez. kj escribe el método donde el agente lo busca, y pone los controles donde el agente no puede saltárselos.

Las reglas y la skill le dicen al agente qué hacer. Los hooks y los gates comprueban que lo ha hecho. Hacen falta las dos cosas: las reglas solas se olvidan, y los controles solos parecen arbitrarios.

## Cuándo actúa

- `kj env install` prepara el entorno: las reglas en `AGENTS.md`, el servidor del RAG, el control (`kj harden`: hooks de git, el gate de revisión, el Sentinel) y el índice del RAG si no hay ninguno.
- `kj harden` instala la skill y los hooks del Sentinel, y los mantiene al día cuando cambia kj. Si alguien edita los hooks a mano, el Sentinel lo nota y bloquea hasta que `kj harden` los restaura.
- A partir de ahí, el agente lee `AGENTS.md` al empezar cada sesión, y el Sentinel le devuelve las reglas tras una compactación.

## Cómo se usa

Ejecuta `kj env install` una vez en el proyecto. Con `--no-enforce` deja fuera los gates y con `--no-rag` el índice. Cuando kj anuncia una versión nueva, el agente te cuenta qué trae; actualizar lo decides tú.

El bloque que gestiona kj en `AGENTS.md` es de kj: edita fuera de él y kj respeta tu parte. Una copia de la skill sin la marca de kj también es tuya, y kj no la toca.

## Qué no hace

- **No instala tu agente** ni inicia tu sesión en él.
- **No les da el Sentinel a Codex ni a Gemini CLI.** Reciben las reglas en `AGENTS.md`; los hooks de git y el CI se aplican a todos.
- **No conecta tu agente en la configuración compartida.** Los hooks y el RAG van en tu configuración personal, para que un compañero que usa Claude Code sin kj no quede bloqueado.

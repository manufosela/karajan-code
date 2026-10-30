---
title: Ejecuciones desatendidas
description: Karajan en CI y en scripts, sin una sesión de agente al volante.
---

Hasta la 4.x, Karajan tenía también un **modo headless**: `kj run` y `kj autorun` lanzaban coder, revisor y juez como subprocesos y llevaban el bucle ellos mismos. Ese pipeline se retiró en la 5.0 (ver [Migrar a la 5.0](/docs/es/v4/migration/)): el trabajo lo hace tu agente y Karajan lo gobierna.

Lo que se queda para el uso desatendido:

- **`--non-interactive`** (o `KJ_NON_INTERACTIVE=1`): los gates seguros se responden solos (los warn continúan y la decisión va a stderr); los FAIL paran con código 1 en vez de esperar una respuesta.
- **Los gates en CI**: `kj harden` siembra los workflows que vuelven a comprobar cada PR (veredictos de revisión, política, privacidad, tamaño de la PR), así que un hook local manipulado no cuela un diff.
- **Trabajo en paralelo**: un carril por card con `kj worktree start <slug>` y una sesión del agente dentro de cada uno. `session.worktree_setup` sigue declarando el entorno de cada carril (puertos, BDs, nombres de proyecto docker) para que no choquen.

## Cuándo usar cada uno

| Situación | Usa |
|---|---|
| Trabajas CON un agente (Claude Code, Codex, Gemini, OpenCode) | El entorno: es lo normal |
| Varias cards independientes a la vez | Un carril por card (`kj worktree start`), una sesión del agente por carril |
| CI sin ningún agente | Los gates: `kj review --check`, `kj policy check`, `kj privacy scan` |

## El pipeline antiguo

El pipeline de subprocesos está documentado en la sección **v3 (archivo histórico)** de este sitio. Describe cómo funcionaba Karajan antes de la 5.0; para seguir usándolo, quédate en `karajan-code@4`.

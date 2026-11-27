---
title: El ledger
description: El registro de hechos de la sesión, que los gates leen en vez de fiarse de la palabra del agente. Qué es, por qué existe, cuándo actúa, cómo se usa y qué no hace.
---

## Qué es

El ledger es un fichero de tu máquina, `.karajan/harness/sentinel-state.json`, donde el [Sentinel](/docs/es/pieces/sentinel/) apunta lo que ha hecho cada sesión de tu agente. Se escribe después de cada llamada a una herramienta, desde el hook que corre cuando la llamada ya ha terminado. Se guarda por sesión, y por carril cuando la sesión trabaja en un worktree.

Apunta hechos, no opiniones:

- Las consultas al RAG que ha hecho la sesión, y los ficheros que devolvió cada una.
- Los ficheros de código y los de test que ha editado la sesión.
- Las cards cuya pull request se ha mergeado y aún no se han movido en el board, y las cards que ha cerrado.
- Si cada fichero estaba limpio o ya tenía cambios cuando la sesión lo tocó por primera vez.
- Cuántas veces seguidas se ha bloqueado el fin de turno, y cuándo se apartó el Sentinel.

## Por qué existe

Los gates necesitan saber qué ha pasado en la sesión. La única otra fuente es el agente, y el agente dice lo que cree: "he consultado el RAG", "he añadido tests". El ledger lo escribe un hook, a partir de lo que han hecho de verdad las herramientas, así que un gate puede comprobar un hecho en vez de fiarse de una frase.

## Cuándo actúa

Se escribe después de cada llamada y nunca bloquea ninguna. Lo leen varias comprobaciones:

| Quién lo lee | Para qué |
|---|---|
| El control del RAG, antes de una edición | El fichero que se edita (o uno de su directorio) ha salido en alguna consulta de la sesión. |
| El control de descartes, antes de un comando `git` | Un fichero que ya tenía cambios antes de que la sesión lo tocara puede ser trabajo tuyo: no se descarta. |
| El control del board | Una card mergeada hay que moverla antes de que la sesión siga. |
| El fin de turno | Código editado en la rama base o sin tocar ningún test, cards sin mover, la cuenta de bloqueos seguidos. |
| `kj review` | Cada fichero de código del diff tiene respuesta de alguna consulta al RAG. Los ficheros que devolvieron esas consultas y que el diff no toca le llegan al revisor por su nombre: la misma idea puede vivir también ahí. |

Para `kj review`, en un carril cuentan juntas las consultas de todas las sesiones de ese carril (un carril es una card). En el árbol principal solo cuenta la sesión más reciente, para que una tarea nueva no se apoye en consultas hechas hace días para otra.

## Cómo se usa

No lo escribes tú, y el agente tampoco: los ficheros de `.karajan/harness/` son del supervisor, y el Sentinel bloquea cualquier edición sobre ellos desde la sesión.

- `kj sentinel status`: muestra lo que guarda el ledger de la sesión y cualquier violación por la que el fin de turno bloquearía.
- Si `kj review` ve que los hooks del disco no son los que escribe tu kj instalado, no se fía del ledger y rechaza hasta que vuelvas a ejecutar `kj harden`.

## Qué no hace

- **No es el registro de auditoría.** Es estado de trabajo, local y nunca se commitea (kj lo deja fuera de git). El registro de lo que han decidido los gates es el decision log, `.karajan/policy-decisions.jsonl`, encadenado por hash para que se note si la cadena se rompe.
- **No guarda tu código ni tus prompts.** Guarda rutas de ficheros, ids de cards, contadores y los primeros 200 caracteres de cada consulta al RAG.
- **No se comparte.** Cada máquina y cada carril tiene el suyo; la sesión de un compañero no cuenta para la tuya.
- **No existe sin el Sentinel.** Solo lo escriben los hooks del Sentinel, que corren en Claude Code. En un árbol sin el Sentinel instalado, `kj review` dice que no hay ledger que comprobar en vez de suponer uno.

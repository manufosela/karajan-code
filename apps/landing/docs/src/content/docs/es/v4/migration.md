---
title: Migrar a la 5.0
description: Karajan 5.0 retira el pipeline de kj run. Qué sustituye a cada comando retirado.
---

Karajan Code 5.0 retira el pipeline que ejecutaba `kj run`. Ese pipeline era Karajan haciendo de agente: lanzaba un coder, un revisor y un juez como subprocesos y los llevaba por un bucle. Desde la v4 el trabajo lo hace tu propio agente (Claude Code, Codex, OpenCode, Gemini...) y Karajan lo gobierna: qué tiene que ser verdad antes de un commit, un merge o una release, con los gates de git y el Sentinel.

```bash
npm install -g karajan-code@5
```

Si ya trabajas a la manera v4 (tu agente, `kj review --staged`, `kj hu`, `kj worktree`), no cambia nada. Un comando retirado sigue respondiendo: sale con código 1 sin arrancar nada y dice qué lo sustituye. Para conservar el pipeline un tiempo más, quédate en la 4.x: `npm install -g karajan-code@4`.

## Cómo se trabaja ahora

Lo que el pipeline hacía en un comando, ahora lo hace tu agente paso a paso, dentro del método:

1. **Planificar.** El agente parte la tarea con el brief del planificador (`kj brief planner`): pasos de un commit, PRs de unas 150 líneas netas. Cada pieza va al board: `kj hu add "<título>"`.
2. **Aislar.** Un carril por card cuando trabajas en paralelo: `kj worktree start <slug>`, con una sesión del agente dentro.
3. **Escribir, test primero.** Primero el test que falla; la suite nunca se queda en rojo.
4. **Revisión por otra IA.** `kj review --staged` antes de cada commit. El veredicto va atado al diff exacto y el gate de pre-commit lo comprueba. ¿No estás de acuerdo con un rechazo? `kj solomon`.
5. **Mergear y cerrar el carril.** Una PR por card; tras el merge, `kj worktree done <slug>`.
6. **Seguirlo.** `kj board start`: cada card muestra su carril, rama, commits por delante y PR, y la vista de Gobierno lista los carriles fuera del método.

## Comandos retirados

| Retirado | Usa en su lugar |
|---|---|
| `kj run`, `kj autorun` | Tu agente, con los pasos de arriba |
| `kj resume`, `kj standby` | No hay nada que reanudar: la sesión de tu agente es la sesión |
| `kj plan generate` | `kj brief planner` para tu agente, y luego `kj hu add` por cada pieza |
| `kj status` | `kj board start` |
| `kj undo` | git: cada paso revisado es su propio commit |
| `kj triage`, `kj researcher`, `kj architect` | `kj brief triage`, `kj brief researcher`, `kj brief architect`: tu agente aplica el rol |
| `kj review "<tarea>"` (solo revisor) | `kj review --staged` (o `--range base..head`) |

`kj code` se queda: cuando el coder declarado en tu panel no es el agente con el que hablas, `kj code --agent <coder> --card <ref>` hace que escriba ese coder, y la vista de Gobierno registra que se respetó el panel. El resto de `kj plan` (`list`, `show`, `validate`, `approve`) sigue igual.

## Herramientas MCP

Las herramientas MCP que movían el mismo pipeline (`kj_run`, `kj_resume`, `kj_status`, `kj_undo`, `kj_plan` y las de un solo rol) se retiran con sus comandos. Una llamada responde con el mismo aviso. Tu agente trabaja con los comandos de arriba.

## El board

El HU Board ya no lanza ejecuciones: el botón **Run plan** y el ▶ de cada card desaparecen. Las cards, los carriles y la vista de Gobierno funcionan igual.

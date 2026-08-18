---
title: Referencia de comandos
description: La superficie v4 — una línea por comando.
---

Los comandos que un setup v4 usa de verdad. Todo soporta `--help`; los comandos para agentes ofrecen `--json` (stdout = exactamente un objeto JSON).

## Setup (una vez por proyecto, humano o su agente)

| Comando | Hace |
|---|---|
| `kj init` | Config + reglas + tooling de calidad. Seguro para agentes: sin TTY cae a defaults, resumen `--json`. |
| `kj env install` | Escribe el playbook del método en CLAUDE.md / AGENTS.md / GEMINI.md (`--target`) y construye el índice RAG (`--no-rag`). |
| `kj harden` | Hooks de git (lint, política de commits, runner del gate), configs, workflows de CI. Encadena tus hooks globales previos. |
| `kj review --install-gate` | Activa el gate de revisión en pre-commit (marcador trackeado). |

## Diario (lo ejecuta el agente)

| Comando | Hace |
|---|---|
| `kj rag query "<q>"` | Búsqueda semántica sobre el proyecto (se refresca sola con el drift). |
| `kj brief <rol>` | Misión + invariantes + entregable de un rol. Sin rol → lista. |
| `kj review --staged` | Pre-gate de Sonar sobre los ficheros cambiados (BLOCKER/CRITICAL rechazan determinísticamente), después revisión cruzada; veredicto ligado al sha256 del diff y estampado con su workspace. Exit 0/1. |
| `kj worktree start\|list\|done <slug>` | Carriles de tarea aislados: worktree + rama `feat/<slug>` + bootstrap de dependencias; `done` desmonta un carril mergeado. |
| `kj review --check` | ¿Hay veredicto approved para el diff staged exacto? (Lo que ejecuta el hook.) |
| `kj solomon --position "<por qué>"` | Arbitraje de tercera IA sobre un veredicto rechazado. Exit 0 approve / 1 reject. |
| `kj agent run <agente> "<tarea>"` | Delega una tarea a otra IA e imprime su salida. |
| `kj report-issue --title "<t>"` | Reporta un bug de kj upstream, sanitizado. Nunca publica sin `--publish`. |

## Inspección (humano)

| Comando | Hace |
|---|---|
| `kj check` | Salud del entorno, 13 checks. |
| `kj doctor` | Diagnóstico profundo con arreglos. |
| `kj report` | Resumen de la última sesión: presupuesto, iteraciones. |
| `kj board` | Dashboard del HU Board (con `state_backend: hu-board`). |
| `kj gain` | Analítica de ahorro de tokens. |

## Headless

| Comando | Hace |
|---|---|
| `kj run "<tarea>"` | El pipeline subprocess clásico — ver [Modo headless](/docs/es/v4/headless/). `--non-interactive` (o `KJ_NON_INTERACTIVE=1`) auto-responde los gates seguros; los findings FAIL paran con exit 1. |
| `kj autorun <spec>` | Spec → plan → cada historia → informe final, desatendido. |

Todo lo demás (`kj advanced` lista ~30 más) pertenece al pipeline headless y usuarios avanzados — documentado en el **archivo histórico V3** ([aquí](/docs/es/getting-started/introduction/), claramente marcado como legacy).

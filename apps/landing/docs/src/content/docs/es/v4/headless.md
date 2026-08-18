---
title: Modo headless
description: El pipeline subprocess clásico — para runs desatendidos, bajo los mismos gates.
---

Antes de la v4, Karajan ERA el orquestador: `kj run` lanzaba coder, reviewer, tester, security y juez como subprocesos y dirigía el bucle él mismo. Ese pipeline no ha desaparecido — se convirtió en el **modo headless**, para los casos donde no hay agente anfitrión al volante:

- **Entrega desatendida** — `kj autorun <spec>` encadena spec → plan → historias de usuario → ejecución completa, con un árbitro resolviendo conflictos.
- **Carriles paralelos** — `kj run --parallel <n>` ejecuta las historias de un plan concurrentemente en worktrees de git por historia. Cada carril recibe `KJ_LANE_SLOT` y `KJ_PORT_OFFSET`, y `session.worktree_setup` declara el entorno por carril (puertos, BDs, nombres de proyecto docker) para que los carriles jamás colisionen.
- **Ejecución desatendida** — `--non-interactive` (o `KJ_NON_INTERACTIVE=1`) auto-responde los gates seguros (los warn continúan, decisión por stderr); los findings FAIL paran el run con exit code 1 en vez de bloquearse en un modal del board.
- **CI / runs con script** — donde no hay sesión interactiva de agente.

## Mismos gates, mismos veredictos

Los runs headless se gobiernan con el mismo contrato que tu agente: cuando el repo tiene el gate de revisión, el pipeline registra la aprobación de su reviewer interno como veredicto del diff staged exacto antes de commitear. Un solo gate, dos formas de trabajar — puedes mezclarlas en el mismo repo.

## Cuándo usar cada uno

| Situación | Usa |
|---|---|
| Trabajas CON un agente (Claude Code, Codex, Gemini, Cursor) | El entorno — el default v4 |
| Lote de historias independientes por la noche | `kj autorun` / `kj run --parallel` |
| Sin CLI de agente disponible (CI puro) | `kj run` |

## Documentación completa del pipeline

El pipeline subprocess (24 roles, políticas de triage, escalado a Solomon, techos de presupuesto, integración HU Board, stages de SonarQube) está documentado en profundidad en la sección **v3 (legacy)** de este sitio. "Legacy" significa que esa doc describe el encuadre pre-v4 — el código está vigente y mantenido; solo el centro de gravedad se movió al entorno.

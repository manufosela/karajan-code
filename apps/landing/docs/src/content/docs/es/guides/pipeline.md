---
title: Pipeline
description: Cómo funciona el pipeline multi-agente de Karajan Code.
---

:::note
Esta página está en construcción. Contenido completo próximamente.
:::

## Visión General del Pipeline

```
triage? → researcher? → planner? → coder → refactorer? → sonar? → reviewer → tester? → security? → commiter?
```

| Rol | Descripción | Por defecto |
|-----|-------------|-------------|
| **triage** | Clasifica la complejidad de la tarea y activa roles necesarios | Off |
| **researcher** | Investiga el contexto del codebase antes de planificar | Off |
| **planner** | Genera planes de implementación estructurados | Off |
| **coder** | Escribe código y tests siguiendo metodología TDD | **Siempre activo** |
| **refactorer** | Mejora la claridad del código sin cambiar comportamiento | Off |
| **sonar** | Ejecuta análisis estático SonarQube y quality gates | On (si configurado) |
| **reviewer** | Revisión de código con perfiles de exigencia configurables | **Siempre activo** |
| **tester** | Quality gate de tests y verificación de cobertura | Off |
| **security** | Auditoría de seguridad OWASP | Off |
| **solomon** | Resolutor de conflictos cuando coder y reviewer discrepan | Off |
| **commiter** | Automatización de git commit, push y PR tras aprobación | Off |

Los roles marcados con `?` son opcionales y se pueden activar por ejecución o via config.

## Pipeline Stage Tracker

Durante `kj_run`, Karajan emite un evento acumulativo `pipeline:tracker` tras cada transición de stage. Esto da a los hosts MCP (Claude Code, Codex, etc.) un único evento con el estado completo de todas las stages:

```
  ┌ Pipeline
  │ ✓ triage → medium
  │ ✓ planner → 5 steps
  │ ▶ coder (claude/sonnet)
  │ · sonar
  │ · reviewer
  └
```

Iconos de estado: `✓` done, `▶` running, `·` pending, `✗` failed.

Cada stage incluye un `summary` opcional — el nombre del provider mientras está en ejecución, o un resumen del resultado al completar.

Para herramientas single-agent (`kj_code`, `kj_review`, `kj_plan`), también se emiten logs de tracker start/end para que los hosts puedan mostrar qué agente está activo.

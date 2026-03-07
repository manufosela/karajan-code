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
| **triage** | Director de pipeline — analiza complejidad de la tarea y activa roles dinámicamente | **On** |
| **researcher** | Investiga el contexto del codebase antes de planificar | Off |
| **planner** | Genera planes de implementación estructurados | Off |
| **coder** | Escribe código y tests siguiendo metodología TDD | **Siempre activo** |
| **refactorer** | Mejora la claridad del código sin cambiar comportamiento | Off |
| **sonar** | Ejecuta análisis estático SonarQube y quality gates | On (si configurado) |
| **reviewer** | Revisión de código con perfiles de exigencia configurables | **Siempre activo** |
| **tester** | Quality gate de tests y verificación de cobertura | **On** |
| **security** | Auditoría de seguridad OWASP | **On** |
| **solomon** | Supervisor de sesión — monitoriza salud de iteraciones con 4 reglas, escala ante anomalías | **On** |
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

## Solomon Supervisor (v1.11.0)

Solomon se ejecuta tras cada iteración como supervisor de sesión con 4 reglas:

| Regla | Qué comprueba |
|-------|--------------|
| `max_files_per_iteration` | Demasiados ficheros cambiados en una iteración (defecto: 15) |
| `max_stale_iterations` | Mismos issues repitiéndose entre iteraciones (defecto: 3) |
| `dependency_guard` | Nuevas dependencias añadidas sin aprobación explícita |
| `scope_guard` | Cambios fuera del scope esperado de la tarea |

Cuando se dispara una alerta crítica, Solomon pausa la sesión y pide input humano via `elicitInput`.

## Standby por Rate-Limit (v1.11.0)

Cuando un coder o reviewer alcanza un rate limit, Karajan:

1. Parsea el tiempo de espera del mensaje de error (5 patrones soportados)
2. Espera con backoff exponencial (defecto 5min, máximo 30min)
3. Emite eventos `coder:standby`, `coder:standby_heartbeat` (cada 30s) y `coder:standby_resume`
4. Reintenta la misma iteración automáticamente
5. Tras 5 reintentos consecutivos, pausa para intervención humana

## Preflight Handshake (v1.11.0)

Antes de que `kj_run` o `kj_code` se ejecuten, Karajan requiere una llamada a `kj_preflight` para confirmar la configuración de agentes. Esto previene que los agentes IA cambien silenciosamente tus asignaciones de coder/reviewer.

El preflight soporta lenguaje natural: `"use gemini as coder"`, `"coder: claude"`, o `"set reviewer to codex"`.

Los overrides de sesión se almacenan en memoria y mueren cuando el servidor MCP se reinicia.

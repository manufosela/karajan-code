---
title: Referencia de Herramientas MCP
description: Referencia completa de parámetros de las 11 herramientas MCP de Karajan Code.
---

## kj_run

Ejecutar el pipeline completo coder &rarr; sonar &rarr; reviewer con notificaciones de progreso en tiempo real.

| Parámetro | Tipo | Requerido | Default | Descripción |
|-----------|------|-----------|---------|-------------|
| `task` | string | **Sí** | — | Descripción de la tarea |
| `coder` | string | No | Desde config | Agente IA para generación de código |
| `coderModel` | string | No | `null` | Modelo específico para el coder |
| `reviewer` | string | No | Desde config | Agente IA para revisión de código |
| `reviewerModel` | string | No | `null` | Modelo específico para el reviewer |
| `reviewerFallback` | string | No | Desde config | Reviewer de respaldo si el principal falla |
| `reviewerRetries` | number | No | `1` | Máx reintentos del reviewer ante error de parseo |
| `planner` | string | No | `null` | Agente IA para planificación |
| `plannerModel` | string | No | `null` | Modelo específico para el planner |
| `refactorer` | string | No | `null` | Agente IA para refactoring |
| `refactorerModel` | string | No | `null` | Modelo específico para el refactorer |
| `mode` | string | No | `standard` | Modo de revisión: `paranoid` \| `strict` \| `standard` \| `relaxed` |
| `methodology` | string | No | `tdd` | Metodología de desarrollo: `tdd` \| `standard` |
| `maxIterations` | number | No | `5` | Máx iteraciones del bucle coder/reviewer |
| `maxIterationMinutes` | number | No | `5` | Timeout por iteración (minutos) |
| `maxTotalMinutes` | number | No | Desde config | Timeout total de sesión (minutos) |
| `baseBranch` | string | No | `main` | Rama base de git para diffs |
| `baseRef` | string | No | `null` | Ref base de git explícita para diff |
| `branchPrefix` | string | No | `feat/` | Prefijo de rama git |
| `enablePlanner` | boolean | No | `false` | Activar rol de planificación |
| `enableReviewer` | boolean | No | `true` | Activar rol de revisión |
| `enableRefactorer` | boolean | No | `false` | Activar rol de refactoring |
| `enableResearcher` | boolean | No | `false` | Activar rol de investigación |
| `enableTester` | boolean | No | `false` | Activar auditoría de calidad de tests |
| `enableSecurity` | boolean | No | `false` | Activar auditoría de seguridad OWASP |
| `enableTriage` | boolean | No | `false` | Activar triage de complejidad |
| `enableSerena` | boolean | No | `false` | Activar análisis semántico Serena |
| `autoCommit` | boolean | No | `false` | Auto-commit tras aprobación |
| `autoPush` | boolean | No | `false` | Auto-push tras commit |
| `autoPr` | boolean | No | `false` | Crear PR tras push |
| `autoRebase` | boolean | No | `true` | Rebase sobre rama base antes de push |
| `noSonar` | boolean | No | `false` | Saltar análisis SonarQube |
| `pgTask` | string | No | `null` | ID de card en Planning Game (ej: `PRJ-TSK-0042`) |
| `pgProject` | string | No | `null` | ID de proyecto en Planning Game |
| `kjHome` | string | No | `~/.karajan` | Override del directorio KJ_HOME |
| `sonarToken` | string | No | Desde config | Override del token SonarQube |
| `timeoutMs` | number | No | `null` | Timeout del comando en milisegundos |

---

## kj_code

Modo solo coder — salta el bucle de revisión. Útil para cambios rápidos.

| Parámetro | Tipo | Requerido | Default | Descripción |
|-----------|------|-----------|---------|-------------|
| `task` | string | **Sí** | — | Descripción de la tarea |
| `coder` | string | No | Desde config | Agente IA para codificación |
| `coderModel` | string | No | `null` | Modelo específico para el coder |
| `kjHome` | string | No | `~/.karajan` | Override del directorio KJ_HOME |
| `timeoutMs` | number | No | `null` | Timeout del comando en milisegundos |

---

## kj_review

Modo solo reviewer sobre el diff actual. Útil tras cambios manuales.

| Parámetro | Tipo | Requerido | Default | Descripción |
|-----------|------|-----------|---------|-------------|
| `task` | string | **Sí** | — | Descripción de la tarea de revisión |
| `reviewer` | string | No | Desde config | Agente IA para revisión |
| `reviewerModel` | string | No | `null` | Modelo específico para el reviewer |
| `baseRef` | string | No | `null` | Ref base para comparación de diff |
| `kjHome` | string | No | `~/.karajan` | Override del directorio KJ_HOME |
| `timeoutMs` | number | No | `null` | Timeout del comando en milisegundos |

---

## kj_plan

Generar un plan de implementación sin escribir código.

| Parámetro | Tipo | Requerido | Default | Descripción |
|-----------|------|-----------|---------|-------------|
| `task` | string | **Sí** | — | Descripción de la tarea |
| `planner` | string | No | Desde config | Agente IA para planificación |
| `plannerModel` | string | No | `null` | Modelo específico para el planner |
| `kjHome` | string | No | `~/.karajan` | Override del directorio KJ_HOME |
| `timeoutMs` | number | No | `null` | Timeout del comando en milisegundos |

---

## kj_resume

Reanudar una sesión pausada (ej: tras fail-fast o pregunta de clarificación).

| Parámetro | Tipo | Requerido | Default | Descripción |
|-----------|------|-----------|---------|-------------|
| `sessionId` | string | **Sí** | — | ID de sesión a reanudar (ej: `s_2026-02-28T20-47-24-270Z`) |
| `answer` | string | No | `null` | Respuesta a la pregunta que causó la pausa |
| `kjHome` | string | No | `~/.karajan` | Override del directorio KJ_HOME |

---

## kj_report

Leer y mostrar informes de sesión con tracking de presupuesto.

| Parámetro | Tipo | Requerido | Default | Descripción |
|-----------|------|-----------|---------|-------------|
| `list` | boolean | No | `false` | Listar todos los IDs de sesión en lugar del último |
| `sessionId` | string | No | Último | ID de sesión específico a leer |
| `format` | string | No | `text` | Formato de salida: `text` \| `json` |
| `trace` | boolean | No | `false` | Mostrar desglose etapa por etapa con tiempos y costes |
| `currency` | string | No | `usd` | Moneda para mostrar costes: `usd` \| `eur` |
| `kjHome` | string | No | `~/.karajan` | Override del directorio KJ_HOME |

---

## kj_scan

Ejecutar escaneo SonarQube en el proyecto actual.

| Parámetro | Tipo | Requerido | Default | Descripción |
|-----------|------|-----------|---------|-------------|
| `kjHome` | string | No | `~/.karajan` | Override del directorio KJ_HOME |
| `sonarToken` | string | No | Desde config | Override del token SonarQube |
| `timeoutMs` | number | No | `null` | Timeout del comando en milisegundos |

---

## kj_init

Inicializar configuración de karajan-code, reglas de revisión y SonarQube.

| Parámetro | Tipo | Requerido | Default | Descripción |
|-----------|------|-----------|---------|-------------|
| `kjHome` | string | No | `~/.karajan` | Directorio KJ_HOME personalizado |
| `timeoutMs` | number | No | `null` | Timeout del comando en milisegundos |

---

## kj_doctor

Verificar dependencias del sistema y CLIs de agentes (claude, codex, gemini, aider).

| Parámetro | Tipo | Requerido | Default | Descripción |
|-----------|------|-----------|---------|-------------|
| `kjHome` | string | No | `~/.karajan` | Override del directorio KJ_HOME |
| `timeoutMs` | number | No | `null` | Timeout del comando en milisegundos |

---

## kj_config

Mostrar configuración actual (pretty-print o JSON).

| Parámetro | Tipo | Requerido | Default | Descripción |
|-----------|------|-----------|---------|-------------|
| `json` | boolean | No | `false` | Salida como JSON en lugar de pretty-print |
| `kjHome` | string | No | `~/.karajan` | Override del directorio KJ_HOME |

---

## kj_roles

Listar roles del pipeline o mostrar un template de rol específico.

| Parámetro | Tipo | Requerido | Default | Descripción |
|-----------|------|-----------|---------|-------------|
| `action` | string | No | `list` | Acción: `list` \| `show` |
| `roleName` | string | No | `null` | Rol a inspeccionar (ej: `coder`, `reviewer`, `reviewer-paranoid`) |
| `kjHome` | string | No | `~/.karajan` | Override del directorio KJ_HOME |

---

## Formato de respuesta común

Todas las herramientas devuelven una respuesta estructurada:

**Éxito:**
```json
{
  "ok": true,
  "sessionId": "s_...",
  ...
}
```

**Error:**
```json
{
  "ok": false,
  "error": "Mensaje de error",
  "tool": "kj_run",
  "category": "sonar_unavailable",
  "suggestion": "Sugerencia de corrección"
}
```

Categorías de error: `sonar_unavailable`, `auth_error`, `config_error`, `agent_missing`, `timeout`, `git_error`, `unknown`.

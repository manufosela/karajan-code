---
title: Referencia de Herramientas MCP
description: Referencia completa de parámetros de las 23 herramientas MCP de Karajan Code.
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
| `enableImpeccable` | boolean | No | `false` | Activar auditoría de diseño Impeccable (quality gate automatizado de UI/UX) |
| `enableHuReviewer` | boolean | No | `false` | Activar certificación de HUs (quality gate de historias de usuario). Auto-activado por triage para tareas medias/complejas desde v1.38.0 |
| `huFile` | string | No | `null` | Ruta al fichero de historia de usuario para el HU reviewer. Opcional — cuando se auto-activa por triage, hu-reviewer funciona sin fichero |
| `taskType` | string | No | `null` | Tipo de tarea para resolucion de politicas: `sw`, `infra`, `doc`, `add-tests`, `refactor` |
| `autoSimplify` | boolean | No | `true` | Auto-simplificar pipeline para triage nivel 1-2 (solo coder, omite reviewer/tester). Establecer a `false` para ejecutar siempre el pipeline completo |
| `timeoutMs` | number | No | `null` | Timeout del comando en milisegundos (legado; preferir telemetría heartbeat/stall y guardarraíles de silencio en sesión) |

---

## kj_code

Modo solo coder — salta el bucle de revisión. Útil para cambios rápidos.

| Parámetro | Tipo | Requerido | Default | Descripción |
|-----------|------|-----------|---------|-------------|
| `task` | string | **Sí** | — | Descripción de la tarea |
| `coder` | string | No | Desde config | Agente IA para codificación |
| `coderModel` | string | No | `null` | Modelo específico para el coder |
| `kjHome` | string | No | `~/.karajan` | Override del directorio KJ_HOME |
| `timeoutMs` | number | No | `null` | Timeout del comando en milisegundos (legado; preferir telemetría heartbeat/stall y guardarraíles de silencio en sesión) |

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
| `timeoutMs` | number | No | `null` | Timeout del comando en milisegundos (legado; preferir telemetría heartbeat/stall y guardarraíles de silencio en sesión) |

---

## kj_plan

Generar un plan de implementación sin escribir código, con telemetría de heartbeat/stall y diagnóstico más claro en ejecuciones largas.

| Parámetro | Tipo | Requerido | Default | Descripción |
|-----------|------|-----------|---------|-------------|
| `task` | string | **Sí** | — | Descripción de la tarea |
| `planner` | string | No | Desde config | Agente IA para planificación |
| `plannerModel` | string | No | `null` | Modelo específico para el planner |
| `kjHome` | string | No | `~/.karajan` | Override del directorio KJ_HOME |
| `timeoutMs` | number | No | `null` | Timeout del comando en milisegundos (legado; preferir telemetría heartbeat/stall y guardarraíles de silencio en sesión) |

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
| `timeoutMs` | number | No | `null` | Timeout del comando en milisegundos (legado; preferir telemetría heartbeat/stall y guardarraíles de silencio en sesión) |

---

## kj_init

Inicializar configuración de karajan-code, reglas de revisión y SonarQube.

| Parámetro | Tipo | Requerido | Default | Descripción |
|-----------|------|-----------|---------|-------------|
| `kjHome` | string | No | `~/.karajan` | Directorio KJ_HOME personalizado |
| `timeoutMs` | number | No | `null` | Timeout del comando en milisegundos (legado; preferir telemetría heartbeat/stall y guardarraíles de silencio en sesión) |

---

## kj_doctor

Verificar dependencias del sistema y CLIs de agentes (claude, codex, gemini, aider).

| Parámetro | Tipo | Requerido | Default | Descripción |
|-----------|------|-----------|---------|-------------|
| `kjHome` | string | No | `~/.karajan` | Override del directorio KJ_HOME |
| `timeoutMs` | number | No | `null` | Timeout del comando en milisegundos (legado; preferir telemetría heartbeat/stall y guardarraíles de silencio en sesión) |

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

## kj_agents

Listar o cambiar asignaciones de agentes IA por rol. Soporta scope de sesión, proyecto y global.

| Parámetro | Tipo | Requerido | Default | Descripción |
|-----------|------|-----------|---------|-------------|
| `action` | string | No | `list` | Acción: `list` \| `set` |
| `role` | string | No | `null` | Rol a cambiar (ej: `coder`, `reviewer`) — requerido para `set` |
| `provider` | string | No | `null` | Provider a asignar (ej: `claude`, `codex`) — requerido para `set` |

---

## kj_preflight

El humano confirma la configuración de agentes antes de que `kj_run`/`kj_code` se ejecuten. Requerido antes de la primera ejecución en cada sesión MCP.

| Parámetro | Tipo | Requerido | Default | Descripción |
|-----------|------|-----------|---------|-------------|
| `humanResponse` | string | **Sí** | — | Respuesta del humano: `"ok"` para confirmar, o lenguaje natural para ajustar (ej: `"use gemini as coder"`) |
| `coder` | string | No | `null` | Override del agente coder |
| `reviewer` | string | No | `null` | Override del agente reviewer |
| `tester` | string | No | `null` | Override del agente tester |
| `security` | string | No | `null` | Override del agente security |
| `solomon` | string | No | `null` | Override del agente solomon |
| `enableTester` | boolean | No | `null` | Activar/desactivar rol tester |
| `enableSecurity` | boolean | No | `null` | Activar/desactivar rol security |

---

## kj_status

Muestra el estado en tiempo real y log de la ejecución actual o última de Karajan. Devuelve un resumen parseado (stage actual, agente, iteración, errores) más las líneas recientes del log.

| Parámetro | Tipo | Requerido | Default | Descripción |
|-----------|------|-----------|---------|-------------|
| `lines` | number | No | `50` | Número de líneas del log a mostrar |

**La respuesta incluye:**
- `status.currentStage` — qué stage está ejecutándose
- `status.currentAgent` — qué agente IA está activo
- `status.iteration` — número de iteración actual
- `status.isRunning` — si hay una ejecución en curso
- `status.errors` — últimas 3 líneas de error

---

## kj_audit

Auditoría de salud del codebase de solo lectura en 5 dimensiones: seguridad, calidad de código, rendimiento, arquitectura y testing. Genera un informe estructurado con puntuaciones A-F y recomendaciones priorizadas sin modificar ningún fichero.

| Parámetro | Tipo | Requerido | Default | Descripción |
|-----------|------|-----------|---------|-------------|
| `task` | string | No | `null` | Área de enfoque opcional o preocupación específica a auditar |
| `projectDir` | string | No | cwd | Directorio del proyecto a auditar |
| `kjHome` | string | No | `~/.karajan` | Override del directorio KJ_HOME |

---

## kj_discover

Ejecutar análisis de descubrimiento sobre una tarea usando múltiples frameworks analíticos (gaps, Mom Test, Wendel, JTBD).

| Parámetro | Tipo | Requerido | Default | Descripción |
|-----------|------|-----------|---------|-------------|
| `task` | string | **Sí** | — | Descripción de la tarea a analizar |
| `mode` | string | No | `gaps` | Modo de descubrimiento: `gaps` \| `momtest` \| `wendel` \| `classify` \| `jtbd` |
| `projectDir` | string | No | cwd | Directorio del proyecto |

**Ejemplo:**

```json
{
  "tool": "kj_discover",
  "params": {
    "task": "Añadir soporte multi-tenancy",
    "mode": "jtbd"
  }
}
```

---

## kj_triage

Clasificar la complejidad de una tarea y determinar qué roles del pipeline deben activarse.

| Parámetro | Tipo | Requerido | Default | Descripción |
|-----------|------|-----------|---------|-------------|
| `task` | string | **Sí** | — | Descripción de la tarea a clasificar |
| `projectDir` | string | No | cwd | Directorio del proyecto |

**Ejemplo:**

```json
{
  "tool": "kj_triage",
  "params": {
    "task": "Corregir errata en el README"
  }
}
```

---

## kj_researcher

Investigar el contexto del codebase relevante para una tarea antes de planificar o codificar.

| Parámetro | Tipo | Requerido | Default | Descripción |
|-----------|------|-----------|---------|-------------|
| `task` | string | **Sí** | — | Descripción de la tarea a investigar |
| `projectDir` | string | No | cwd | Directorio del proyecto |

**Ejemplo:**

```json
{
  "tool": "kj_researcher",
  "params": {
    "task": "Refactorizar el módulo de autenticación"
  }
}
```

---

## kj_architect

Diseñar la arquitectura de solución para una tarea, produciendo un documento de diseño estructurado.

| Parámetro | Tipo | Requerido | Default | Descripción |
|-----------|------|-----------|---------|-------------|
| `task` | string | **Sí** | — | Descripción de la tarea a diseñar |
| `projectDir` | string | No | cwd | Directorio del proyecto |

**Ejemplo:**

```json
{
  "tool": "kj_architect",
  "params": {
    "task": "Migrar de REST a GraphQL"
  }
}
```

---

## kj_board

Iniciar, detener o consultar el estado del dashboard HU Board.

| Parámetro | Tipo | Requerido | Default | Descripción |
|-----------|------|-----------|---------|-------------|
| `action` | string | **Sí** | — | Acción: `start` \| `stop` \| `status` |
| `projectDir` | string | No | cwd | Directorio del proyecto |

**Ejemplo:**

```json
{
  "tool": "kj_board",
  "params": {
    "action": "start"
  }
}
```

---

## kj_hu

Gestionar historias de usuario (crear, actualizar, listar, obtener) en el HU Board local.

| Parámetro | Tipo | Requerido | Default | Descripción |
|-----------|------|-----------|---------|-------------|
| `action` | string | **Sí** | — | Acción: `create` \| `update` \| `list` \| `get` |
| `title` | string | No | `null` | Título de la historia de usuario (requerido para `create`) |
| `description` | string | No | `null` | Descripción de la historia de usuario |
| `huId` | string | No | `null` | Identificador de la HU (requerido para `update` y `get`) |
| `status` | string | No | `null` | Estado de la HU |
| `projectDir` | string | No | cwd | Directorio del proyecto |

**Ejemplo:**

```json
{
  "tool": "kj_hu",
  "params": {
    "action": "create",
    "title": "Como usuario quiero restablecer mi contraseña",
    "description": "Flujo de restablecimiento de contraseña con verificación por email"
  }
}
```

---

## kj_suggest

Enviar una observación a Solomon sin interrumpir el pipeline. Útil para proporcionar contexto o pistas que Solomon puede considerar en su próxima evaluación.

| Parámetro | Tipo | Requerido | Default | Descripción |
|-----------|------|-----------|---------|-------------|
| `observation` | string | **Sí** | — | Observación o sugerencia para Solomon |
| `sessionId` | string | No | Último | ID de sesión objetivo |
| `projectDir` | string | No | cwd | Directorio del proyecto |

**Ejemplo:**

```json
{
  "tool": "kj_suggest",
  "params": {
    "observation": "El reviewer se está centrando en convenciones de nombrado — considerar anular"
  }
}
```

---

## kj_skills

Listar, instalar o eliminar skills específicos de dominio para los roles del pipeline. Los skills extienden los prompts de coder, reviewer y architect con conocimiento de dominio.

| Parámetro | Tipo | Requerido | Default | Descripción |
|-----------|------|-----------|---------|-------------|
| `action` | string | No | `list` | Acción: `list` \| `install` \| `remove` |
| `skill` | string | No | `null` | Identificador del skill (requerido para `install` y `remove`) |
| `projectDir` | string | No | cwd | Directorio del proyecto |

**Ejemplo:**

```json
{
  "tool": "kj_skills",
  "params": {
    "action": "install",
    "skill": "react-patterns"
  }
}
```

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

Categorías de error: `sonar_unavailable`, `auth_error`, `config_error`, `agent_missing`, `timeout`, `branch_error`, `agent_stall`, `git_error`, `unknown`.

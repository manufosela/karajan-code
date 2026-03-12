---
title: Pipeline
description: Cómo funciona el pipeline multi-agente de Karajan Code.
---

:::note
Esta página está en construcción. Contenido completo próximamente.
:::

## Visión General del Pipeline

```
discover? → triage? → researcher? → planner? → coder → refactorer? → sonar? → reviewer → tester? → security? → commiter?
```

| Rol | Descripción | Por defecto |
|-----|-------------|-------------|
| **discover** | Detección de gaps pre-ejecución — analiza tareas buscando información faltante, ambigüedades y asunciones | Off |
| **triage** | Director de pipeline — analiza complejidad de la tarea y activa roles dinámicamente | **On** |
| **researcher** | Investiga el contexto del codebase antes de planificar | Off |
| **planner** | Genera planes de implementación estructurados | Off |
| **coder** | Escribe código y tests siguiendo metodología TDD | **Siempre activo** |
| **refactorer** | Mejora la claridad del código sin cambiar comportamiento | Off |
| **sonar** | Ejecuta análisis estático SonarQube y quality gates | On (si configurado) |
| **reviewer** | Revisión de código con perfiles de exigencia configurables | **Siempre activo** |
| **tester** | Quality gate de tests y verificación de cobertura | **On** |
| **security** | Auditoría de seguridad OWASP | **On** |
| **solomon** | Supervisor de sesión — monitoriza salud de iteraciones con 5 reglas, media stalls del reviewer, escala ante anomalías | **On** |
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

## Solomon Supervisor (v1.12.0)

Solomon se ejecuta tras cada iteración como supervisor de sesión con 5 reglas:

| Regla | Qué comprueba |
|-------|--------------|
| `max_files_per_iteration` | Demasiados ficheros cambiados en una iteración (defecto: 15) |
| `max_stale_iterations` | Mismos issues repitiéndose entre iteraciones (defecto: 3) |
| `dependency_guard` | Nuevas dependencias añadidas sin aprobación explícita |
| `scope_guard` | Cambios fuera del scope esperado de la tarea |
| `reviewer_overreach` | El reviewer reporta issues en ficheros fuera del diff actual |

Cuando se dispara una alerta crítica, Solomon pausa la sesión y pide input humano via `elicitInput`.

A partir de v1.12.0, Solomon también media los stalls del reviewer. En lugar de detener el pipeline inmediatamente cuando el reviewer se estanca, Solomon interviene para evaluar la situación, pudiendo auto-diferir los issues fuera de scope y permitir que el pipeline continúe.

## Scope Filter del Reviewer (v1.12.0)

Cuando el reviewer reporta issues sobre ficheros que no están presentes en el diff actual, el scope filter los clasifica automáticamente como **issues diferidos** en lugar de bloquear el pipeline.

**Comportamiento:**
1. El reviewer ejecuta su revisión normalmente
2. El scope filter analiza cada issue reportado y compara los ficheros afectados con el diff real
3. Los issues sobre ficheros fuera de scope se auto-difieren — no bloquean la iteración
4. Los issues diferidos se rastrean como deuda técnica dentro de la sesión
5. En la siguiente iteración, los issues diferidos se inyectan en el prompt del coder como contexto adicional

**Resultado de sesión:**
El campo `deferredIssues` en el resultado de la sesión contiene la lista de issues diferidos con su fichero, descripción y la iteración en la que fueron detectados. Esto permite rastrear la deuda técnica generada durante la ejecución del pipeline.

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

## BecarIA Gateway (v1.13.0)

BecarIA Gateway añade integración CI/CD completa con GitHub PRs como fuente única de verdad. En lugar de ejecutar agentes localmente y crear PRs manualmente, el gateway convierte las PRs en el punto central de coordinación.

### Cómo funciona

1. **Creación temprana de PR**: Tras la primera iteración del coder, Karajan crea una PR en borrador automáticamente
2. **Comentarios de agentes en PRs**: Todos los agentes (Coder, Reviewer, Sonar, Solomon, Tester, Security, Planner) publican sus resultados como comentarios o reviews en la PR
3. **Dispatch events configurables**: La sección `becaria` del config define qué workflows de GitHub Actions disparar en cada etapa del pipeline
4. **Workflow templates embebidos**: `kj init --scaffold-becaria` genera ficheros de workflow listos para usar (`becaria-gateway.yml`, `automerge.yml`, `houston-override.yml`)

### Review standalone con diff de PR

`kj review` ahora soporta revisar el diff de una PR existente directamente, haciéndolo utilizable como herramienta de code review independiente fuera del pipeline completo.

### Configuración

```bash
kj init --scaffold-becaria
kj doctor  # verifica la configuración de BecarIA
```

Activar vía CLI:

```bash
kj run --enable-becaria --task "Añadir validación de inputs"
```

O vía MCP:

```json
{
  "tool": "kj_run",
  "params": {
    "task": "Añadir validación de inputs",
    "enableBecaria": true
  }
}
```

`kj doctor` incluye verificaciones específicas de BecarIA para confirmar que los workflow templates están presentes y que el token de GitHub tiene los permisos necesarios.

## Pipeline Dirigido por Politicas (v1.14.0+)

El modulo **policy-resolver** mapea cada `taskType` a un conjunto de politicas de pipeline, determinando que stages estan activadas o desactivadas:

| taskType | TDD | SonarQube | Reviewer | Tests Required |
|----------|-----|-----------|----------|----------------|
| `sw` | ✓ | ✓ | ✓ | ✓ |
| `infra` | ✗ | ✗ | ✓ | ✗ |
| `doc` | ✗ | ✗ | ✓ | ✗ |
| `add-tests` | ✗ | ✓ | ✓ | ✓ |
| `refactor` | ✓ | ✓ | ✓ | ✗ |

Si el `taskType` es desconocido o no se proporciona, se aplica `sw` por defecto (la configuracion mas conservadora).

Las politicas se pueden sobreescribir por proyecto en `kj.config.yml`:

```yaml
policies:
  sw:
    tdd: false
  infra:
    sonar: true
```

El orquestador emite un evento `policies:resolved` y aplica los gates de politicas usando copias superficiales — sin mutar nunca la configuracion del llamante.

### Triage Obligatorio (v1.15.0+)

A partir de v1.15.0, el triage siempre se ejecuta para clasificar el `taskType` de la tarea. La prioridad de clasificacion es:

1. Flag explicito `--taskType` (prioridad maxima)
2. `taskType` en `kj.config.yml`
3. Clasificacion por IA del triage
4. Por defecto: `sw` (la configuracion mas conservadora)

El triage puede activar roles adicionales pero no puede desactivar roles explicitamente habilitados en la configuracion del pipeline.

## Discovery Stage (v1.16.0)

El stage **discover** se ejecuta antes del triage como etapa pre-pipeline opt-in. Analiza la especificación de la tarea buscando gaps, ambigüedades e información faltante antes de escribir código.

### Activar discovery

Via CLI:
```bash
kj run --enable-discover --task "Añadir autenticación de usuarios"
```

Via MCP:
```json
{
  "tool": "kj_run",
  "params": {
    "task": "Añadir autenticación de usuarios",
    "enableDiscover": true
  }
}
```

O permanentemente en `kj.config.yml`:
```yaml
pipeline:
  discover:
    enabled: true
    mode: gaps  # o: momtest, wendel, classify, jtbd
```

### 5 Modos de Discovery

| Modo | Qué hace |
|------|----------|
| `gaps` | Por defecto — identifica requisitos faltantes, ambigüedades, asunciones implícitas y contradicciones |
| `momtest` | Genera preguntas de validación siguiendo los principios de The Mom Test (comportamiento pasado, no hipotéticos) |
| `wendel` | Evalúa 5 condiciones de adopción de cambio de comportamiento: CUE, REACTION, EVALUATION, ABILITY, TIMING |
| `classify` | Clasifica el impacto de la tarea como START (nuevo comportamiento), STOP (eliminar comportamiento) o DIFFERENT (cambiar existente) |
| `jtbd` | Genera Jobs-to-be-Done reforzados con capas funcional, emocional y de comportamiento |

### Uso standalone con kj_discover

Discovery también está disponible como herramienta MCP independiente:

```json
{
  "tool": "kj_discover",
  "params": {
    "task": "Añadir toggle de modo oscuro a la página de ajustes",
    "mode": "wendel"
  }
}
```

### Comportamiento no bloqueante

Discovery es no bloqueante: si falla, el pipeline registra un warning y continúa la ejecución. Cuando el verdict es `needs_validation`, el pipeline emite un warning con los gaps detectados pero procede normalmente.

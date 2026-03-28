---
title: Pipeline
description: Cómo funciona el pipeline multi-agente de Karajan Code.
---

## Visión General del Pipeline

Karajan orquesta **15 roles especializados** a través de un pipeline de tres fases. Cada rol define *qué* hacer; tú eliges *qué agente de IA* (Claude, Codex, Gemini, Aider, OpenCode) lo ejecuta.

```
intent? → discover? → hu-reviewer? → triage → researcher? → architect? → planner? → [coder → refactorer? → guards → TDD → sonar? → impeccable? → reviewer] → tester? → security? → audit? → commiter?
                                                                                   └─── bucle de iteración (1..N) ─────────────────────────────────────┘
```

### Roles

| Rol | Descripción | Por defecto |
|-----|-------------|-------------|
| **discover** | Detección de gaps pre-ejecución — analiza tareas buscando información faltante, ambigüedades y asunciones | Off |
| **triage** | Director de pipeline — analiza complejidad de la tarea, clasifica taskType y activa roles dinámicamente | **On** |
| **researcher** | Investiga el contexto del codebase antes de planificar | Off |
| **architect** | Diseña la arquitectura de la solución — capas, patrones, modelo de datos, contratos API, tradeoffs | Off |
| **planner** | Genera planes de implementación estructurados informados por la arquitectura | Off |
| **coder** | Escribe código y tests siguiendo metodología TDD | **Siempre activo** |
| **refactorer** | Mejora la claridad del código sin cambiar comportamiento | Off |
| **sonar** | Ejecuta análisis estático SonarQube y quality gates | On (si configurado) |
| **impeccable** | Auditoría automatizada de diseño UI/UX — accesibilidad, rendimiento, theming, responsive, anti-patrones | Off |
| **reviewer** | Revisión de código con perfiles de exigencia configurables | **Siempre activo** |
| **tester** | Quality gate de tests y verificación de cobertura | **On** |
| **security** | Auditoría de seguridad OWASP | **On** |
| **solomon** | Pipeline Boss & Árbitro — evalúa cada rechazo del reviewer, clasifica issues, puede anular bloqueos por estilo. 6 reglas con control inteligente de iteraciones | **On** |
| **commiter** | Automatización de git commit, push y PR tras aprobación | Off |
| **hu-reviewer** | Certificación de HUs — evalúa historias de usuario en 6 dimensiones de calidad, detecta 7 antipatrones, reescribe historias débiles, soporta grafos de dependencias | Auto (medio/complejo) |
| **audit** | Quality gate obligatorio post-aprobación — se ejecuta después de que reviewer+tester+security aprueben. Comprueba el código generado buscando issues críticos/altos; si los encuentra, devuelve al coder. Si está limpio, el pipeline queda CERTIFICADO | **On** (v1.32.0+) |

Los roles marcados con `?` son opcionales y se pueden activar por ejecución o via config.

### Guards Deterministas

Los guards son comprobaciones basadas en regex/patrones que se ejecutan entre el coder y los quality gates — sin coste LLM, 100% deterministas:

| Guard | Qué comprueba | Por defecto |
|-------|--------------|-------------|
| **output-guard** | Operaciones destructivas (rm -rf, DROP TABLE, git push --force), credenciales expuestas (15 patrones: claves AWS, claves privadas, tokens GitHub/npm/PyPI/Slack, Google OAuth, JWTs, secrets genéricos), modificaciones de ficheros protegidos (.env, serviceAccountKey.json). Los 15 patrones de credenciales son bloqueantes — los secrets nunca pasan (v1.38.2) | **On** (bloquea en crítico) |
| **perf-guard** | Anti-patrones de rendimiento frontend — imágenes sin dimensiones/lazy, scripts bloqueantes, font-display ausente, document.write, deps pesadas (moment, lodash, jquery) | **On** (advisory, configurable para bloquear) |
| **intent-classifier** | Clasificación pre-triage por keywords — salta el triage LLM para tipos de tarea obvios (doc, add-tests, refactor, infra, trivial-fix) | Off |
| **injection-guard** | Escáner de inyección de prompts — detecta directivas override ("ignore previous instructions"), caracteres Unicode invisibles (zero-width spaces, bidi overrides) y payloads de comentarios sobredimensionados en diffs antes de pasarlos a los reviewers IA. También disponible como GitHub Action | **On** |

Los guards son configurables via `kj.config.yml`:

```yaml
guards:
  output:
    enabled: true
    on_violation: block  # block | warn | skip
    # patterns: [{ id: "custom", pattern: "DANGEROUS", severity: "critical", message: "..." }]
    # protected_files: [secrets.yml]
  perf:
    enabled: true
    block_on_warning: false
    # patterns: [{ id: "custom-perf", pattern: "eval\\(", severity: "warning" }]
  intent:
    enabled: false
    confidence_threshold: 0.85
    # patterns: [{ keywords: ["readme", "docs"], taskType: "doc", confidence: 0.9 }]
```

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

## Solomon — Pipeline Boss (v1.12.0, mejorado en v1.25.0)

Solomon se ejecuta tras cada iteración como Pipeline Boss & Árbitro. Evalúa cada rechazo del reviewer, clasifica issues como críticos vs. solo estilo, y puede anular bloqueos por estilo para mantener el pipeline en movimiento. 6 reglas:

| Regla | Qué comprueba |
|-------|--------------|
| `max_files_per_iteration` | Demasiados ficheros cambiados en una iteración (defecto: 15) |
| `max_stale_iterations` | Mismos issues repitiéndose entre iteraciones (defecto: 3) |
| `dependency_guard` | Nuevas dependencias añadidas sin aprobación explícita |
| `scope_guard` | Cambios fuera del scope esperado de la tarea |
| `reviewer_overreach` | El reviewer reporta issues en ficheros fuera del diff actual |
| `style_only_block` | El reviewer bloquea exclusivamente por issues de estilo/formato — auto-escala a revisión humana (v1.24.1) |

Cuando se dispara una alerta crítica, Solomon pausa la sesión y pide input humano via `elicitInput`.

A partir de v1.12.0, Solomon también media los stalls del reviewer. En lugar de detener el pipeline inmediatamente cuando el reviewer se estanca, Solomon interviene para evaluar la situación, pudiendo auto-diferir los issues fuera de scope y permitir que el pipeline continúe.

Desde v1.25.0, Solomon evalúa **cada** rechazo del reviewer, clasificando issues y aplicando lógica de iteración inteligente. Los bloqueos por solo estilo se anulan automáticamente, permitiendo que el pipeline continúe sin intervención humana para cuestiones subjetivas.

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

## Architect Stage (v1.17.0+)

El rol **architect** se ejecuta entre researcher y planner para definir la arquitectura de la solución antes de codificar. Produce decisiones de diseño explícitas: capas, patrones, modelo de datos, contratos API y tradeoffs.

### Activación

El triage auto-activa el architect cuando la tarea crea nuevos módulos/apps, afecta a modelos de datos o APIs, tiene complejidad media/alta, o tiene diseño ambiguo. También puedes activarlo explícitamente:

```bash
kj run --enable-architect --task "Construir sistema de autenticación"
```

### Clarificación interactiva

Cuando el architect detecta ambigüedad de diseño, devuelve `verdict: "needs_clarification"` con preguntas específicas. El pipeline se pausa y pregunta al humano via `askQuestion`. Tras recibir respuestas, el architect re-evalúa con el contexto adicional.

Si no hay input interactivo disponible (CLI no interactivo), el architect continúa con las mejores decisiones posibles y emite un warning.

### Generación automática de ADRs

Cuando hay una card de Planning Game vinculada (`pgTaskId` + `pgProject`), cada tradeoff arquitectónico se persiste automáticamente como Architecture Decision Record (ADR) via el MCP de Planning Game.

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

### Pipeline Auto-Simplify (v1.25.1+)

Cuando el triage clasifica una tarea como nivel 1-2 (trivial o simple), el pipeline ejecuta automáticamente un flujo ligero solo con coder — reviewer, tester y otras etapas post-coder se auto-desactivan. Las tareas de nivel 3+ (medio, complejo) ejecutan el pipeline completo con todas las etapas habilitadas. Esto reduce overhead para tareas simples mientras preserva el rigor para las complejas.

Desactivar con `--no-auto-simplify` (CLI) o `autoSimplify: false` (MCP).

### Auto-Detección de TDD (v1.25.0+)

La metodología TDD ahora se auto-detecta según el framework de tests del proyecto. Si el proyecto tiene un test runner configurado (Vitest, Jest, Mocha, etc.), el pipeline activa TDD automáticamente sin necesitar `--methodology tdd`. Puedes forzar con `--methodology standard` si lo necesitas.

Desde v1.38.1, TDD soporta **12 lenguajes** además de JavaScript/TypeScript: Java (JUnit/Maven/Gradle), Python (pytest/unittest), Go (go test), Rust (cargo test), C# (dotnet test/NUnit/xUnit), Ruby (RSpec/Minitest), PHP (PHPUnit), Swift (XCTest), Dart (dart test/Flutter) y Kotlin (JUnit/Gradle). El enforcer TDD auto-detecta el lenguaje y framework de tests del proyecto.

### Triage Obligatorio (v1.15.0+)

A partir de v1.15.0, el triage siempre se ejecuta para clasificar el `taskType` de la tarea. La prioridad de clasificacion es:

1. Flag explicito `--taskType` (prioridad maxima)
2. `taskType` en `kj.config.yml`
3. Clasificacion por IA del triage
4. Por defecto: `sw` (la configuracion mas conservadora)

El triage puede activar roles adicionales pero no puede desactivar roles explicitamente habilitados en la configuracion del pipeline.

## Discovery Stage (v1.16.0+)

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

## Gestor Integrado de HUs (v1.38.0+)

Cuando el triage clasifica una tarea como media o compleja, el rol **hu-reviewer** se auto-activa y descompone la tarea en 2-5 historias de usuario (HUs) formales con ordenación por dependencias. Cada HU ejecuta su propia iteración en el pipeline (coder → sonar → reviewer), con tracking de estado individual (pending → coding → reviewing → done/failed/blocked).

### Cómo funciona

1. **Clasificación del triage**: el triage analiza la tarea y determina el nivel de complejidad
2. **Auto-activación**: para tareas medias/complejas, hu-reviewer se activa automáticamente (no necesita `--enable-hu-reviewer`)
3. **Descomposición por IA**: hu-reviewer descompone la tarea en 2-5 HUs formales con criterios de aceptación y grafos de dependencias
4. **Ejecución de sub-pipeline**: cada HU ejecuta su propio ciclo coder → sonar → reviewer con tracking de estado
5. **Adaptador PG**: cuando hay una card de Planning Game vinculada, los datos de la card se envían a hu-reviewer para enriquecer el contexto
6. **Registros de historial**: se generan registros de historial del pipeline para todas las ejecuciones, proporcionando trazabilidad completa

### Tracking de estado

Cada HU progresa a través de estados de forma independiente:

```
pending → coding → reviewing → done
                             → failed
                             → blocked
```

El pipeline rastrea qué HUs están completadas y cuáles quedan pendientes, respetando las dependencias durante la ejecución.

### Override manual

Puedes activar hu-reviewer explícitamente para tareas simples:

```bash
kj run --enable-hu-reviewer --task "Añadir validación de inputs"
```

O desactivar la auto-activación:

```bash
kj run --no-hu-reviewer --task "Tarea compleja sin descomposición en HUs"
```

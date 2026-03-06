---
title: Historial de Arquitectura
description: Cómo ha evolucionado la arquitectura de Karajan Code.
---

Esta página documenta las decisiones arquitectónicas principales y cómo Karajan Code evolucionó desde un simple script orquestador hasta un pipeline modular multi-agente.

## Fase 1: Orquestador Simple (v0.x)

**Qué era:** Un único script que ejecutaba Claude CLI sobre una tarea, luego ejecutaba Codex CLI para revisar el output. Sin config, sin sesiones, sin quality gates.

**Arquitectura:**
```
tarea → claude → diff → codex review → done
```

**Limitaciones:**
- Hardcoded a dos agentes (Claude + Codex)
- Sin reintentos ante fallos
- Sin tracking de costes
- Sin integración con SonarQube ni testing
- Script monolítico, difícil de extender

## Fase 2: Quality Gates (v1.0)

**Qué cambió:** Se añadió análisis estático SonarQube como paso obligatorio entre codificación y revisión. Se añadió TDD obligatorio para asegurar que se escriben tests junto al código.

**Adiciones clave:**
- Integración Docker con SonarQube (auto-arranque, scan, enforcement de quality gate)
- Política TDD (cambios en source requieren cambios en tests)
- Fichero de configuración (`kj.config.yml`) con primeros defaults
- Tracking de sesiones (metadatos básicos de ejecución)

**Arquitectura:**
```
tarea → coder → sonar → reviewer → done
                          ↑          │
                          └── bucle ─┘
```

**Por qué:** El código generado por IA sin quality gates frecuentemente introducía code smells, saltaba tests o tenía problemas de seguridad. SonarQube proporcionó un chequeo de calidad objetivo y automatizado independiente del reviewer.

## Fase 3: Pipeline Basado en Roles (v1.1)

**Qué cambió:** Refactorización del orquestador monolítico a una arquitectura basada en roles. Cada responsabilidad del pipeline se convirtió en un rol discreto con sus propias instrucciones, agente y modelo.

**Adiciones clave:**
- Abstracción `BaseRole` (ciclo de vida init → execute → report)
- Abstracción `BaseAgent` (interfaz uniforme para todos los agentes CLI)
- Registry de agentes (register, create, resolve)
- 11 roles configurables: triage, researcher, planner, coder, refactorer, sonar, reviewer, tester, security, solomon, commiter
- Perfiles de revisión (standard, strict, paranoid, relaxed)
- Instrucciones de roles como templates markdown (sobreescribibles)
- Detección de repeticiones y lógica fail-fast
- Escalado Solomon para resolución de conflictos
- Tracking de presupuesto con costes estimados

**Arquitectura:**
```
triage? → researcher? → planner? → coder → refactorer? → sonar? → reviewer
                                                                      ↓
                                                         tester? → security? → commiter?
```

**Por qué:** El orquestador monolítico se había vuelto difícil de mantener y extender. Añadir una nueva capacidad (como auditorías de seguridad) significaba modificar el bucle central. El patrón basado en roles hizo cada responsabilidad independientemente testeable y configurable.

**Inspiración:** [jorgecasar/legacy-s-end-2/packages/ai-orchestration](https://github.com/jorgecasar/legacy-s-end-2/tree/main/packages/ai-orchestration) usa una arquitectura hexagonal limpia con:
- **Capa de dominio**: Modelos e interfaces de puertos
- **Casos de uso**: plan-issue, implement-issue, review-pr, check-task-readiness, track-cost-report
- **Infraestructura**: Adaptadores para Anthropic, Gemini, OpenAI, GitHub, GitCli

Esto influyó en la separación de Karajan entre la interfaz de agente (`BaseAgent` como puerto) e implementaciones concretas (Claude, Codex, Gemini, Aider como adaptadores). El sistema de roles es paralelo a la capa de casos de uso — cada rol es una unidad de orquestación autocontenida.

## Fase 4: Servidor MCP (v1.2)

**Qué cambió:** Se añadió un servidor Model Context Protocol (MCP) para que Karajan pueda usarse desde dentro de agentes IA (Claude Code, Codex) en lugar de solo desde el terminal.

**Adiciones clave:**
- Servidor MCP stdio con 11 herramientas (kj_run, kj_code, kj_review, etc.)
- Notificaciones de progreso en tiempo real via logging MCP
- Auto-registro en Claude Code y Codex
- Orphan guard para prevenir procesos zombie
- Pausa/reanudación de sesiones via MCP (`kj_resume`)

**Adición a la arquitectura:**
```
┌──────────────────┐
│ Agente IA (Claude)│
│                  │──── MCP (stdio) ────→ karajan-mcp ──→ subproceso CLI
│                  │←─── progreso/result ─┘
└──────────────────┘
```

**Por qué:** La forma más potente de usar Karajan no es desde el terminal, sino desde dentro de la conversación de un agente IA. El servidor MCP permite a Claude o Codex delegar tareas complejas al pipeline de Karajan, recibir actualizaciones de progreso en tiempo real y obtener resultados estructurados — todo sin salir de la conversación.

## Fase 5: Extensibilidad (v1.3)

**Qué cambió:** Sistema de plugins, integración con Planning Game y hardening de producción.

**Adiciones clave:**
- Sistema de plugins: `.karajan/plugins/*.js` para agentes custom
- Integración Planning Game MCP (enriquecimiento de cards, actualización de estados)
- Retry con backoff exponencial y jitter
- Limpieza de sesiones (auto-expirar sesiones antiguas)
- Automatización git (auto-commit, auto-push, auto-PR, auto-rebase)
- Cadena de fallback de reviewer (primario → fallback → Solomon)
- Overrides via variables de entorno (`KJ_HOME`, `KJ_SONAR_TOKEN`)

**Por qué:** Los usuarios necesitaban integrar Karajan en sus workflows existentes — gestión de proyectos (Planning Game), herramientas IA custom (plugins) y CI/CD (automatización git). El sistema de plugins fue particularmente importante: permite a cualquiera envolver su propia herramienta CLI como agente de Karajan sin modificar el código fuente.

## Fase 6: Resiliencia (v1.4)

**Qué cambió:** Detección automática y gestión de rate limits de agentes CLI, con fallback transparente a agentes alternativos.

**Adiciones clave:**
- Detección de rate limit: pattern matching en stderr/stdout del agente para todos los agentes soportados (Claude, Codex, Gemini, Aider)
- Pausa de sesión por rate limit en lugar de fallo — reanudar con `kj resume` cuando la ventana de tokens se restablezca
- Auto-fallback: cuando el coder primario alcanza un rate limit, cambiar automáticamente al agente de respaldo configurado
- Flag CLI `--coder-fallback` y opción de config `coder_options.fallback_coder`
- Tracking de checkpoints por cada intento de fallback

**Adición a la arquitectura:**
```
coder (primario) ──rate limit──→ coder (fallback) ──rate limit──→ pausa sesión
       │                              │
       ok                             ok
       ↓                              ↓
    continuar                      continuar
```

**Por qué:** Los agentes CLI con planes de suscripción (Claude Pro, Codex, etc.) pueden alcanzar sus límites de uso a mitad del pipeline. Antes esto causaba que la sesión fallara, perdiendo el progreso. Ahora Karajan detecta rate limits, prueba un agente alternativo, y solo pausa como último recurso — preservando el estado de la sesión para reanudación transparente.

## Fase 7: Selección Inteligente de Modelos (v1.5)

**Qué cambió:** Selección automática de modelo por rol basada en la complejidad del triage — modelos ligeros para tareas triviales, modelos potentes para tareas complejas.

**Adiciones clave:**
- Selección inteligente de modelos: el triage clasifica la complejidad (trivial/simple/medium/complex), luego `model-selector.js` mapea cada rol al modelo óptimo
- Tier map por defecto: trivial → haiku/flash/o4-mini, complex → opus/pro/o3
- Overrides por rol: el reviewer siempre usa al menos tier "medium" para calidad; el triage siempre usa modelos ligeros
- Los flags explícitos de CLI (`--coder-model`, `--reviewer-model`) siempre tienen prioridad sobre la selección automática
- Flags CLI: `--smart-models` / `--no-smart-models`
- Parámetro MCP: `smartModels` para `kj_run`
- Tiers y role overrides configurables por el usuario via `model_selection` en `kj.config.yml`

**Adición a la arquitectura:**
```
triage → level ("simple")
       → model-selector → { coder: "claude/haiku", reviewer: "claude/sonnet" }
       → config.roles.*.model rellenado (solo slots null — flags CLI ganan)
       → agentes pasan --model flag como siempre
```

**Por qué:** No todas las tareas merecen el modelo más potente (y lento). Un fix de typo no necesita Opus, y un refactor complejo no debería usar Haiku. La selección inteligente optimiza tres cosas: velocidad (modelos ligeros responden más rápido), calidad (tareas complejas obtienen modelos potentes) y consumo de cuota de tokens (modelos ligeros consumen menos de tu ventana de suscripción, reduciendo el riesgo de rate limit).

## Fase 8: Checkpoints Interactivos y Descomposición de Tareas (v1.6)

**Qué cambió:** Se reemplazó el timeout duro que mataba los procesos en ejecución por un sistema de checkpoints interactivos, y se añadió descomposición automática de tareas con integración Planning Game.

**Adiciones clave:**
- Checkpoints interactivos: cada 5 minutos (configurable con `--checkpoint-interval`), pausa la ejecución con un informe de progreso y pregunta al usuario si continuar (5 min más / hasta terminar / tiempo personalizado / parar)
- Solo aplica cuando `askQuestion` está disponible (MCP `kj_run`); los comandos subprocess (`kj_code`, `kj_review`) ejecutan sin timeout por defecto
- Descomposición de tareas en triage: analiza si la tarea debería dividirse, devolviendo `shouldDecompose` y `subtasks[]`
- Creación de subtareas en PG: cuando triage recomienda descomposición y hay una card de Planning Game vinculada, crea cards de subtareas con relaciones `blocks/blockedBy` en cadena
- El planner recibe contexto de descomposición, centrándose en la primera subtarea
- Enriquecimiento del body de PR con approach, pasos y subtareas pendientes como checkboxes
- Tracking de provider y modelo en todos los checkpoints de sesión

**Adición a la arquitectura:**
```
MCP kj_run:
  bucle de iteraciones
    ├── temporizador de checkpoint (cada N min)
    │     └── askQuestion → continuar / parar / ajustar
    ├── coder → sonar → reviewer
    └── siguiente iteración

Descomposición de triage:
  triage → shouldDecompose: true, subtasks: [...]
         → askQuestion("¿Crear subtareas en PG?")
         → PG API: createCard × N → relateCards (cadena blocks)
```

**Por qué:** El timeout duro era un instrumento brusco — mataba el proceso sin importar el progreso, perdiendo todo el trabajo. Los checkpoints interactivos dan control al usuario: ver qué se ha hecho, decidir si continuar y ajustar el timing. La descomposición de tareas evita sobrecargar una sola ejecución del pipeline con trabajo que debería ser múltiples tareas secuenciales.

## Fase 9: Handlers MCP In-Process (v1.7)

**Qué cambió:** Se movieron `kj_code`, `kj_review` y `kj_plan` de ejecución como subproceso a ejecución in-process dentro del servidor MCP, y se añadió reinicio automático basado en versión.

**Adiciones clave:**
- Ejecución in-process: `kj_code`, `kj_review`, `kj_plan` ahora se ejecutan dentro del proceso del servidor MCP (como `kj_run`), eliminando los timeouts de subproceso que mataban tareas vía SIGKILL
- Version watcher: `setupVersionWatcher` detecta cambios de versión en `package.json` tras `npm link`/`npm install` y termina limpiamente para que el host MCP reinicie con código fresco
- Verificación de versión por llamada como fallback del watcher
- Lecturas dinámicas de versión desde `package.json` en lugar de strings hardcoded

**Por qué:** El modelo de subproceso imponía un timeout vía execa que mataba los agentes a mitad de trabajo con SIGKILL. La ejecución in-process da a los agentes tiempo ilimitado — el orquestador gestiona el ciclo de vida, no el gestor de procesos. El version watcher resolvió un problema doloroso del desarrollo: el caching de módulos ESM hacía que el servidor MCP siguiera ejecutando código antiguo tras actualizaciones.

## Fase 10: Pipeline Stage Tracker (v1.8)

**Qué cambió:** Se añadió tracking acumulativo del progreso del pipeline — un único evento mostrando el estado completo de todas las stages tras cada transición.

**Adiciones clave:**
- Evento `pipeline:tracker` emitido tras cada transición de stage durante `kj_run`, con estado acumulativo (done/running/pending/failed) para todas las stages del pipeline
- Logging de progreso single-agent: `kj_code`, `kj_review`, `kj_plan` emiten logs de tracker start/end para que los hosts MCP puedan mostrar qué agente está activo
- Renderizado CLI: `kj run` muestra un cuadro acumulativo del pipeline con iconos de estado por stage
- `buildPipelineTracker(config, emitter)` construye la lista de stages desde la config y se auto-registra en el event emitter
- `sendTrackerLog(server, stageName, status, summary)` helper para handlers single-agent

**Adición a la arquitectura:**
```
Eventos del pipeline kj_run (antes de v1.8):
  coder:start → coder:end → sonar:start → sonar:end → reviewer:start → ...
  (el host debe reconstruir el estado desde eventos individuales)

Eventos del pipeline kj_run (v1.8+):
  coder:start → pipeline:tracker { stages: [{coder: running}, {sonar: pending}, ...] }
  coder:end   → pipeline:tracker { stages: [{coder: done}, {sonar: pending}, ...] }
  sonar:start → pipeline:tracker { stages: [{coder: done}, {sonar: running}, ...] }
  (el host recibe el estado completo en cada evento — sin reconstrucción necesaria)
```

**Por qué:** Los hosts MCP recibían eventos individuales `*:start`/`*:end` pero no tenían una vista acumulativa. Cada host tenía que mantener su propia máquina de estados para reconstruir el progreso del pipeline. El tracker centraliza esta lógica — un evento, un snapshot, cero gestión de estado en el host. Para herramientas single-agent (`kj_code`/`kj_review`/`kj_plan`), antes no había feedback de progreso; ahora los hosts ven logs de tracker start/end.

## Fase 11: Fiabilidad del Planner y Hardening del Ciclo de Vida MCP (v1.9 - v1.9.6)

**Qué cambió:** Se reforzó el comportamiento anti-cuelgue de `kj_plan` y se aclaró el ciclo de vida MCP durante actualizaciones.

**Adiciones clave:**
- Guardrails del planner reforzados y documentados: `session.max_agent_silence_minutes` y `session.max_planner_minutes` evitan ejecuciones de planificación silenciosas o descontroladas
- Mejor diagnóstico del planner en respuestas/logs MCP: categorías de fallo más claras y sugerencias accionables ante stalls/timeouts
- Hardening del ciclo de vida MCP en upgrades: los procesos obsoletos salen tras cambios de versión para que el host reconecte con código fresco en vez de mezclar versiones
- Guía operativa de troubleshooting para el escenario esperado de `Transport closed` tras actualizaciones
- Branch guard para herramientas MCP: `kj_run`, `kj_code` y `kj_review` rechazan la ejecución en la rama base para evitar diffs vacíos (v1.9.4)
- Compatibilidad del subprocess de Claude: elimina la variable `CLAUDECODE`, desvincula stdin y lee la salida estructurada de stderr donde Claude Code 2.x la escribe (v1.9.5-v1.9.6)

**Adición a la arquitectura:**
```
Sesión del host MCP (proceso antiguo)
    └─ cambia la versión del paquete
        └─ el karajan-mcp obsoleto finaliza
            └─ el host reconecta y levanta la versión nueva
```

**Por qué:** Los prompts largos de planificación pueden parecer "colgados" cuando un agente permanece en silencio demasiado tiempo, y las actualizaciones pueden dejar hosts MCP conectados a procesos obsoletos. v1.9.x también se enfocó en fiabilidad operativa: fallar rápido con diagnóstico útil y hacer predecible el ciclo de vida de procesos MCP tras cada bump de versión.

## Decisiones Arquitectónicas Clave

### CLI wrapping vs llamadas directas a API

Karajan envuelve CLIs existentes de agentes IA (claude, codex, gemini, aider) en lugar de llamar a APIs de proveedores IA directamente.

**Ventajas:**
- Usa tus suscripciones existentes — no necesitas API keys separadas
- Coste predecible — pagas la tarifa de tu plan, no por token
- Los agentes gestionan su propio contexto, uso de herramientas y características de seguridad
- Se actualiza automáticamente cuando actualizas el CLI

**Trade-offs:**
- Menos control granular sobre prompts y parámetros
- El tracking de costes es estimado, no facturación real
- El rate limiting es detectado por Karajan (v1.4+) con fallback automático y pausa de sesión

### Instrucciones de roles basadas en Markdown

Las instrucciones de roles (qué hacer, cómo revisar, qué reglas aplicar) se almacenan como ficheros `.md`, no hardcoded.

**Ventajas:**
- Los usuarios pueden sobreescribir cualquier rol sin tocar código
- Resolución a tres niveles: proyecto → usuario → built-in
- Fácil de versionar y compartir
- No-desarrolladores pueden modificar reglas de revisión

### Persistencia de sesiones en disco

Todo el estado de sesión se escribe en disco como ficheros JSON, no se mantiene en memoria.

**Ventajas:**
- Sobrevive a caídas y reinicios
- Permite pausa/reanudación entre sesiones
- Permite informes post-ejecución y audit trails
- Sin dependencia de base de datos

### Tracking de presupuesto estimado

El uso de tokens se cuenta y los costes se estiman usando tarifas publicadas, en lugar de consultar la facturación real de la API.

**Ventajas:**
- Funciona con agentes CLI que no exponen datos de facturación
- Proporciona comparación relativa de costes entre enfoques
- Permite guardarraíles de presupuesto (avisar al 80%, parar al 100%)

**Trade-off:** Los costes reportados son aproximados — útiles para comparación y guardarraíles, no para facturación.

## Referencias

- [jorgecasar/ai-orchestration](https://github.com/jorgecasar/legacy-s-end-2/tree/main/packages/ai-orchestration) — Patrones de arquitectura hexagonal (puertos y adaptadores) que influyeron en el diseño de adaptadores de agentes
- [ADR-001: Role-Based AI Architecture](/docs/es/architecture/overview/) — Architecture Decision Record en el repositorio de karajan-code
- [Model Context Protocol](https://modelcontextprotocol.io/) — El estándar usado para la integración del servidor MCP de Karajan

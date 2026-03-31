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
- 13 roles configurables: discover, triage, researcher, architect, planner, coder, refactorer, sonar, reviewer, tester, security, solomon, commiter
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

## Fase 12: Gestión de Agentes en Runtime y Resiliencia de Sesiones (v1.10.0)

**Qué cambió:** Se añadió intercambio de agentes en runtime por rol del pipeline, se amplió la reanudabilidad de sesiones y se reforzó la fiabilidad de subprocesos.

**Adiciones clave:**
- Herramienta MCP `kj_agents` y comando CLI `kj agents`: listar o cambiar el agente IA por rol del pipeline al vuelo (`kj agents set coder gemini`), se persiste en `kj.config.yml`, sin necesidad de reinicio
- Resiliencia de checkpoints: una respuesta null/vacía de `elicitInput` se interpreta como "continuar 5 min" en lugar de matar la sesión
- `kj_resume` ampliado: ahora acepta sesiones detenidas y fallidas, no solo pausadas
- Restricciones de subproceso: el prompt del coder indica al agente que es no-interactivo — usar flags `--yes`/`--no-input` o reportar incapacidad
- Versión en `kj doctor`: muestra la versión de Karajan Code como primera línea de verificación
- 1084 tests en total
- Planning Game auto-status (v1.10.1): cuando `kj_run` tiene un `pgTaskId`, marca automáticamente la card como "In Progress" al iniciar y "To Validate" al completar — funciona desde CLI y MCP
- 1090 tests en total (v1.10.1)

**Adición a la arquitectura:**
```
kj agents set coder gemini
    └─ actualiza kj.config.yml (roles.coder.agent = "gemini")
    └─ el siguiente kj_run / kj_code usa el nuevo agente — sin reinicio MCP

kj_resume (v1.10.0):
    sesiones pausadas   ──→ reanudar (como antes)
    sesiones detenidas  ──→ reanudar (nuevo)
    sesiones fallidas   ──→ reanudar (nuevo)
```

**Por qué:** Los usuarios necesitaban cambiar de agente a mitad de sesión sin reiniciar el servidor MCP ni editar ficheros de config manualmente. El `kj_resume` ampliado significa que las sesiones que se detuvieron o fallaron por problemas transitorios (rate limits, errores de red) pueden recuperarse en lugar de abandonarse. Las restricciones de subproceso evitan que los agentes se queden colgados en prompts interactivos que nunca recibirán input.

## Fase 13: Inteligencia de Pipeline y Soberanía Humana (v1.11.0)

**Qué cambió:** Transformación de un ejecutor pasivo de pipeline a un orquestador inteligente con gobernanza human-first. Triage, tester, security y Solomon ahora están activos por defecto. El preflight handshake impide que los agentes IA sobreescriban decisiones de configuración humanas.

**Adiciones clave:**
- Triage como director de pipeline: analiza la complejidad de la tarea y devuelve JSON con decisiones de activación de roles
- Tester y security activos por defecto — cada tarea se testea y audita
- Solomon supervisor: se ejecuta tras cada iteración con 4 reglas (max_files, stale_iterations, dependency_guard, scope_guard), pausa ante alertas críticas
- Preflight handshake (`kj_preflight`): confirmación humana obligatoria antes de `kj_run`/`kj_code` — bloquea a la IA de cambiar agentes silenciosamente
- Config de agentes por sesión: `kj_agents` via MCP usa scope de sesión (en memoria), CLI usa scope de proyecto
- Merge de config en 3 niveles: DEFAULTS < global (`~/.karajan/`) < proyecto (`.karajan/`)
- Standby por rate-limit con auto-retry: parsea cooldown de 5 patrones de error, espera con backoff exponencial (5min default, 30min max), emite eventos standby/heartbeat/resume, máximo 5 reintentos antes de pausa humana
- MCP progress streaming extendido a `kj_code`, `kj_review`, `kj_plan` (antes solo `kj_run`)
- `kj_status` mejorado: resumen de estado parseado (currentStage, currentAgent, iteration, isRunning, errors)
- `kj-tail` con tracking resiliente usando `tail -F`
- 1180 tests en 106 ficheros

**Adición a la arquitectura:**
```
Antes de v1.11.0:
  IA llama kj_run(coder: "codex") → Karajan ejecuta codex, sin preguntas

Después de v1.11.0:
  IA llama kj_run → BLOQUEADO (preflight requerido)
  IA llama kj_preflight → muestra config al humano → humano dice "ok" o ajusta
  IA llama kj_run → triage evalúa tarea → activa roles → coder → check solomon → reviewer → tester → security

Standby por rate-limit:
  coder alcanza rate limit → parsea cooldown → espera (backoff) → reintenta misma iteración
  5 reintentos consecutivos → pausa para humano

Solomon supervisor:
  tras cada iteración → evalúa 4 reglas → warning/critical
  critical → pausa + preguntar humano via elicitInput
```

**Por qué:** Ejecutar código generado por IA sin tests ni auditoría de seguridad era inaceptable. Triage como director asegura que los roles correctos se activen según la complejidad de cada tarea. El preflight handshake resolvió un problema fundamental de confianza: cuando un agente IA pasa `coder: "codex"` a `kj_run`, no había forma de saber si el humano lo eligió o la IA decidió por su cuenta. Ahora el humano confirma o ajusta explícitamente antes de que nada se ejecute.

## Fase 14: Mediación Inteligente del Reviewer (v1.12.0)

**Qué cambió:** El reviewer ya no bloquea el pipeline cuando reporta issues fuera de scope. Solomon media los stalls del reviewer en lugar de detener la sesión inmediatamente.

**Adiciones clave:**
- Scope filter del reviewer: analiza cada issue reportado y compara los ficheros afectados con el diff real de la iteración. Los issues sobre ficheros fuera de scope se auto-difieren en vez de bloquear
- Tracking de issues diferidos: los issues fuera de scope se registran como deuda técnica en la sesión y se inyectan en el prompt del coder en iteraciones posteriores
- 5ª regla Solomon `reviewer_overreach`: detecta cuando el reviewer reporta issues en ficheros no presentes en el diff
- Mediación de stalls del reviewer: Solomon interviene ante bloqueos del reviewer evaluando la situación antes de escalar al humano
- Campo `deferredIssues` en el resultado de sesión para rastrear deuda técnica generada durante la ejecución

**Adición a la arquitectura:**
```
Antes de v1.12.0:
  reviewer reporta issue en fichero fuera de diff → coder intenta arreglar → scope creep → stall
  reviewer se estanca → pipeline se detiene inmediatamente

Después de v1.12.0:
  reviewer reporta issue fuera de diff → scope filter lo auto-difiere → pipeline continúa
  issues diferidos → se inyectan en prompt del coder como contexto → deuda técnica rastreada
  reviewer se estanca → Solomon media → evalúa situación → continúa o escala
```

**Por qué:** Los reviewers frecuentemente reportan issues legítimos en ficheros que no forman parte del cambio actual. Antes esto provocaba scope creep — el coder intentaba arreglar ficheros que no debía tocar, generando más cambios fuera de scope y estancando el pipeline. El scope filter resuelve esto diferiendo automáticamente esos issues sin perderlos: se registran como deuda técnica y se comunican al coder como contexto para futuras iteraciones. La mediación de Solomon ante stalls del reviewer añade una capa de inteligencia antes de la intervención humana, reduciendo las pausas innecesarias del pipeline.

## Fase 15: BecarIA Gateway (v1.13.0)

**Qué cambió:** Integración CI/CD completa con GitHub PRs como fuente única de verdad. Todos los agentes del pipeline ahora publican sus resultados directamente en las PRs, y el pipeline crea PRs de forma temprana en el proceso.

**Adiciones clave:**
- BecarIA Gateway: las GitHub PRs se convierten en el punto central de coordinación para todos los agentes
- Creación temprana de PR: se crea una PR en borrador tras la primera iteración del coder
- Comentarios/reviews de agentes en PRs: todos los agentes (Coder, Reviewer, Sonar, Solomon, Tester, Security, Planner) publican resultados como comentarios o reviews en la PR
- Dispatch events configurables via sección `becaria` del config — disparan workflows de GitHub Actions en cada etapa del pipeline
- `kj review` standalone con soporte de diff de PR — utilizable como herramienta de code review independiente
- Workflow templates embebidos: `kj init --scaffold-becaria` genera `becaria-gateway.yml`, `automerge.yml`, `houston-override.yml`
- Verificaciones BecarIA en `kj doctor`: comprueba que los workflow templates están presentes y que el token de GitHub tiene los permisos necesarios
- Flag CLI `--enable-becaria` y parámetro MCP `enableBecaria`

**Adición a la arquitectura:**
```
Antes de v1.13.0 (pipeline local):
  coder → sonar → reviewer → commiter → creación manual de PR

Después de v1.13.0 (BecarIA Gateway):
  coder (iteración 1) → crear PR en borrador
  coder → publicar comentario en PR
  sonar → publicar comentario en PR
  reviewer → publicar review en PR
  solomon → publicar comentario en PR
  tester → publicar comentario en PR
  security → publicar comentario en PR
  dispatch events → workflows de GitHub Actions

kj init --scaffold-becaria:
  → .github/workflows/becaria-gateway.yml
  → .github/workflows/automerge.yml
  → .github/workflows/houston-override.yml
```

**Por qué:** Los pipelines solo locales requerían pasos manuales para conectar el código generado por IA con la colaboración en equipo. Las PRs son el punto natural de colaboración para code review y CI/CD, pero crearlas era un paso manual posterior. BecarIA Gateway convierte las PRs en el punto de integración de primera clase: los agentes publican sus hallazgos donde el equipo ya trabaja, los dispatch events disparan workflows CI/CD existentes, y la creación temprana de PR asegura visibilidad desde la primera iteración. Esto transforma Karajan de un orquestador local a un pipeline consciente de CI/CD que se integra sin fricciones con workflows basados en GitHub.

## Fase 16: Pipeline Dirigido por Politicas (v1.14.0)

**Que cambio:** El pipeline ahora activa o desactiva stages dinamicamente segun el tipo de tarea, reemplazando el enfoque unico para todo con configuracion dirigida por politicas.

**Adiciones clave:**
- Nuevo modulo `src/guards/policy-resolver.js`: mapea cada `taskType` a un conjunto de politicas de pipeline (tdd, sonar, reviewer, testsRequired)
- 5 tipos de tarea integrados: `sw` (software), `infra`, `doc`, `add-tests`, `refactor` — cada uno con sus defaults de stages apropiados
- Overrides de config via seccion `policies` en `kj.config.yml` — los proyectos pueden personalizar que stages aplican por tipo de tarea
- El orquestador aplica gates de politicas con inmutabilidad de config: copias superficiales aseguran que la configuracion del llamante nunca se muta
- Evento `policies:resolved` emitido tras la resolucion, permitiendo a los consumidores downstream reaccionar al conjunto de politicas activo
- `taskType` desconocido o ausente aplica `sw` por defecto (la configuracion mas conservadora)
- Triage obligatorio con clasificacion de taskType (v1.15.0)
- Parametro CLI/MCP `--taskType` para override explicito
- Cadena de integracion triage → policy-resolver

**Adicion a la arquitectura:**
```
Antes de v1.14.0:
  kj_run → todas las stages activadas segun config estatica
  tarea infra → check TDD falla → pipeline se estanca en gate irrelevante

Despues de v1.14.0:
  kj_run(taskType: "infra") → policy-resolver → { tdd: false, sonar: false, reviewer: true }
  kj_run(taskType: "sw")    → policy-resolver → { tdd: true, sonar: true, reviewer: true }
  kj_run(taskType: null)    → policy-resolver → defaults to "sw" (mas conservador)

Flujo de override:
  defaults integrados → merge con seccion policies de kj.config.yml → copia superficial → aplicar gates
```

**Por que:** No todas las tareas se benefician de las mismas stages del pipeline. Ejecutar checks TDD en tareas de infraestructura (configs CI, Dockerfiles) o tareas de documentacion produce falsos positivos y desperdicia tiempo. Ejecutar SonarQube en cambios de documentacion pura no tiene sentido. El policy-resolver permite al pipeline adaptar sus quality gates a la naturaleza del trabajo, mientras aplica por defecto el perfil mas conservador (`sw`) cuando el tipo de tarea es desconocido — asegurando seguridad sin sacrificar flexibilidad.

## Fase 17: Discovery Pre-Ejecución (v1.16.0)

**Qué cambió:** Se añadió un nuevo stage de discovery pre-pipeline que analiza las especificaciones de tareas buscando gaps, ambigüedades e información faltante antes de escribir código. Cinco modos de discovery especializados proporcionan diferentes lentes de validación.

**Adiciones clave:**
- `DiscoverRole` extendiendo `BaseRole` — 12º rol configurable del pipeline (ahora 13 con architect)
- 5 modos de discovery: `gaps` (detección de gaps por defecto), `momtest` (preguntas de validación Mom Test), `wendel` (checklist de adopción de cambio de comportamiento), `classify` (clasificación START/STOP/DIFFERENT), `jtbd` (generación de Jobs-to-be-Done)
- Herramienta MCP `kj_discover` para detección de gaps independiente fuera del pipeline
- Integración en pipeline: stage pre-triage opt-in via flag `--enable-discover` o config `pipeline.discover.enabled`
- Ejecución no bloqueante: los fallos de discovery registran warnings y el pipeline continúa
- Constructor de prompts con secciones específicas por modo y enforcement de JSON schema
- Parser de output con validación de campos, normalización de severidad y filtrado de entradas incompletas

**Adición a la arquitectura:**
```
Antes de v1.16.0:
  kj_run → triage → researcher? → planner? → coder → ...

Después de v1.16.0:
  kj_run → discover? → triage → researcher? → planner? → coder → ...

  discover (modo gaps):
    spec tarea → identificar gaps, ambigüedades, asunciones → verdict: ready | needs_validation
    → gaps[]: { id, description, severity, suggestedQuestion }

  discover (modo momtest):
    spec tarea → gaps + preguntas Mom Test (comportamiento pasado, no hipotéticos)
    → momTestQuestions[]: { gapId, question, targetRole, rationale }

  discover (modo wendel):
    spec tarea → 5 condiciones de cambio de comportamiento (CUE, REACTION, EVALUATION, ABILITY, TIMING)
    → wendelChecklist[]: { condition, status: pass|fail|unknown, justification }

  discover (modo classify):
    spec tarea → tipo de cambio de comportamiento (START, STOP, DIFFERENT, not_applicable)
    → classification: { type, adoptionRisk, frictionEstimate }

  discover (modo jtbd):
    spec tarea + contexto → Jobs-to-be-Done reforzados
    → jtbds[]: { id, functional, emotionalPersonal, emotionalSocial, behaviorChange, evidence }

Standalone:
  kj_discover(task, mode) → output de discovery estructurado (sin ejecución de pipeline)
```

**Por qué:** El código generado por IA es tan bueno como su especificación de entrada. Cuando las tareas son ambiguas o incompletas, el agente coder hace asunciones que pueden no coincidir con la intención del stakeholder — generando ciclos de retrabajo. El stage de discovery detecta estos gaps antes de escribir código, cuando el coste de clarificación es mínimo. Los cinco modos proporcionan diferentes lentes de validación: `gaps` para completitud técnica, `momtest` para validación con stakeholders, `wendel` para preparación para la adopción, `classify` para evaluación del impacto del cambio, y `jtbd` para entender las necesidades subyacentes del usuario. Discovery es opt-in y no bloqueante para evitar añadir fricción a tareas bien definidas.

## Fase 18: Diseño Arquitectónico y Calidad de Código (v1.17.0)

**Qué cambió:** Se añadió un nuevo rol de diseño arquitectónico pre-construcción y se resolvieron todos los issues de SonarQube del codebase, reduciendo la complejidad cognitiva de 345 a 15 en el orquestador principal.

**Adiciones clave:**
- ArchitectRole: 13º rol configurable del pipeline que diseña la arquitectura de la solución (capas, patrones, modelo de datos, contratos API, tradeoffs) entre researcher y planner
- Pausa interactiva de arquitectura: el pipeline se pausa con preguntas específicas cuando el architect detecta ambigüedad de diseño (`verdict: "needs_clarification"`)
- Generación automática de ADRs: los tradeoffs arquitectónicos se persisten automáticamente como Architecture Decision Records en Planning Game
- Activación triage → architect: triage auto-activa architect según complejidad, alcance y ambigüedad de diseño
- Planner architectContext: el planner genera pasos de implementación alineados con las decisiones arquitectónicas
- Limpieza completa de SonarQube: 205 issues → 0 (CRITICAL, MAJOR, MINOR)
- Refactorización de complejidad cognitiva: orchestrator.js (345→15), display.js (134→2), server-handlers.js (101→3), config.js (55→10)
- Mapas de dispatch: reemplazo de switch/if-else grandes por patrones de dispatch con objetos
- 1454 tests en 118 ficheros

**Adición a la arquitectura:**
```
Antes de v1.17.0:
  kj_run → discover? → triage → researcher? → planner? → coder → ...

Después de v1.17.0:
  kj_run → discover? → triage → researcher? → architect? → planner? → coder → ...

  architect:
    task + researchContext + discoverResult → diseñar arquitectura
    → verdict: "ready" → architectContext pasado al planner
    → verdict: "needs_clarification" → askQuestion → respuesta humana → re-evaluar
    → tradeoffs[] → crear ADRs en Planning Game (si hay card PG vinculada)

  Complejidad cognitiva antes/después:
    orchestrator.js:  345 → 15 (extraídas 24+ funciones helper)
    display.js:       134 →  2 (mapa dispatch EVENT_HANDLERS)
    server-handlers:  101 →  3 (mapa dispatch toolHandlers)
    config.js:         55 → 10 (mapas declarativos de flags)
```

**Por qué:** El pipeline tenía un hueco entre entender (researcher) y planificar (planner): nadie tomaba decisiones arquitectónicas. El coder se veía obligado a tomar decisiones de diseño sobre la marcha — límites de capas, modelos de datos, contratos API, tradeoffs tecnológicos — sin validación. Esto generaba rework cuando las decisiones no coincidían con las expectativas del stakeholder. El rol architect llena este hueco produciendo decisiones de diseño explícitas y revisables antes de escribir código. La limpieza de SonarQube fue igualmente importante: la complejidad cognitiva había crecido sin control a medida que el orquestador evolucionó a través de 17 fases. La refactorización reemplazó funciones monolíticas por helpers componibles y mapas de dispatch, haciendo el codebase mantenible a medida que sigue creciendo.

## Fase 19: Capa de Guards Deterministas (v1.18.0)

**Qué cambió:** Se añadió una capa de validación basada en regex/patrones que complementa las decisiones probabilísticas del LLM con comprobaciones deterministas. Tres guards ejecutan en distintas etapas del pipeline.

**Adiciones clave:**
- **Output guard**: escanea diffs de git buscando operaciones destructivas (rm -rf, DROP TABLE, git push --force, formateo de disco), credenciales expuestas (claves AWS, claves privadas, tokens GitHub/npm) y modificaciones a ficheros protegidos (.env, serviceAccountKey.json). Bloquea el pipeline ante violaciones críticas. Patrones custom y ficheros protegidos configurables via `guards.output`.
- **Perf guard**: escanea diffs de ficheros frontend (.html, .css, .jsx, .tsx, .astro, .vue, .svelte) buscando anti-patrones de rendimiento — imágenes sin dimensiones/lazy loading, scripts bloqueantes, font-display ausente, document.write, dependencias pesadas (moment, lodash, jquery). Modo advisory por defecto, configurable para bloquear via `guards.perf.block_on_warning`.
- **Intent classifier**: pre-triage determinista basado en keywords. Clasifica tareas obvias (doc, add-tests, refactor, infra, trivial-fix) sin coste LLM. Se ejecuta antes de discover/triage en pre-loop. Patrones custom con umbral de confianza configurable via `guards.intent`.
- Schema de configuración de guards en `kj.config.yml` con patrones custom, ficheros protegidos y umbrales
- 1505 tests en 121 ficheros

**Adición a la arquitectura:**
```
Antes de v1.18.0:
  kj_run → discover? → triage → researcher? → architect? → planner? → [coder → refactorer? → TDD → sonar → reviewer]

Después de v1.18.0:
  kj_run → intent? → discover? → triage → researcher? → architect? → planner? → [coder → refactorer? → guards → TDD → sonar → reviewer]

  capa de guards:
    output-guard: diff → buscar ops destructivas + leaks de credenciales + ficheros protegidos
    perf-guard:   diff → buscar anti-patrones de rendimiento en ficheros frontend
    intent-guard: descripción de tarea → clasificación por keywords → saltar triage LLM para tipos obvios
```

**Por qué:** La validación basada en LLM (reviewer, triage) es potente pero probabilística — puede pasar por alto patrones obvios o generar falsos negativos. Los guards deterministas proporcionan una primera línea de defensa rápida, sin coste y 100% fiable para anti-patrones bien definidos. El output guard previene errores catastróficos (borrar ficheros, filtrar credenciales). El perf guard detecta problemas comunes de rendimiento frontend que los LLMs suelen ignorar (CLS por imágenes sin dimensiones, scripts bloqueantes). El intent classifier ahorra llamadas LLM para tareas que obviamente son documentación, tests o refactoring — reduciendo latencia y coste. Los tres son configurables con patrones custom, haciéndolos extensibles sin cambios de código.

**Futuro: WebPerf Quality Gate** — El perf guard estático es la primera fase de un quality gate de WebPerf planificado. La segunda fase integrará escaneo dinámico de rendimiento usando headless Chrome, inspirado en los [WebPerf Snippets](https://webperf-snippets.nucliweb.net/) de [Joan León](https://joanleon.dev/) — una colección de snippets de medición de rendimiento para Core Web Vitals, carga de recursos y análisis en tiempo de ejecución. Joan está actualmente desarrollando un CLI para esto; una vez disponible, se integrará como scanner de rendimiento post-loop, complementando el guard estático con métricas reales de runtime.

## Fase 20: Auditor de Diseño Impeccable (v1.24.0)

**Qué cambió:** Se añadió un quality gate automatizado de UI/UX que audita ficheros frontend modificados buscando problemas de diseño, y se mejoró el triage y el intent classifier con detección de frontend.

**Adiciones clave:**
- **Rol impeccable**: 14º rol configurable del pipeline — auditor de diseño automatizado que revisa ficheros frontend modificados buscando problemas de accesibilidad, rendimiento, theming, responsive y anti-patrones. Se ejecuta después de SonarQube, antes del reviewer. Aplica correcciones automáticamente.
- Detección de frontend en triage: el triage ahora identifica tareas frontend y auto-activa el rol impeccable cuando es apropiado
- Detección de frontend en intent classifier: clasificación determinista basada en keywords sin coste LLM
- Flag `enableImpeccable` en config/CLI/MCP para activación explícita
- Flag CLI `--enable-impeccable` para `kj run`
- Parámetro MCP `enableImpeccable` para `kj_run`
- 1586 tests en 130 ficheros

**Adición a la arquitectura:**
```
Antes de v1.24.0:
  [coder → refactorer? → guards → TDD → sonar? → reviewer]

Después de v1.24.0:
  [coder → refactorer? → guards → TDD → sonar? → impeccable? → reviewer]

  impeccable:
    ficheros frontend modificados → auditar a11y, rendimiento, theming, responsive, anti-patrones
    → auto-corregir issues → reportar issues restantes al reviewer
```

**Por qué:** SonarQube detecta problemas de calidad de código pero no problemas de diseño UI/UX — ratios de contraste incorrectos, atributos aria ausentes, layouts no responsive, colores hardcoded en lugar de tokens de tema, layout shifts por imágenes sin dimensiones. El rol impeccable llena este hueco con una auditoría de diseño especializada centrada exclusivamente en calidad frontend. Se ejecuta después de SonarQube (que maneja calidad de código) y antes del reviewer (que maneja lógica y arquitectura), dando al reviewer un diff más limpio en el que centrarse. El triage lo auto-activa para tareas frontend para que los desarrolladores no necesiten recordar el flag.

## Fase 20.1: Overrides de Sesión y Bloqueos Solomon por Estilo (v1.24.1)

**Qué cambió:** Se corrigieron dos problemas — overrides de sesión perdidos al reanudar, y Solomon no detectando bloqueos del reviewer solo por estilo.

**Correcciones clave:**
- Los overrides de sesión (asignaciones de agentes, flags) ahora se preservan al reanudar una sesión via `kj_resume`
- Solomon Regla 6: detecta cuando un reviewer bloquea exclusivamente por issues de estilo/formato (no lógica ni corrección) y auto-escala a revisión humana en lugar de bloquear el pipeline

**Por qué:** Los overrides de sesión establecidos via `kj_preflight` se perdían al reanudar, causando que las sesiones reanudadas revirtieran a la configuración por defecto. Las reglas existentes de Solomon detectaban problemas de scope y overreach pero no un patrón de bloqueo común: reviewers bloqueando por cuestiones exclusivamente de estilo (nombrado, formateo, estilo de comentarios) que son subjetivas y poco probables de converger mediante iteración automatizada.

## Fase 21: Orquestador Autónomo (v1.25.0)

**Qué cambió:** Solomon se convierte en el Pipeline Boss que evalúa cada rechazo del reviewer con lógica de iteración inteligente. El pipeline auto-detecta TDD y auto-gestiona SonarQube, reduciendo la configuración a casi cero para proyectos estándar.

**Adiciones clave:**
- **Solomon como Pipeline Boss**: evalúa cada rechazo del reviewer, clasifica issues como críticos vs. solo estilo, puede anular bloqueos por estilo. Control inteligente de iteraciones que decide si reintentar o continuar según la clasificación de issues
- **Auto-detección de TDD**: el pipeline detecta el framework de tests del proyecto (Vitest, Jest, Mocha, etc.) y activa la metodología TDD automáticamente — no necesita flag `--methodology`
- **SonarQube auto-manage**: arranca el contenedor Docker automáticamente, auto-genera `sonar-project.properties` si falta, trata resultados solo de cobertura como advisory (no bloqueante)
- **Omitir sonar/TDD para tareas infra/doc**: el policy-resolver ahora omite SonarQube y TDD para tareas de infraestructura y documentación automáticamente, reduciendo falsos positivos
- 1605 tests en 130 ficheros

**Adición a la arquitectura:**
```
Antes de v1.25.0:
  reviewer rechaza → coder reintenta (mismo enfoque) → reviewer rechaza otra vez → stall

Después de v1.25.0:
  reviewer rechaza → Solomon evalúa el rechazo
    → issues críticos → coder reintenta con feedback dirigido
    → issues solo de estilo → Solomon anula, pipeline continúa
    → issues mixtos → coder reintenta solo los críticos, estilo diferido

Auto-detección TDD:
  proyecto tiene vitest/jest/mocha → methodology = "tdd" (auto)
  proyecto sin test runner → methodology = "standard" (auto)
  flag --methodology → siempre gana (override explícito)

SonarQube auto-manage:
  sonar activado + Docker no corriendo → auto-arrancar contenedor
  sonar activado + sin fichero config → auto-generar sonar-project.properties
  resultado sonar = solo cobertura → advisory (no bloqueante)
```

**Por qué:** El pipeline se estaba volviendo cada vez más autónomo pero aún requería configuración manual para la metodología TDD y el setup de SonarQube. La evolución de Solomon de supervisor a Pipeline Boss aborda un cuello de botella clave: rechazos del reviewer que bloquean el pipeline por cuestiones de estilo mientras los issues críticos se pierden en el ruido. Auto-detectar TDD y auto-gestionar SonarQube elimina los dos puntos de fricción de configuración más comunes, haciendo el pipeline verdaderamente zero-config para proyectos estándar.

### v1.25.1: Pipeline Auto-Simplify

Pipeline auto-simplify: triage nivel 1-2 (trivial/simple) ejecuta un flujo ligero solo con coder, omitiendo reviewer, tester y otras etapas post-coder. Nivel 3+ (medio/complejo) ejecuta el pipeline completo. Configurable via flag CLI `--no-auto-simplify` o parámetro MCP `autoSimplify: false`.

### v1.25.2: Guardarraíl Anti-Bypass

**v1.25.2** — Guardarraíl anti-bypass para `kj_resume`: valida respuestas contra patrones de inyección de prompts, rechaza inputs demasiado largos, truncamiento defensivo. 36 tests nuevos.

### v1.25.3: Resiliencia ante Caídas del Proveedor

**v1.25.3** — Resiliencia ante caídas del proveedor: errores 500/502/503/504 y de conexión ahora activan standby y reintento automático (igual que los rate limits). Al resumir tras una caída, se informa explícitamente al coder de que fue un fallo externo del proveedor, no un problema del código ni de KJ.

## Fase 22: Integración RTK (v1.27.0)

**v1.27.0** — Integración RTK: `kj doctor` detecta RTK para ahorro de 60-90% en tokens, `kj init` recomienda instalación, README y docs actualizados con RTK como herramienta complementaria recomendada.

**v1.27.1** — Corrección resolución de directorio del proyecto MCP: todos los tools MCP aceptan parámetro `projectDir` explícito. Orden de resolución: parámetro explícito > MCP roots > validación de cwd > error con instrucciones (sin fallback silencioso).

## Fase 23: Auditoría de Salud del Codebase (v1.28.0)

**Fase 23: Auditoría de Salud del Codebase (v1.28.0)** — Nuevo comando `kj audit` para análisis de solo lectura del codebase. Analiza 5 dimensiones: seguridad, calidad de código (SOLID/DRY/KISS/YAGNI), rendimiento, arquitectura y testing. Disponible como CLI, herramienta MCP (`kj_audit`) y skill (`/kj-audit`). Genera informes estructurados con puntuaciones A-F por dimensión y recomendaciones priorizadas.

## Fase 24: Refactor de Calidad del Codebase (v1.29.0)

**v1.29.0** — Refactor de calidad del código impulsado por auto-auditoría: objeto PipelineContext reemplaza destructuring de 15+ parámetros, handlers MCP reducidos 151 líneas via `runDirectRole()` compartido, lógica de Planning Game extraída a adaptador event-driven, 105 tests unitarios nuevos para agentes, vulnerabilidades npm parcheadas.

## Fase 25: HU Reviewer (v1.30.0)

**v1.30.0** — Nuevo stage obligatorio en el pipeline para certificacion de historias de usuario. Puntua 6 dimensiones de calidad (0-10 cada una, umbral 40/60), detecta 7 antipatrones, reescribe HUs debiles, pausa para contexto FDE cuando es necesario. Soporta grafos de dependencias con ordenacion topologica de ejecucion. Almacenamiento local en ficheros con patron adapter para el futuro.

## Fase 26: Auditoría Obligatoria Post-Aprobación (v1.32.0)

**v1.32.0** — Auditoría obligatoria post-aprobación: quality gate final que se ejecuta después de que reviewer+tester+security aprueben. Comprueba el código generado buscando issues críticos/altos — si los encuentra, devuelve al coder para corregir. Si está limpio, el pipeline queda CERTIFICADO. También: modo silencioso por defecto (output crudo de agentes suprimido), decisiones autónomas de Solomon (checkpoints auto-continúan, tester/security como advisory), prompt readline inline en CLI, presupuesto N/A cuando el proveedor no reporta uso.

## Fase 27: Contexto de Producto y AC Multi-Formato (v1.33.0)

**v1.33.0** — Contexto de producto via `.karajan/context.md`: los proyectos pueden definir conocimiento de dominio, glosario y restricciones que se inyectan en el prompt de cada rol del pipeline. Criterios de aceptacion multi-formato: soporta Gherkin (Given/When/Then), Checklist, Pre/Post-condiciones e Invariantes — auto-detectado desde el input de la tarea. Integracion automatica de RTK: cuando RTK esta instalado, Karajan auto-configura la optimizacion de tokens sin setup manual. Contenedorizacion del architect: las salidas del rol architect ahora se aislan en contenedores estructurados para un handoff mas limpio al planner.

## Fase 28: Dashboard HU Board (v1.34.0)

**v1.34.0** — HU Board: dashboard web full-stack para visualizar datos de HU (historias de usuario) y sesiones del pipeline en todos los proyectos. Tablero kanban con drag-and-drop, timeline de sesiones con superposicion de puntuaciones de calidad, filtrado multi-proyecto. Despliegue listo para Docker con auto-sincronizacion desde ficheros locales de sesion y HU en `.karajan/`. Aplicacion standalone que lee los datos locales de Karajan y los presenta en una interfaz web.

### v1.34.1: Correcciones de Fiabilidad

**v1.34.1** — 5 correcciones de fiabilidad: auto-preflight para inicio del pipeline sin fricciones, parser JSON robusto que maneja output malformado de agentes, capa de compatibilidad de modelos para nombres de modelos entre proveedores, estimacion de presupuesto con fallback para modelos desconocidos, y prompt no-placeholder del coder que evita que los agentes dejen stubs TODO.

### v1.34.2: Integración HU Board en CLI y MCP

**v1.34.2** — HU Board integrado en CLI (`kj board start/stop/status/open`), MCP (herramienta `kj_board` para start/stop/status), wizard de init (activar HU Board durante `kj init`), opcion de auto-start (el board arranca automaticamente con `kj run`), y soporte de modo skills.

### v1.34.3: Refactor de complejidad cognitiva

**v1.34.3** — Reduccion de complejidad cognitiva en 6 ficheros core. Cero tests saltados, 44 nuevos tests de backend del board.

### v1.34.4: Instalacion multiplataforma

**v1.34.4** — Comandos de instalacion adaptados al SO: macOS usa brew, Linux usa curl/apt/pipx. Las instrucciones de instalacion de agentes se adaptan a la plataforma del usuario.

## Fase 29: Bootstrap Gate (v1.35.0)

**v1.35.0** — Bootstrap gate obligatorio para todas las herramientas KJ: valida prerequisitos (repo git, remote, config, agentes, SonarQube) antes de ejecutar cualquier herramienta. Falla con instrucciones claras, nunca degrada silenciosamente. Eliminadas credenciales por defecto admin/admin de SonarQube (fix de seguridad).

### v1.36.0: Metricas de uso reales y kj-tail

**v1.36.0** — Extraccion de metricas de uso reales de CLIs de Claude y Codex. `kj doctor` valida ficheros de configuracion de agentes (JSON, TOML, YAML). Fallback de modelos resiliente y contexto de conflicto en Solomon. Nombre del stage en mensajes de heartbeat/stall de agentes.

**v1.36.1** — `kj-tail` como comando CLI instalable con `--help` y filtrado. Documentacion de tres formas de usar Karajan: CLI, MCP, kj-tail. Ejemplo completo de pipeline con API de booking. Info de ejecutor en todos los eventos de stages del pipeline (proveedor, AI/skill/local).

## Fase 30: Injection Guard (v1.37.0)

**v1.37.0** — Injection Guard: escáner de inyección de prompts para diffs y PRs revisados por IA. Escanea diffs antes de pasarlos a los reviewers IA, detectando directivas override ("ignore previous instructions"), caracteres Unicode invisibles (zero-width spaces, bidi overrides) y payloads de comentarios sobredimensionados. Se ejecuta como guard determinista en el pipeline (antes del stage de reviewer) y como GitHub Action standalone en cada PR.

## Fase 31: Gestor Integrado de HUs (v1.38.0)

**v1.38.0** — Gestor Integrado de HUs: el triage auto-activa hu-reviewer para tareas medias/complejas, descomposición por IA en 2-5 HUs formales con dependencias, ejecución de sub-pipeline por HU con tracking de estado (pending→coding→reviewing→done/failed/blocked), adaptador PG alimenta datos de card al hu-reviewer, registros de historial para todas las ejecuciones del pipeline. 49 tests nuevos.

### v1.38.1: Herramienta kj_hu, TDD Multi-Lenguaje, Mensajes Legibles de Solomon

**v1.38.1** — Nueva herramienta MCP `kj_hu` para gestionar historias de usuario (crear, actualizar, listar, obtener) directamente desde el HU Board. Soporte TDD multi-lenguaje: 12 lenguajes además de JS/TS (Java, Python, Go, Rust, C#, Ruby, PHP, Swift, Dart, Kotlin). Mensajes legibles de Solomon para decisiones de pipeline más claras. Corrección del token de Sonar para manejo seguro de credenciales. Soberanía MCP: las herramientas rechazan intentos de override externo, preservando la configuración confirmada por el humano. 2142 tests en 170 ficheros.

### v1.38.2: Visibilidad del Reviewer y Endurecimiento de Credenciales

**v1.38.2** — El reviewer ahora ve ficheros nuevos creados por el coder (git add -A antes del diff). Los 15 patrones de credenciales bloquean el pipeline (los secrets nunca pasan). El template del coder obliga a usar .env para todas las keys.

**v1.39.0** — Notificacion de actualizacion en CLI: comprobacion no-bloqueante de version en npm al arrancar, cache de 24h.

## Fase 32: Soberanía del Pipeline y Observaciones (v1.40.0)

**v1.40.0** — Soberanía del pipeline: el guard de entrada MCP elimina overrides de la IA host, evitando que agentes externos cambien silenciosamente la configuración del pipeline. Nueva herramienta MCP `kj_suggest` (22ª) permite enviar observaciones a Solomon sin interrumpir el pipeline. Tests E2E de instalación en ubuntu, macOS y Windows. Notificación de actualización en CLI al arrancar.

## Fase 33: Integración OpenSkills (v1.41.0)

**v1.41.0** — Integración OpenSkills: nueva herramienta MCP `kj_skills` (23ª) para gestionar skills específicos de dominio. Inyección de skills en los prompts de coder, reviewer y architect. El triage auto-detecta e instala skills de dominio relevantes para la tarea actual.

## Fase 34: Lean Audit y Planificación Lazy de HUs (v1.42.0)

**v1.42.0** — Lean audit mide el coste basal: detección de código muerto, análisis de dependencias no usadas y seguimiento del crecimiento de complejidad. Planificación lazy de HUs: refinar una HU a la vez con contexto de las completadas, reduciendo la sobrecarga de planificación inicial.

## Fase 35: Docker e Instalador Shell (v1.43.0)

**v1.43.0** — Imagen Docker (Alpine + Node 20) para ejecución en contenedores. Instalador shell (`curl | sh`) para instalación en una línea sin npm.

## Fase 36: i18n (v1.44.0)

**v1.44.0** — i18n: kj init detecta el idioma del SO, pregunta idioma del pipeline y de las HUs. Los agentes responden en el idioma configurado. Soporta ingles y español.

## Fase 37: WebPerf Quality Gate (v1.45.0)

**v1.45.0** — WebPerf Quality Gate: Core Web Vitals (LCP, CLS, INP) como gate del pipeline via Chrome DevTools MCP + skills de WebPerf Snippets de Joan León. Umbrales configurables.

## Fase 38: Ejecucion Paralela de HUs y Binarios Standalone (v1.46.0)

**v1.46.0** — Ejecucion paralela de HUs via git worktrees (HUs independientes corren concurrentemente). Scripts de build SEA + workflow de GitHub Actions para binarios (sin Node.js). Wrapper Python para pip install. Imagen Docker + instalador shell.

## Fase 39: Ciclo de Vida de Cards PG y Sincronizacion HU Board (v1.48.0)

**v1.48.0** — Tracking del ciclo de vida de cards PG: los eventos del pipeline ahora actualizan el estado de las cards de Planning Game en tiempo real a lo largo de todo el ciclo de vida (created, in-progress, blocked, to-validate, done). Sincronizacion en tiempo real del HU Board: la UI del board refleja los cambios de estado de las cards conforme ocurren, eliminando la necesidad de refresco manual.

## Fase 40: Async I/O y SonarQube Centralizado (v1.49.0)

**v1.49.0** — Async I/O: todas las operaciones de fichero y red convertidas a patrones async no-bloqueantes. Configuracion centralizada de SonarQube: fuente unica de verdad para los ajustes de Sonar en CLI, MCP y pipeline. 61 bloques catch documentados y auditados para manejo correcto de errores.

## Fase 41: Division de God-Modules y Tests Unitarios Criticos (v1.50.0)

**v1.50.0** — 71 tests unitarios nuevos cubriendo 3 modulos criticos. Division de 3 god-modules en 12 sub-modulos enfocados para mejor mantenibilidad y testabilidad. 2473 tests en ~190 ficheros.

**v1.50.1** — Los mensajes del pipeline respetan el idioma configurado (catalogo de mensajes EN/ES). UI de checkpoints reestructurada con opciones numeradas en vez de botones ambiguos Accept/Decline.

## Fase 42: Integracion Real de RTK (v1.51.0)

**v1.51.0** — Integracion real de RTK: auto-instalacion en kj init, wrapping forzado en comandos Bash internos, medicion y reporte de ahorro de tokens por sesion. Tareas de auditoria/analisis saltan coder/reviewer y van directamente a roles de seguridad+auditoria. Homebrew tap (`brew tap manufosela/tap && brew install karajan-code`) anadido como metodo de instalacion alternativo para usuarios de macOS.

## Fase 43: Modo Pipeline No-Code (v1.52.0)

**v1.52.0** — Modo pipeline no-code: el triage detecta tareas que no son de codigo (analisis SQL, transformaciones CSV, reportes de datos) y desactiva TDD/SonarQube/reviewer automaticamente. Tres skills no-code integrados: `sql-analysis`, `csv-transform`, `data-report`. Las tareas que no producen cambios de codigo saltan todo el loop de quality gates.

## Fase 44: Conexion Plan-Run y Compresor de Respuestas MCP (v1.53.0 - v1.53.1)

**v1.53.0** — Conexion Plan a Run: `kj_plan` ahora ejecuta researcher + architect antes del planner, persistiendo el resultado completo. `kj_run --plan` carga el contexto del plan persistido y salta las etapas pre-loop (researcher, architect, planner), yendo directamente al loop del coder con el contexto arquitectonico ya resuelto.

**v1.53.1** — Compresor de respuestas MCP: elimina campos verbosos de las respuestas de herramientas MCP, trunca arrays grandes y genera JSON compacto. Reduce el consumo de tokens cuando los hosts MCP retransmiten resultados del pipeline al contexto de la conversacion.

## Decisiones Arquitectonicas Clave

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
- [Joan León](https://joanleon.dev/) — [WebPerf Snippets](https://webperf-snippets.nucliweb.net/) para medición de Core Web Vitals, inspiración del futuro quality gate de WebPerf
- [ADR-001: Role-Based AI Architecture](/docs/es/architecture/overview/) — Architecture Decision Record en el repositorio de karajan-code
- [Model Context Protocol](https://modelcontextprotocol.io/) — El estándar usado para la integración del servidor MCP de Karajan

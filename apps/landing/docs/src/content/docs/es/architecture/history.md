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

## Fase 45: Modo Refactoring de Diseno (v1.54.0)

**v1.54.0** — Flag `--design`: el rol impeccable pasa de solo-auditoria a modo refactoring. El coder aplica cambios de diseno (jerarquia, spacing, responsive, a11y, animaciones, theming).

## Fase 46: kj undo y Links a Documentacion (v1.55.0)

**v1.55.0** — Nuevo comando `kj undo` (24a herramienta MCP) que revierte la ultima ejecucion del pipeline con un soft git reset, o `--hard` para descartar todos los cambios. Todos los mensajes de error ahora incluyen una URL directa a la pagina de documentacion relevante, acelerando la resolucion de problemas sin buscar manualmente en la documentacion.

## Fase 47: Dashboard Status y Auto-Deteccion de Stack (v1.56.0)

**v1.56.0** — Dashboard de terminal `kj status` mostrando estados de HUs, stage actual del pipeline, tiempos y progreso. El MCP devuelve JSON estructurado para acceso programatico. `kj init` ahora auto-detecta el stack del proyecto escaneando package.json, go.mod, Cargo.toml, requirements.txt y ficheros similares. Los frameworks detectados auto-configuran el pipeline (impeccable activado para proyectos frontend, framework de tests pre-seleccionado, ajustes de lenguaje de SonarQube aplicados). El HU Board ahora soporta autenticacion opcional con token Bearer via la variable de entorno `HU_BOARD_TOKEN`.

## Fase 48: Telemetria y Reinicio Graceful del MCP (v1.57.0)

**v1.57.0** — Telemetria opt-out: estadisticas de uso anonimas (version, SO, comando, duracion del pipeline, tasa de exito) para mejorar Karajan. No se recopilan descripciones de tareas, codigo ni datos personales. Desactivable con `telemetry: false` en config o `KJ_TELEMETRY=false` como variable de entorno. Reinicio graceful del MCP: tras una actualizacion npm, el servidor MCP escribe un marcador de reinicio y sale limpiamente. La nueva instancia detecta el marcador y arranca con codigo fresco, reemplazando el comportamiento abrupto de `Transport closed`. `kj_resume` ahora respeta el snapshot de configuracion guardado en la sesion, preservando flags como `--no-sonar` que se establecieron durante la ejecucion original.

## Fase 49: Binarios SEA, Resolucion de Modelos, Robustez de SonarQube (v1.57.1 - v1.57.2)

**v1.57.1** — Build de binario SEA (Single Executable Application): binario standalone via `node scripts/build-sea.mjs` que no requiere instalacion de Node.js. Workflow de GitHub Actions que construye binarios para linux-x64, darwin-arm64 y win-x64 con checksums SHA256 en cada tag. El cargador de config YAML ahora tolera claves duplicadas en ficheros de configuracion del usuario.

**v1.57.2** — Resolucion de modelo/provider: cuando el campo model usa un formato con prefijo como `gemini/pro`, KJ infiere el provider del prefijo y lo elimina (el modelo pasa a ser `pro`). Los modelos explícitos incompatibles (ej. un modelo gemini en un provider claude) se descartan de forma controlada. Espera del auto-arranque de SonarQube: tras `docker compose up`, espera hasta 60 segundos (consultando cada 5s) a que SonarQube este listo, corrigiendo errores falsos de "auto-start failed" en arranques en frio. Prevencion de stdin en subprocesos: todos los subprocesos se ejecutan con `stdin: "ignore"`, previniendo cuelgues indefinidos cuando SonarQube, agentes o npm solicitan input. Entradas de gitignore en `kj init`: auto-añade `.kj/`, `.agent/`, `.scannerwork/` al `.gitignore` del proyecto si faltan. Scripts globales de proteccion de repos: `protect-all-repos.sh` (proteccion de ramas), `install-guard-all-repos.sh` (guard de atribucion IA), `ai-attribution-guard.yml` (workflow standalone).

## Fase 46: Domain Knowledge System (v1.58.0)

**v1.58.0** — Nuevo rol `domain-curator` (rol 16). Descubre, propone y sintetiza conocimiento de dominio de negocio para que todos los roles downstream trabajen con contexto del mundo real — no solo frameworks tecnicos.

**Adiciones clave:**
- Almacenamiento de dominios: `~/.karajan/domains/` (banco usuario/empresa, reutilizable entre proyectos) + `.karajan/domains/` (overrides por proyecto). Ficheros DOMAIN.md con frontmatter YAML y secciones markdown
- Registry de dominios: indice JSON local en `~/.karajan/domain-registry.json` con busqueda por tags/hints
- Sintetizador de dominios: filtra secciones relevantes por keyword overlap, compacta al presupuesto de tokens
- Rol Domain Curator: deterministico (sin coste LLM) — carga dominios, propone seleccion al usuario (si interactivo), sintetiza contexto
- `buildAskQuestion` mejorado: detecta `server.getClientCapabilities()?.elicitation` para adaptarse a las capabilities del host MCP. Soporta preguntas estructuradas (multi-select, select, confirm) con parser de texto libre
- Triage `domainHints`: el triage detecta keywords de dominio de negocio y los pasa al Curator
- Discriminacion de tipo en skill-loader: ficheros `SKILL.md` con `type: domain` en frontmatter se cargan via el Curator (inyectados en todos los roles) vs `type: technical` (solo coder)
- `domainContext` inyectado en todos los prompts de roles downstream (Researcher, Architect, Planner, Coder, Reviewer, HU-Reviewer)
- 102 tests nuevos

**v1.58.1** — Pantalla de bienvenida CLI al invocar `kj` sin argumentos: muestra version, agentes configurados y comandos rapidos.

**Adicion arquitectonica:**
```
triage → domainHints: ["dental", "clinical"]
       → domain-curator → loadDomains + registry.search → askQuestion (si interactivo) → synthesizeDomainContext
       → domainContext inyectado en prompts de researcher, architect, planner, coder, reviewer, hu-reviewer
```

**Por que:** Los agentes IA que escriben codigo para una industria especifica (dental, logistica, finanzas) toman mejores decisiones cuando entienden el dominio de negocio — nombres correctos, edge cases reales, reglas de validacion adecuadas. El Domain Curator anade este contexto a coste cero de LLM (loader + sintetizador deterministicos), reutilizable entre proyectos.

## Fase 50: Karajan Brain + Solomon Judge (v2.0.0)

**v2.0.0** — Rediseño arquitectónico mayor. Introduce **Karajan Brain** como orquestador central con IA y refina **Solomon** de jefe del pipeline a juez IA consultado solo en dilemas genuinos.

**Añadidos clave:**
- `KarajanBrainRole` — orquestador central con IA que enruta toda la comunicación entre roles
- `brain-coordinator.js` — integra 5 módulos de Brain (queue, enrichment, verification, actions, compression)
- `feedback-queue.js` — cola de mensajes tipados que reemplaza el string plano `last_reviewer_feedback`
- `feedback-enrichment.js` — transforma feedback vago en planes accionables con pistas de ficheros y severidad
- `verification-gate.js` — detecta iteraciones del coder sin cambios vía `git diff --numstat` + untracked
- `direct-actions.js` — comandos allow-listed que Brain puede ejecutar (npm install, gitignore, create_file, git_add)
- `role-output-compressor.js` — estrategias por rol con 40-70% de ahorro de tokens entre roles
- Smart init — asigna agentes a roles por capacidad (claude=5, codex=4, gemini=3, aider/opencode=2), diversifica reviewer del coder
- Solomon refinado a 4 skills consultivos: security-vs-deadline, conflicting-quality-gates, stalled-loop-analysis, risk-evaluation
- Bypass determinístico de seguridad: si el reviewer tiene issues de seguridad, Brain salta Solomon y envía directo al coder

**Arquitectura:**
```
triage → Brain (enruta) → researcher/architect/planner → Brain (comprime) → coder
                                                                              ↓
                                                 Brain (verifica cambios) ←───┘
                                                                              ↓
                                         reviewer → Brain (enriquece feedback)
                                                                              ↓
                             issue seguridad? → coder (Solomon bypassed) ─────┤
                             dilema? → Solomon (opinión) → Brain decide ──────┤
                                                                              ↓
                                   tester + security + impeccable (blocking)
                                                                              ↓
                                                                      audit → PR
```

**Eliminado:**
- Flujo v1 de feedback basado en strings (`last_reviewer_feedback`)
- Solomon como jefe del pipeline / árbitro bloqueante
- Boilerplate por rol (~200 LOC × 10 roles vía clase base `AgentRole`)
- Paths de config muertos y capa proxy sin uso

**Por qué:** v1 acumuló paths de comunicación ad-hoc entre roles (feedback string, solomon-como-jefe, responsabilidades mezcladas). v2 centraliza la inteligencia de orquestación en Brain, mantiene a Solomon como juez IA enfocado en dilemas reales, y rinde 40-70% de ahorro de tokens vía compresión por rol. Guía completa de migración en [MIGRATION-v2.md](https://github.com/manufosela/karajan-code/blob/main/MIGRATION-v2.md).

## Fase 50.1: Brain cableado al pipeline (v2.0.1)

**v2.0.1** — Release de parche que de verdad enciende Brain. v2.0.0 publicó los módulos de Brain pero nada los importaba, así que el pipeline seguía ejecutando lógica v1 (Solomon-como-jefe). Este release cablea Brain en el path de ejecución real.

**Arreglado:**
- `brainCtx` se crea en session init y se propaga a los stages de coder y reviewer
- **Coder stage**: usa el prompt enriquecido de Brain desde la cola tipada; llama `verifyCoderRan` tras cada ejecución; el pipeline para tras N iteraciones consecutivas sin cambios
- **Reviewer stage**: en rechazos de correctness/tests/security Brain bypasea Solomon y mete los issues tipados en la cola de feedback para la siguiente iteración. Solomon solo se consulta en dilemas de style-only.
- **Brain es el único que escala al humano** — `solomon-rules` ya no pregunta al usuario directamente. Las alertas críticas (stale, deps nuevas) pasan por Brain → Solomon juez IA → humano (solo si ninguno resuelve).
- **Brain consulta a Solomon activamente** en dilemas detectados y aplica su decisión (approve / continue / pause).
- **Detección de stale** — los checkpoints del reviewer ahora guardan una signatura del feedback y los del coder guardan `filesChanged`. Antes ambos estaban vacíos/cero, causando que solomon-rules detectara "stale" falsamente tras 3 iteraciones con bugs diferentes.
- **Crash de HU Board auto-start** en nvm/macOS (reportado por Jorge del Casar). `spawn('node', ...)` fallaba con ENOENT porque el subproceso detached no heredaba el PATH de node. Arreglado usando `process.execPath` + handler de error para que un fallo de HU Board nunca crashee el pipeline.

**Cambiado:**
- **Brain habilitado por defecto** (`brain.enabled: true`). v2 es arquitectura Brain; quien no lo quiera puede poner `brain.enabled: false`, pero la experiencia canónica v2 es Brain-on.

## Fase 50.2: Cobertura completa de Brain + revisión UX (v2.0.2)

**v2.0.2** — Extiende la cobertura de Brain a todos los stages y hace que `kj run` diga de verdad qué está haciendo.

**Añadido:**
- **Compresión + cola de feedback de Brain en todos los stages**: outputs de researcher, architect y planner se comprimen para métricas; fallos de tester y security entran en la cola tipada con enriquecimiento para la siguiente iteración del coder.
- **Brain decide en max_iterations**: al llegar a max_iterations Brain inspecciona la cola — issues de seguridad → pause al humano (no puede finalizar con security pendiente), correctness/tests → extiende iteraciones, cola vacía → finaliza, style-only → consulta Solomon como asesor. Solomon ya no se invoca directamente en max_iterations.
- **Líneas de acción del agente en modo quiet**: `kj run` ahora interpreta los bloques tool_use del stream-json de Claude en líneas de acción concisas (`Read packages/server/index.js`, `Bash $ npm install express`) — ya no hace falta modo verbose para ver qué hace el coder.
- **Heartbeat visible en modo quiet**: los eventos `agent:heartbeat` (cada 30s) ya no se suprimen — `kj run` muestra `⏳ claude working — 45s elapsed` en vez de parecer colgado durante llamadas largas.
- **Banner ASCII impreso en `kj run`** independientemente de la detección de TTY.

**Cambiado:**
- Alertas de reglas renombradas de `solomon:alert` a `brain:rules-alert` (display: "⚠️ Rules alert" en vez de "⚖️ Solomon alert"). El motor de reglas emite telemetría; no es una invocación de Solomon.
- Todos los handlers `onOutput` de stages pasan por el helper unificado `emitAgentOutput`: `kind=tool` → `agent:action` (visible en quiet mode), otros → `agent:output` (solo verbose).

## Fase 51: Auto-descomposición en HUs (v2.1.0)

**v2.1.0** — Cierra el gap arquitectónico fundamental donde las tareas complejas se ejecutaban como un único pipeline gigante en vez de dividirse en historias atómicas. Desde v2.1, cuando triage recomienda descomposición, Karajan auto-genera un batch de HUs certificadas y ejecuta cada una como sub-pipeline independiente con su propia rama git, commit y PR opcional.

**Añadido:**
- **HU auto-generator** (`src/hu/auto-generator.js`) — convierte los subtasks de triage en un batch certificado de HUs, añadiendo un HU de setup automático cuando el proyecto es nuevo o hay stack hints. Cada HU se clasifica con `task_type` (infra/sw/add-tests/doc/refactor/nocode) para que las policy gates downstream apliquen por HU.
- **Wiring triage → auto-gen → sub-pipeline**: tras triage + researcher + architect + planner, si triage marcó `shouldDecompose` y no se pasó `--hu-file` manual, el batch se persiste en `.karajan/hu/auto-<sid>/batch.json` y se inyecta como `stageResults.huReviewer`. La infraestructura existente `needsSubPipeline` / `runHuSubPipeline` lo recoge.
- **max_iterations por HU** (`config.hu_max_iterations`, default 3) — cada HU tiene su presupuesto de iteraciones focalizado y un estado Brain limpio (feedback queue, verification tracker, extensionCount=0) para que issues de un HU nunca contaminen al siguiente.
- **Automatización git por HU** (`src/git/hu-automation.js`) — cada HU crea su propia rama (`feat/HU-<id>-<slug>`) encadenada desde la rama del HU padre. Al aprobarse: commit atómico con `feat(HU-<id>): <título>`, opcionalmente push y PR (controlado por los flags existentes `git.auto_commit`/`auto_push`/`auto_pr`).

**Por qué:** v2.0.x tenía un gap conocido — las tareas complejas activaban descomposición en triage pero el pipeline la ignoraba y lanzaba una invocación gigante del coder que producía blobs de 50 ficheros que reviewer y tester no podían validar bien. v2.1 cierra esto: tareas grandes se convierten en ramas/PRs atómicas, cada una con presupuesto de iteraciones focalizado, estado Brain fresco y semántica de fallo aislada. Reviewer, tester y security por fin pueden hacer su trabajo.

## Fase 52: HU Board UX + Scope mínimo de HUs (v2.2.0 - v2.2.1)

**v2.2.0** — Mejoras UX del HU Board: nombres de proyecto legibles derivados del prompt, endpoints DELETE + botón papelera por card, port fallback (4000→4009), auto-start al generar HUs con banner cyan destacado. Excluye `.kj/` worktrees de vitest.

**v2.2.1** — Fix crítico: las HUs auto-generadas eran demasiado grandes porque la HU de setup incluía la descripción completa de la tarea. Ahora setup dice "DO NOT implement business logic — ONLY scaffolding" y las task HUs piden "<200 líneas (como un PR atómico)". Nombres legacy derivados del texto "Part of:" embebido. Stopwords ampliados. Botón borrar movido a per-card.

## Fase 53: Auditoría completa de Brain (v2.3.0)

**v2.3.0** — Auditoría exhaustiva del orquestador encontró y arregló 21 violaciones legacy v1 donde Solomon se invocaba directamente (sin pasar por Brain), `session.task` se filtraba al contexto per-HU, o las mutaciones de feedback saltaban la cola de Brain. Cada stage ahora gatilla Solomon a través de Brain cuando está habilitado. El reviewer per-HU evalúa el scope del HU, no la spec completa. HU Board gana endpoint `/api/sync` para detección live de batches. Model registry actualizado con familias 2026 (Jorge del Casar #412).

## Fase 54: Tests de Aceptación Ejecutables (v2.4.0)

**v2.4.0** — Primera versión en que la demo completa con éxito de extremo a extremo con auto-descomposición en HUs. Cada HU lleva `acceptance_tests`: un array de comandos shell que Brain ejecuta tras cada iteración del coder. Todos pasan → HU aprobada. Alguno falla → Brain lee el error exacto y envía un diagnóstico concreto al coder ("install @vitest/coverage-v8", no "Coverage: not measured"). Sin reviewer. Sin tester genérico. Pasa/falla concreto. Cuando `acceptance_tests` está definido, Brain reemplaza el pipeline estándar de reviewer/tester por un bucle personalizado (coder → acceptance_tests → diagnose → retry). También incluye auditoría de seguridad: `execSync` → `execFileSync` para git add, allowlist con matching exacto de tokens, permisos `0o600` en fichero de credenciales, enmascarado de tokens en respuestas MCP, vitest actualizado a 0 vulnerabilidades npm. Resultado demo: 6 HUs, 280 tests, 97% cobertura, 0 vulnerabilidades.

## Fase 55: Mini Planning Game (v2.5.0)

**v2.5.0** — Workflow en dos fases de primera clase: planificar primero, ejecutar después. `kj plan "task"` genera un plan v2 con HUs (IDs únicos globales, tests de aceptación, clasificación task_type). `kj plan list/show/validate/delete/ready/add-hu/remove-hu` dan CRUD completo sobre planes guardados en `~/.kj/plans/`. `kj run --plan <planId>` ejecuta las HUs del plan vía el sub-pipeline con tests de aceptación, actualizando el fichero de plan en tiempo real (status: running → done/failed). HU Board sincroniza desde `~/.kj/plans/` — los planes aparecen como proyectos con estado de HUs. Schema v2 con migración perezosa v1→v2, detección de ciclos en el grafo de dependencias. Correcciones del mismo release: el quality gate de Sonar por fin corre para HUs `sw` (acceptance_tests saltaba el pipeline estándar), el HU Board muestra datos ricos (título, scope, criterios de aceptación), vitest actualizado a 0 vulnerabilidades npm.

## Fase 56: Orquestador Modular + DI de Infraestructura + Valibot (v2.6.0 / v2.6.1)

**v2.6.1** (patch, 2026-04-20) — Arregla la sincronización del HU Board para que las sesiones sin auto-batch no desaparezcan: `syncSessionFile` ahora usa fallback `auto-<sessionId>` → `data.project_id` → `"default"` (proyecto "Orphan sessions") y siempre crea la fila de proyecto. Aísla además la suite de tests del `~/.kj/plans/` real mediante una nueva variable `KJ_PLANS_DIR`. Recupera dos tests regresados.

**v2.6.0** — La limpieza interna más grande desde Brain. `src/orchestrator.js` pasa de módulo-dios de 2 084 líneas a barrel público de 22 líneas sobre `src/orchestrator/flow-runner.js`; nuevo contrato `StageExecutor` (`canRun` / `execute` / `onFailure`) con `StageRegistry` y `runStage()` hace que los stages futuros se describan a sí mismos y el core deje de ramificar por `pipelineFlags` en cada feature. La DI de infraestructura aterriza bajo `src/infrastructure/`: `FileSystemService`, `CommandRunner` y un paquete `Environment` permiten que cada agent (Claude, Codex, Gemini, Aider, OpenCode) enrute las llamadas shell a través de un runner que los tests mockean con `MockCommandRunner` en lugar de lanzar subprocesos reales. La configuración se valida al cargar con Valibot — erratas en `review_mode`, `max_iterations: 0`, `hu_board.port` fuera de rango, `budget.warn_threshold_pct` inválido, `max_budget_usd` negativo fallan con mensajes legibles; los flags CLI falsy (`--no-rebase`, `--reviewer-retries 0`) por fin funcionan como se anunciaba (co-autoría con Jorge del Casar, recuperando su PR #379). El diario de sesión gana tres artefactos nuevos (`decisions.md`, `iterations.md`, `summary.md`) más un `tree.txt` agrupado por directorio. El budget proyecta ahora "Con KJ vs Sin KJ" reflejando el ahorro de RTK + compresión Brain. La suite alcanza 3 638 tests en 283 ficheros, con 21 ficheros de subsistemas opt-in etiquetados `[opt-in: <feature>]` y un nuevo helper `tests/support/opt-in.js` que gestiona los kill switches `KJ_SKIP_OPTIN_*`. El gate de auto-arranque del HU Board se simplifica a solo `hu_board.auto_start` y muestra la URL en un banner cian prominente al inicio del pipeline. Registro central de typedefs JSDoc en `src/types/` con `npm run typecheck` opt-in.

## Fase 57: addyosmani/agent-skills como catálogo de proceso de primera fuente (v2.7.0 / v2.7.1 / v2.7.2 / v2.7.3)

**v2.7.3** (patch, 2026-04-23) — Tres fixes de dogfooding detectados en pruebas en vivo. (1) Cada comando que recibe una tarea — CLI `kj run/code/review/plan/audit/discover/triage/researcher/architect` y las herramientas MCP equivalentes — acepta ahora la tarea desde un `.md` vía `--task-file <path>` (CLI) o `taskFile` (MCP). El task posicional sigue ganando cuando se dan los dos. (2) Las invocaciones CLI escriben por fin `.kj/run.log` como hace el MCP vía un nuevo helper `withCliRunLog()`, así `kj-tail` es simétrico tanto si Claude Code lanza `kj` por Bash como por la herramienta MCP. (3) Node 18 LTS soportado de verdad: el preflight exigía Node 20 con un mensaje engañoso, pero las cuatro features que citaba (`structuredClone`, `findLast`, `AbortSignal.timeout`, `fetch` estable) son todas 18+; `MIN_NODE_MAJOR` baja a 18 y la matriz de lint de CI gana `18.x`. `kj-tail` v1.38.0 además espera a que aparezca el log en vez de salir cuando no existe, así los usuarios no pierden líneas iniciales por carreras con el comando.

**v2.7.2** (patch, 2026-04-23) — Observabilidad de skills: `summary.md` incluye ahora una sección "Skills Used" listando la acción de addyosmani (`cloned`/`pulled`/`fresh`/`unavailable`) y los slugs resueltos por rol/tarea inyectados en los prompts, los OpenSkills instalados de verdad y las recomendaciones would-have-used cuando el CLI falta. `kj-tail` v1.37.0 añade un filtro 🎯 para los eventos `[skills:*]` — magenta en éxito, amarillo en rutas de degradación grácil. Cierra el bucle iniciado en v2.7.0: las decisiones de skills son ahora visibles en el tail en vivo, en `.kj/run.log` y en el `summary.md` persistente.

**v2.7.1** (patch, 2026-04-23) — Restaura la publicación de binarios SEA (`kj-linux-x64`, `kj-darwin-arm64`, `kj-win-x64.exe` + checksums SHA256) en las GitHub Releases. El workflow `release-binaries.yml` llevaba fallando en silencio en cada push de tag desde **v2.4.1** (5 releases consecutivas con assets vacíos). Causa raíz: `scripts/build-sea.mjs` hace `await import("esbuild")` — un import dinámico ESM que resuelve desde `node_modules` local — mientras el workflow instalaba esbuild con `npm install -g`. Fix: `esbuild` (`^0.28.0`) y `postject` (`^1.0.0-alpha.6`) son ahora `devDependencies`, así un único `npm ci` los pone en `node_modules` donde el import dinámico los encuentra. v2.7.1 es byte-equivalente a v2.7.0 en runtime; la única diferencia son los assets de la release.

**v2.7.0** (2026-04-22) — Karajan ahora consulta el catálogo curado [`agent-skills`](https://github.com/addyosmani/agent-skills) de Addy Osmani **antes** que OpenSkills al decidir qué skills inyectar en los prompts de cada rol. Los dos proveedores cubren ejes ortogonales: addyosmani trae workflows de ciclo de vida y proceso (TDD, code-review-and-quality, security-and-hardening, performance-optimization, git-workflow-and-versioning, CI/CD, debugging, docs, spec-driven, planning...) mapeados por rol de Karajan, mientras que OpenSkills sigue aportando skills de stack (astro, react, prisma, vitest-patterns...). En el primer uso, el catálogo se clona con `--depth 1` en `~/.karajan/agent-skills/`; las ejecuciones siguientes hacen `git pull` tras `skills.addyosmani.refreshDays` (por defecto 7 días). Cuando falta git o la red falla, el paso degrada de forma silenciosa y el pipeline sigue sin bloquear. El mapeo rol → slug vive en `src/skills/addyosmani-role-map.js` (tester → `test-driven-development` + `browser-testing-with-devtools`, reviewer → `code-review-and-quality` + `code-simplification`, security → `security-and-hardening`, architect → `spec-driven-development` + `api-and-interface-design` + `planning-and-task-breakdown`, y más). Los triggers por texto de la tarea añaden slugs encima — una tarea que menciona "performance" o "Core Web Vitals" trae `performance-optimization`. Nueva superficie de configuración: `skills.sources` (por defecto `["addyosmani", "openskills", "local"]`) y `skills.addyosmani.{enabled,refreshDays,repoUrl}` validados por Valibot. Nuevo CLI: `kj skills sync-addyosmani` fuerza un pull, `kj skills list-addyosmani` enumera los slugs cacheados con sus descripciones. 35 casos de test nuevos en `tests/skills/addyosmani-*.test.js` cubren parseo de frontmatter, ciclo clone/pull, TTL, path-traversal y degradación grácil. La suite queda en 3 672 tests en 285 ficheros.

## Fase 58: Fixes de contrato — Sonar intrínseco + sin API keys falsas (v2.7.4)

**v2.7.4** (patch, 2026-04-24) — Tres fixes a nivel de contrato descubiertos mientras el usuario probaba v2.7.3. (1) **Sonar es ahora intrínseco a Karajan para tareas de código**, como el TDD. El campo `sonarqube.enabled` y el flag `--no-sonar` se IGNORAN (con warning de deprecación al inicio del run) — una tarea de código sin quality gate no es un trabajo que Karajan pueda dar por terminado. Sonar corre para `sw`/`refactor`/`add-tests` por política y se salta para `audit`/`doc`/`infra`/`analysis`/`no-code`. Solomon todavía puede saltarse una iteración vía reglas runtime (override legítimo basado en evidencia). (2) **El preflight ya no exige API keys que Karajan no usa**. El preflight de v2.7.3 fallaba con `ANTHROPIC_API_KEY not set` — bloqueando cada ejecución vía Claude Code MCP donde el padre usa OAuth — a pesar de que Karajan nunca llama directamente a las APIs de los providers (cero imports de SDK, todos los agents lanzan CLIs como subprocesos). Reemplazado por un check real de disponibilidad de CLI (`claude`/`codex`/`gemini` en PATH). (3) **El orquestador ya no crashea** con `Cannot read properties of undefined (reading 'push')` en la ruta de init-error de Solomon — `addCheckpoint` ahora inicializa defensivamente `session.checkpoints = []`. Dos invariantes arquitecturales nuevas (`tests/architecture/no-provider-apis.test.js` y `tests/architecture/sonar-intrinsic.test.js`) hacen estos contratos exigibles en CI. Nueva guía `docs/TESTS.md` (~280 líneas) con mapa de directorios, diagrama de cobertura del pipeline, explicación por fichero y checklist de contribución.

## Fase 59: Endurecimiento dirigido por audit (v2.8.0)

**v2.8.0** (minor, 2026-04-30) — El self-audit del 2026-04-30 (`kj audit`) detectó 13 problemas en seguridad, calidad de código, rendimiento, arquitectura y testing. Esta release los cierra todos en 16 PRs (#555 → #570) sin cambios visibles en el API público. **Seguridad** (PRs #555 + #562): toda llamada a `child_process` en `src/` migrada de `execSync`/`execaCommand` con interpolación de strings a `execFileSync`/`execa` con arrays de argumentos tokenizados — cero expansión de metacaracteres de shell, incluso con inputs constantes. Siete sitios cerrados en `verification-gate`, `derive-project-name-from-cwd`, `direct-actions`, `solomon-rules`, `cli`, `config-init`, `init-context`. **Tests** (PR #570): terminada la suite FASE 1 e2e — 7 escenarios + infraestructura `fake-coder.js` / `fake-sonar-server.js` cubren la familia de 5 bugs de la demo del 2026-04-27 (zombie-HU, saveSession-missing, Repairer unfixable, zombi-status, audit smoke). Cada test < 90s; e2e completa en 6s, sin LLM ni red reales. **Splits de ficheros** (PRs #560/#567/#568/#569): `cli.js` 699→113 LOC (+ 6 módulos register), `commands/plan.js` 549→14 LOC shim (+ un fichero por sub-comando), `iteration-loop.js` 513→311 LOC (+ 5 ficheros de fase), `pre-loop.js` 626→435 LOC. Cada driver grande bajo el techo de 600 LOC. **Endurecimiento ESLint** (PRs #556/#557/#559/#564): baseline extendida a `tests/` con el trío bug-killer (`no-undef`, `import-x/no-unresolved`, `import-x/named`); `globalThis.__KJ_*` prohibido fuera de `src/config/test-harness.js`; `no-console: error` fuera de paths CLI/display; 57 warnings cerrados en `src/`, luego `no-unused-vars` / `no-useless-assignment` / `no-useless-escape` / `preserve-caught-error` ratcheteados warn→error. **Arquitectura y rendimiento** (PRs #558/#565/#566): mapa de imports de Node subpath (`#utils/*`, `#session/*`, `#hu/*`, `#skills/*`) elimina cadenas `../../../`; `adr-loader.js` y `garbage-collector.js` paralelizados con `Promise.all`; thresholds de cobertura por directorio en `vitest.config.js`. **BREAKING (runtime floor)**: `engines.node` 18→20.10.0 (Node 18 LTS llegó a EOL el 2025-04-30; matriz de CI dropea Node 18). 4 199 tests en 357 ficheros.

## Fase 60: Overhaul del audit — stack-aware, dos fases, deterministic-first (v2.9.0)

**v2.9.0** (minor, 2026-05-04) — `kj audit` se convierte en una herramienta de análisis stack-aware con tres colectores deterministas de seguridad, auto-activación de dimensiones según el tipo de proyecto, reportes persistibles, transparencia de tokens/coste y un prompt interactivo que deja al usuario inspeccionar los hallazgos baratos antes de pagar la fase LLM. 13 PRs de audit (`KJC-TSK-0354` → `KJC-TSK-0366`, #585-#600) más la limpieza de dead-exports en 5 PRs. Cero cambios breaking para callers MCP/pipeline — el legacy `AuditRole.execute()` encadena ambas fases idénticamente.

**Modo de dos fases** (`KJC-TSK-0364`, #597): los colectores deterministas (basalCost, hallazgos Sonar, OSV-Scanner, Semgrep, WebPerf, detección de stack) corren en paralelo e imprimen una sección `## Deterministic Findings` ANTES de preguntar `Continue with LLM analysis? [y/N]`. Nuevo flag `--deterministic-only` para corridas sin tokens (audits de 3 segundos con hallazgos concretos), `-y`/`--yes` para auto-confirmar, `--json` evita el prompt para mantener stdout pipeable. Paths CI / no-TTY auto-confirman — cero cambio de comportamiento para pipelines.

**Tres nuevos colectores deterministas de seguridad**: hallazgos de SonarQube como ground truth en el prompt con rule IDs y precisión de línea (`KJC-TSK-0361`, #588), integración OSV-Scanner cubre CVEs en toda la DB de OSV.dev (`KJC-TSK-0365`, #598) — más amplia que `npm audit`, sin cuenta, sin upload — y Semgrep SAST detecta XSS, SQLi, taint flow, secrets hardcodeados, anti-patrones específicos del lenguaje (`KJC-TSK-0366`, #600) — equivalente a `snyk code` pero gratis para OSS. Los tres son best-effort: binario faltante o host inalcanzable saltan la sección silently.

**Prompt stack-aware** (`KJC-TSK-0358`, #586): `detectProjectStack` informa al auditor LLM qué tipo de proyecto está mirando — frontend-only, backend-only, fullstack, lenguaje, frameworks. Las heurísticas se filtran: sin más alertas de N+1 queries en proyectos Astro, sin más alertas de bundle-size en APIs Express. Nueva dimensión `accessibility` (`KJC-TSK-0359`, #593) auto-activa para frontend / fullstack / unknown stack con checks WCAG 2.x (alt text, labels, ARIA, focus management, hints de contraste en tokens CSS). Nueva sección WebPerf (`KJC-TSK-0360`, #594) con 10 patrones de perf frontend cuando no hay medición CWV en vivo, más integración opcional de verdict de Core Web Vitals via `config.webperf.lastResult`.

**Reportes persistibles + transparencia de tokens**: `--report-file <path>` (`KJC-TSK-0362`, #592) escribe el audit a `.md` (con cabecera reproducible: timestamp, proyecto, branch, commit, flags de invocación) o `.json`. Variable de entorno `$KJ_AUDIT_REPORT_DIR` como directorio default para CI. Cada audit termina con una sección `## LLM Usage` (`KJC-TSK-0363`, #595) mostrando provider + model + duration + tokens (in/out/total) + coste estimado en USD. Visible en stdout, output JSON y reportes persistidos.

**Bug de paridad CLI/MCP corregido** (`KJC-TSK-0357`, #585): pre-patch el CLI `kj audit` reimplementaba `createAgent + buildAuditPrompt + parseAuditOutput` inline, descartando silently los inputs deterministas `basalCost`/`growthDelta` que `AuditRole.execute()` recolecta cuando se invoca via MCP. Ambos paths ahora ejecutan el mismo flow `AuditRole` — mismo code path significa mismo contenido del prompt.

**Salud del repo**: 228 dead exports limpiados en 5 PRs atómicas bisect-friendly (`KJC-TSK-0354` A-E, #579-#583). El propio detector `findDeadExports` de `kj audit` estaba sobre-contando 55x vs el ground truth de knip — corregido en `KJC-TSK-0356` (#584): ahora entiende JSDoc `@internal`, `await import("path")`, `import * as ns`, re-exports, y stripea strings entre comillas antes de las regexes de detección de exports. Resultado: 166 → 4 falsos positivos (99.7% reducción de ruido).

Suite completa **4 305 tests en 367 ficheros** — 106 tests nuevos añadidos para el overhaul del audit.

## Fase 61: Agent-readiness — superficie completa de agent-readability + score (v2.10.0)

**v2.10.0** (minor, 2026-05-05) — Karajan se convierte en el primer orquestador con una superficie completa de agent-readability: índice `llms.txt` en la raíz, un `SKILL.md` por cada comando del CLI bajo `docs/agents/`, y un auditor estático (`kj audit --agent-readiness`) que puntúa cualquier repo de terceros contra la misma forma. Cinco PRs (#605–#610) que agrupan KJC-TSK-0151 / 0228 / 0349 / 0350 / 0351 / 0355. Score de Karajan sobre Karajan: 100/100. Cero cambios breaking; todos los flags nuevos opt-in.

**`kj audit --agent-readiness`** (`KJC-TSK-0350`, #609): score estático sin LLM, 0–100, sobre siete checks — presencia de llms.txt, validez de llms.txt (secciones + links), allowlist de bots IA en robots.txt, presupuesto de tokens por doc (≤ 32 KB), jerarquía de headings, presencia de `agents/README.md` como entry point, cobertura de SKILL.md. Salida: ✓/✗ por check + lista ranked de top-fixes ponderados. `--json` para CI; transformación pura de datos (sin red, sin LLM, sin side effects). Dos bug fixes del detector llevaron Karajan-sobre-Karajan de 80 → 100/100: comentarios bash dentro de fenced code blocks ya no cuentan como H1, y los banners HTML `<h1 align="center">` ahora se reconocen como H1 válido.

**SKILL.md por subcomando** (`KJC-TSK-0349`, #608): seis nuevos `docs/agents/SKILL.kj-{doctor,init,board,review,resume,clean}.md` que cierran el gap con `llms.txt` (que los anunciaba pero solo existían tres). Cada uno sigue el contrato establecido (What it does · Inputs · Outputs · Constraints · Side effects · Common failure modes · Example · Related). El test arquitectónico `tests/architecture/agent-readability.test.js` falla CI cuando un link de SKILL en `llms.txt` deja de resolver o un SKILL.md pierde una sección requerida. Plus `docs/demos/` (`KJC-TSK-0228`, #610) con tres scripts de grabación asciinema (happy-path, agent-readiness, audit-with-llm), config recomendada del terminal, checklist pre-grabación y guía de embed con `<asciinema-player>` — scripts como source of truth, .cast files re-grabados por release.

**Quality gate de webperf dentro del bucle de iteración** (`KJC-TSK-0151`, #605): `PerfStage` engancha `PerfRole` (#603) en `runQualityGateStages` después de Impeccable cuando `pipeline.perf.enabled` es true. Veredicto PASS → la iteración continúa; veredicto FAIL → `setReviewerFeedback` con métricas bloqueantes concretas + top oportunidades, la iteración reintenta; scanner no disponible (lighthouse missing/timeout) → log warn y skip — best-effort, nunca bloquea el pipeline por sí mismo. Paridad CLI/MCP: flag `--enable-perf` + `enablePerf` en `mcp/tools.js`, `mcp/run-kj.js`, sovereignty-guard allowlist y `applySessionOverrides`.

**Hardening del HU Board** (`KJC-TSK-0355`, #607): bindea `127.0.0.1` por defecto (antes: todas las interfaces — bien en un portátil personal, problemático en WiFi de cafetería compartida). Nuevo `kj board start --bind <host>` para el caso explícito de "exponer en LAN"; el banner emite un warning + URL con token al bindear no-loopback. Token autogenerado en `~/.karajan/hu-board/token` (mode 0600, 32 bytes hex aleatorios, idempotente). El middleware de auth solo fuerza el token para peers no-loopback — el navegador en la misma máquina sigue funcionando sin `?token=` en cada link. Tres carriers aceptados: `Authorization: Bearer`, `?token=`, cookie `kj_board_token`. `helmet` middleware setea X-Content-Type-Options, X-Frame-Options, CSP conservadora, elimina `X-Powered-By: Express`. `express-rate-limit` en `/api`: 300 req/min por IP, headers draft-7 `RateLimit-*`.

**Auto-routing de skills a11y/WCAG/ARIA** (`KJC-TSK-0351`, #606): tareas que mencionan accessibility / a11y / WCAG / ARIA / screen reader / keyboard navigation cargan automáticamente la skill `frontend-ui-engineering` — hasta que el catálogo upstream addyosmani publique una skill dedicada a a11y, esa es la fuente autorizada más cercana para trabajo UI con WCAG.

Suite completa **4 358 tests en 373 ficheros** — 53 tests nuevos añadidos en este ciclo.

## Fase 61.1: Patch — fix de contaminación de stdout en `--json` (v2.10.1)

**v2.10.1** (patch, 2026-05-06) — Guard de una línea en `src/commands/audit.js` que suprime el banner `[info]` cuando `--json` está activo. Pre-fix, `kj audit --agent-readiness --json | jq` moría con parse error porque el logger emitía `Auditing agent-readiness of <path>` a stdout ANTES del JSON. Detectado en un code review pre-charla (3 agentes Sonnet en paralelo) antes del demo del 21 mayo 2026. PR #613 (fix) + #614 (release). Más polish en scripts `docs/demos/` (recomendación de repo concreto, timing realista, `--auto-commit`, safety net `npm install`). Nuevo `TODO-post-talk.md` con los 8 findings P1/P2 diferidos a post-charla. 4 359 tests pasando.

## Fase 61.2: Patch — Wizard `kj init` ampliado (v2.10.2)

**v2.10.2** (patch, 2026-05-07) — `kj init` pasa de 9 prompts a un setup completo. Nuevo `askPerRoleProviders` recorre los 10 roles no-coder/no-reviewer (planner, researcher, architect, refactorer, tester, security, solomon, impeccable, perf, hu_reviewer) ofreciendo "heredar de coder/reviewer", elegir un CLI específico o desactivar el rol. Nuevo `src/sonar/token-bootstrap.js` hace login en el Sonar local con admin/admin, **rota la contraseña por defecto** a un secret nuevo persistido en `~/.karajan/sonar.admin-password` (mode 0600), revoca cualquier token `karajan-cli` previo y genera un `GLOBAL_ANALYSIS_TOKEN` fresco via `POST /api/user_tokens/generate` — sin más vueltas por la UI web. Prompts nuevos para automatización git (`auto_commit/push/pr` + `branch_prefix`) y seguridad del HU Board (bind host + port). Disparado por feedback del usuario en testing pre-charla el 2026-05-06: "el init es minimalista, falta configurar el resto de roles con qué CLI". PR #616 (KJC-TSK-0367) + #617 (release). +16 tests nuevos; **4 375 / 4 375** pasando en 374 ficheros.

## Fase 62: Paso de dogfooding — papercuts UX + fix de status zombi + polish hu-board (v2.11.0)

**v2.11.0** (minor, 2026-05-08) — Dos días recorriendo un plan de dogfooding de 10 niveles re-validaron cada superficie de Karajan (N0 sanity → N8 demo scripts) y surfaron una larga cola de papercuts UX y tres bugs latentes que sólo aparecen en repos `/tmp/...` recién creados. 14 PRs (#624–#637).

**Fiabilidad de pipeline**: El `SonarStage` ya no entra en bucle en repos sin remote (`KJC-TSK-0373` follow-up, #624 + #633) — antes lanzaba `Missing git remote.origin.url` en cada iteración, Brain trataba cada error como no resuelto, y el run finalizaba via el fallback de "approved-by-exhaustion" sin ejecutar Sonar nunca. Nuevo predicado compartido `canResolveSonarProjectKey` que skipea el stage limpiamente con `gateStatus: SKIPPED`. Tolerancia de carrera en `commitAll` con detección locale-aware (#633): captura `nothing to commit` / `nada para hacer commit` / `nichts zu committen` / `aucune modification ajoutée au commit` y devuelve `{committed: false}` limpio en lugar de escalar a Solomon. Fallback de rama de HU (#636): cuando `init.defaultBranch=master` y el `main` configurado no existe, `prepareHuBranch` prueba `main → master → HEAD` y usa la primera ref que existe.

**Sellado de status de sesión** (`KJC-BUG-0037`, #635): varios paths de salida de `runFlow` devolvían `{approved: true}` aguas arriba sin sellar `session.status`, dejando runs como `running` indefinidamente. Nuevo guard de frontera `sealSessionStatusIfStillRunning` en los puntos de retorno de runFlow mapea la forma del resultado al status terminal (`approved` / `paused` / `cancelled` / `failed`); idempotente + never-throws.

**`writeConfig` strip-ea claves runtime-only** (`KJC-BUG-0036`, #629): el loader sintetizaba `_deprecated.sonarqubeEnabledKey` y el wizard usaba `sonarqube.enabled` como hint transitorio; `writeConfig` serializaba ambos, fosilizando el warning de deprecación en el YAML. Nuevo `stripRuntimeOnlyKeys` los elimina antes del dump. `addyosmani-catalog` se recupera de force-push upstream (`KJC-BUG-0033`, #625): cuando `git pull --ff-only` falla, fallback a `git fetch --depth 1 origin HEAD` + `git reset --hard FETCH_HEAD`. `kj init` ya no persiste el deprecated `sonarqube.enabled` (`KJC-BUG-0034`, #626).

**Features de hu-board**: Auto-cleanup de proyectos test efímeros (`KJC-TSK-0371`, #627) borra en cascada proyectos `tmp_*` / `test_*` / `demo_*` / `kj-test-*` inactivos >24 h al arrancar. Nueva columna `is_test` en `projects` permite override per-proyecto (toggle 3-estado 🧪 / 📌 / · en cada card; endpoint `PATCH /api/projects/:id/is-test`). Ayuda integrada (`KJC-TSK-0372`, #628): nuevo botón `?` abre un modal explicando las cinco vistas; cada tab lleva un atributo `title` nativo.

**Polish UX / display**: Sonar `SKIPPED` se renderiza en gris, no rojo, en el banner de resultado (#634). Panel de Result + `summary.md` listan ahora **todos** los commits que produjo el run vía el nuevo helper `listCommitsBetween(fromSha)` más un nuevo campo `session.head_at_start` capturado al inicio del run (#632). Help text dice que `task` es REQUERIDO para los 8 comandos que lo necesitan (#631).

**Documentación**: Nuevo `docs/dogfooding-levels.md` (#630, #637) con el plan de pruebas de 10 niveles. **4 452 / 4 452 tests** pasando en 377 ficheros.

## Fase 63: Medición de calidad — plan adherence + golden tasks (v2.12.0)

**v2.12.0** (minor, 2026-05-09) — Aterrizan a la vez dos features de medición de calidad. El pipeline ahora puntúa sus *propios* runs (**plan adherence** por run, métrica determinista 0–100 en `summary.md`) y el propio proyecto se protege contra regresiones entre versiones con una pequeña suite de **golden tasks**. Más un refinamiento de la política de CI que libera la documentación orientada a humanos del techo de LOC manteniendo capados los ficheros de reglas para IA. 8 PRs en total (#645–#652) + el commit de release #653.

**Plan adherence metric** (`KJC-TSK-0376`, #645/#646/#647): cada `kj run` contra un plan conocido calcula un score determinista 0–100 que responde a *"¿siguió el coder el plan?"*. Cuatro componentes ponderados — commit attribution (40%), acceptance tests (30%), scope discipline (20%), dependency order (10%) — cálculo offline puro, sin LLM, sin coste extra. Inspirado en la [guía de evaluación de agentes de deepeval](https://deepeval.com/guides/guides-ai-agent-evaluation) pero mantenido totalmente determinista para reproducibilidad (compatible con la suite de golden tasks). Aparece en `summary.md` como una nueva sección `## Plan adherence` con score, tabla de desglose y la lista de HUs que no recibieron commit atribuido. La sección se omite cuando el run no estaba ligado a un plan o todos los componentes devuelven null. Spec en [`docs/plan-adherence.md`](https://github.com/manufosela/karajan-code/blob/main/docs/plan-adherence.md).

**Golden tasks regression suite** (`KJC-TSK-0374`, #648/#650/#651/#652): tres fixtures canónicas (`todo-rest-api`, `npm-package-cli`, `react-counter-component`) con assertions estructurales sobre el `summary.md` producido (commits, audit status, threshold de plan adherence) más checks de filesystem (ficheros de test, rango de LOC). La suite corre pre-release (~$5–10 por pasada completa) y devuelve `{ok, kjExit, summaryPath, parsed, failures}`. Cinco familias de assertion por tarea, todas deterministas. Tres dominios ortogonales (backend / CLI / frontend). Las cuatro sub-PRs se reparten: schema + loader, summary parser + asserter, subprocess runner + filesystem assertions, fixtures + baseline + spec. Spec en [`docs/golden-tasks.md`](https://github.com/manufosela/karajan-code/blob/main/docs/golden-tasks.md).

**Shrink-budget refinado** (#649): el techo de 200 LOC por PR estaba forzando trims artificiales de documentación legítima (entradas de CHANGELOG, spec files). El gate ahora exime docs orientados a humanos (`docs/**`, `CHANGELOG.md`, `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, `MIGRATION*.md`, `TODO*.md`). Los ficheros de reglas para IA (`CLAUDE.md`, `AGENTS.md`, `templates/**/*.md` — role prompts, coder/review rules) **siguen contando** — esos van al contexto del agente en cada run, y crecimiento sin límite ahí diluye la señal que recibe la IA. Misma disciplina ≤200 LOC que el código. **4 522 / 4 522 tests** pasando en 381 ficheros.

## Fase 64: Hardening del HU Board — tombstones + detector de restart + cleanup (v2.13.0)

**v2.13.0** (minor, 2026-05-11) — Cinco PRs absorben las patologías que la sesión de dogfooding del 2026-05-10 reveló sobre el HU Board: un modal "Karajan needs an answer" del 7 de mayo bloqueando toda la UI, ~18 proyectos zombi reapareciendo tras cada `kj board start`, el navegador sirviendo HTML/JS antiguo tras un `kj board stop` + `start`, y el modal del prompt mostrando transparencia porque `var(--bg-secondary)` jamás se declaró. Sin parches sueltos — refactor estructural por causa raíz.

**Tombstones — delete persistente** (`KJC-TSK-0380`, #655/#656/#657): el HU Board reconstruye la DB SQLite desde el filesystem en cada `fullScan`, así que cualquier `DELETE` por API era silenciosamente revertido al siguiente sync de chokidar. Solución: tabla `tombstones (resource_type, resource_id, deleted_at, source, fs_paths)` con clave primaria compuesta. Los `sync*File` consultan tombstone antes de upsert; si está, hacen `rm -rf` del path del filesystem y abortan. Patrón clásico de Cassandra/Riak. Permanentes; restauración explícita vía endpoint. Endpoints DELETE reforzados (`/api/projects/:id`, `/api/stories/:id`, `/api/sessions/:id`) y nuevos (`DELETE /api/prompts/:id`, `DELETE /api/plans/:planId`, `GET /api/tombstones`, `POST /api/tombstones/:type/:id/restore`). Comando nuevo `kj board cleanup` detecta proyectos efímeros (`tmp_*`/`test_*`/`demo_*`/`kj-test-*`/`s_*`/`plan-*` con >7d sin actividad), prompts huérfanos (sin `.answer.json` y mtime >24h) y directorios de sesión huérfanos. Soporta `--dry-run`. Resuelve los ~20 zombis acumulados en una sola pasada.

**Detector de restart del server** (`KJC-TSK-0379`, #654): `Cache-Control: no-store, must-revalidate` para HTML/JS/CSS servidos por el board (ETag y Last-Modified desactivados) garantiza que el primer request tras un restart trae código fresco. El cliente polea `/api/version` cada 30s; si `boot_time` cambia (server reiniciado), `forceRefresh()` automático: limpia caches y recarga sin que el usuario tenga que cerrar pestañas o hacer Clear Site Data. Botón **🧹** en el header como escotilla manual visible.

**Polish UX** (#658): `var(--bg-secondary)` referenciada en 8 sitios de `app.js` (modal del prompt, textareas, inputs, code blocks) pero jamás declarada en `:root` → fallback a `transparent` → cards visibles detrás. Fix: declarar la variable en `:root` con `#131a30`. Una línea CSS, ocho consumidores arreglados. Y el icono `☐` (cuadrado vacío Unicode U+2610) del empty-state, eliminado del template — el title + text + path bastan.

**4 522 / 4 522 tests** passing. Upgrade seguro desde 2.12.0.

## Fase 65: Pasada de calidad — clasificación Solomon + self-fix del planner + reorg de tests (v2.14.0)

**v2.14.0** (minor, 2026-05-12) — 16 PRs en una sesión absorbiendo bugs blockers, patologías del planner detectadas en el dogfooding de Plan 2 GRETA, hardening del HU Board, y la primera tanda de reorg de `tests/` (issue #368). Suite 4577/4577 verde toda la sesión, 0 regresiones.

**Solomon ya no aprueba blockers de seguridad mal clasificados como "style"** (`KJC-BUG-0026`, #665): Rule 6 (`reviewer_style_block`) clasificaba como style cualquier issue con severity `low`/`minor` O regex de keywords cosméticas (`name`, `format`, `documentation`, …). Issues de seguridad legítimos con esas características (e.g. "SQL injection in user input parsing" matcheaba `name`, "Missing CORS documentation" matcheaba `documentation`) llegaban a Solomon que los aprobaba. Fix: anti-clasificador `isSecurityIssue()` con tres señales — severities `critical`/`high`/`blocker`/`major`, categorías `security`/`correctness`/`bug`/`vulnerability`, y una regex de keywords de seguridad (sql injection, xss, csrf, ssrf, rce, auth, password, secret, credential, token, hash, crypto, traversal, prototype pollution, deserializ, eval, …). Si CUALQUIERA matchea, la lambda devuelve `false` para `allStyle` y Solomon no se invoca.

**Detector de fs-leak del coder, segunda capa** (`KJC-BUG-0032`, #666): el `fs-leak-detector` original snapshotteaba `$HOME` antes/después del coder. Capturaba el incidente original (`cd /home/manu/assistant && pnpm init` creando 36 MB) solo porque `~/assistant` era nuevo. Si el target preexistía, pasaba inadvertido. Fix: nueva función `detectTranscriptCdLeaks(transcript, projectDir)` que escanea el output buscando `cd <ruta-abs> && <write-cmd>` con `<ruta-abs>` fuera de `projectDir` y `<write-cmd>` en el set de creación (`mkdir`, `touch`, `cp`, `mv`, `git init`, `{pnpm,npm,yarn} init/create`, `npx create-*`, `cat >`, `echo >`, redirects). Comandos pure-read (`ls`, `which`, `grep`) no flagean. `/tmp` exento.

**Patologías del planner P1-P4 detectadas en dogfooding Plan 2 GRETA** (2026-05-11): el reviewer flagaba 4 huecos del SPEC en cada iteración. P1 (#667 / `KJC-BUG-0042`) — el planner ignoraba declaraciones explícitas tipo "NO incluye en este plan: X", "Out of scope: Y", "Plan N handles: Z". Fix: `extractScopeExclusions(task)` detecta 6 patrones (ES + EN) y renderiza sección **FORBIDDEN scope** en el prompt. P2 (#668 / `KJC-BUG-0043`) — el planner no infería deps transversales: una HU con AC "listado transversal de warnings filtrables por guardrail" solo dependía de `GUARD-001` cuando debía depender de `GUARD-001..N`. Fix: regla explícita en el prompt + ejemplo concreto. P3 (#669 / `KJC-BUG-0044`) — el planner reimplementaba funcionalidad ya existente. Fix: nuevo campo `reuse: ["<id>"]` end-to-end. P4 (#670/#671 / `KJC-BUG-0045`) — el plan-reviewer era flag-only. Fix: nuevo módulo `src/plan/plan-fixer.js` con `buildFixerPrompt` + `applyReviewerFeedback` + `applyFixerPatch`. Loop max=2 iteraciones tras `reviewPlan`, opt-out con `--no-plan-fixer`/`--quick`.

**Pulido del HU Board**: prompts zombi (`KJC-BUG-0038`, #673) — si el runner crasheaba sin contestar `askQuestion`, el archivo `~/.kj/prompts/<id>.json` quedaba huérfano. Fix: TTL de 30 min en `GET /api/prompts`. Rate-limit (`KJC-BUG-0039`, #674) — 300 req/min era demasiado agresivo para el fanout del primer load del board. Fix: default 300→600 + `skip:` para `/api/events` (SSE).

**Reorg de tests (issue #368, parcial)**: `tests/` tenía 264 archivos en root. 5 PRs (#675–#679) movieron 93 archivos a 13 subcarpetas espejo de `src/`. `git mv` (rename preservando history) + `sed` para 6 patrones de imports. Quedan ~170 en root.

## Fase 66: Patch — Convergence guard del self-fix + respeto a async-deps (v2.14.1)

**v2.14.1** (patch, 2026-05-12) — 2 PRs absorbiendo las patologías del planner que el dogfooding de v2.14.0 contra GRETA Plan 2 reveló a las pocas horas del release.

**Self-fix loop diverge** (`KJC-BUG-0046` / P5, #684): el self-fix loop de v2.14.0 podía empeorar el plan. Iter 1 reducía 15→10 issues, pero iter 2 borraba HUs que iter 1 había añadido, dejando referencias dangling que el reviewer post-iter-2 contaba como nuevos `missing_dependencies`, terminando en 17 findings. Fix: snapshot del plan antes de cada iter del fixer. Si `newCount > currentCount` tras re-review, restaurar snapshot y `break`. Log nuevo: `[planner] self-fix iter 2 regressed (10 → 17) — reverted, stopping`.

**Async-deps respect** (`KJC-BUG-0047` / P6, #685): el planner convertía sistemáticamente "Y reacciona a X" en `X blocked_by Y`, rompiendo "AVISA-no-BLOQUEA" de GRETA. 4 de 5 order_issues del reviewer en Plan 2 eran del mismo patrón ("041 Outcome blocked_by 052 Guardarraíl 1 — pero G1 es async"). Fix: regla explícita en el prompt enumerando 6 patrones de async observers + heurística "¿X consume un deliverable de Y? → blocked_by. ¿Y solo reacciona a X? → paralelos".

**Resultado dogfooding**: regenerar Plan 2 GRETA devuelve **9 findings sobre 58 HUs** (15% issue density), igualando el baseline iter 1 de v2.13.0+#661-664. v2.14.0 puro daba 17. Las 9 patologías restantes son gaps reales del SPEC, no fallos del planner.

## Fase 67: Patch — Botón ▶ respeta blocked_by + [EPICA] prefix + docs spec-conventions (v2.14.2)

**v2.14.2** (patch, 2026-05-12) — 2 UX bugs + 1 gap docs detectados en dogfooding GRETA Plan 2 v2.14.1.

**Botón ▶ Run respeta blocked_by** (`KJC-BUG-0048`, #687): `canRunHu` en `packages/hu-board/public/app.js` solo miraba `status + testCount`, así que el botón ▶ aparecía en TODAS las HUs `pending`, permitiendo lanzar HUs cuyas deps no existían aún. El frontend ya mostraba "⏳ waits for: …" debajo del title pero el botón ▶ se pintaba igual. Fix: añadir `&& blockedBy.length === 0`. Las 19/58 HUs entry-point siguen mostrando ▶; las 39 con deps muestran solo el badge waits-for.

**[EPICA] prefix en titles** (#687): los titles del board habían perdido el prefix `[NOMBRE_EPICA]` durante v2.14.x. Sin él era imposible orientarse de un vistazo. Fix: regla en el prompt del planner `description: "[EPICA] one-sentence description"`. Los primeros 80 chars del `description` se convierten en el title del board, así el prefix sale automático. Fallback `[INFRA]`/`[SHARED]`. Dogfooding GRETA: 62/62 HUs con prefix correcto.

**spec-conventions.md** (`KJC-TSK-0385`, #688): documento central de 191 LOC con las **6 convenciones SPEC** que el planner v2.14.x entiende: épicas, scope exclusions, deps transversales, reuse, async observers, deps explícitas. Más antipatrones y checklist pre-generación. `plan-generate.md` y `README.md` de task-templates actualizados para enlazar.

## Fase 68: Patch — Preflight degradable + project-aware (v2.14.3)

**v2.14.3** (patch, 2026-05-13) — 3 mejoras al preflight surgidas del primer `kj run` real sobre greta-app (greenfield).

**Auth `gh` por keyring reconocida** (`KJC-BUG-0049` puntual, #690): el check `token:gh` solo miraba env vars. Cuando `gh` estaba auth vía keyring (default tras `gh auth login --web`), Karajan rechazaba aunque funcionara. Fix: ejecutar `gh auth status` como fallback.

**Sistema de checks degradables** (`KJC-BUG-0049` arquitectural, #691): nuevo campo `Check.degradable = { disables, warn }`. Cuando un check degradable falla, en lugar de abortar el run, desactiva los flags listados (e.g. `git.auto_pr`, `git.auto_push`) y emite WARN. La sesión continúa con esas features off. Reemplaza el "fail-closed" rígido por "degrade-or-fail" según el check.

**Preflight project-aware** (`KJC-TSK-0393`, #691): nuevo módulo `src/checks/project-checks.js` que detecta signals del proyecto (Dockerfile/firebase.json/pyproject.toml/Cargo.toml/*.tf/.env.example) y registra checks dinámicos: tool presente, permisos write en projectDir+.kj/+.karajan/, `.env` consistency, gh push access al remote real (degradable). Comando nuevo `kj doctor --project` ejecuta solo esta fase.

## Fase 69: Brain Recovery + Model Routing + Self-Healing Plans (v2.15.0)

**v2.15.0** (minor, 2026-05-17) — tres epics simultáneos cierran tres problemas distintos en una release. 30+ commits, ~4 000 LOC, 4 835/4 835 tests passing.

**Epic KJC-PCS-0044 — Brain Recovery** (TSK-0411…0415, 11 PRs #722-#736). Hasta v2.14 cualquier fallo de IA (rate limit, 5xx, network, kill por silence timeout) terminaba con un genérico `failed (Ns)` sin diagnóstico. v2.15 introduce un **classifier universal** con 7 clases ricas (RATE_LIMIT_SHORT, QUOTA_EXHAUSTED_DAILY, QUOTA_EXHAUSTED_MONTHLY, API_DOWN, AUTH_FAILED, NETWORK_TIMEOUT, SILENCED, UNKNOWN_FATAL) y un **wrapper central** `withBrainRecovery` que wrappa TODA invocación a agente y aplica política según clase: standby in-process para waits < 5 min, backoff exponencial con jitter para 5xx/network/silenced, abort para auth/unknown, **hibernate** para quota daily/monthly. La hibernación persiste el estado del run a `~/.kj/standby/<sessionId>.json`, mata el proceso (libera memoria), y el board reanuda con `kj standby resume` exactamente cuando llega `cooldownUntil` (setTimeout único per session, cero polling). El GC al arrancar limpia standby/done > 7d, audits > 30d, hu-board-runs > 30d (resuelve 25 carpetas huérfanas detectadas en dogfooding). Para Anthropic Max 20x que introduce un cap de \$200/mes Agent SDK desde 15-jun-2026, una nueva clase QUOTA_EXHAUSTED_MONTHLY y un **fallback chain** (claude → codex → opencode → aider, configurable per rol en `kj init`) activa el siguiente provider cuando `retryAfter > 12h` en lugar de hibernar 30 días.

**Epic KJC-PCS-0043 — Model Routing per HU + Undo** (TSK-0405…0410, 6 PRs #715-#721). Cada HU lleva `coder_model` + `reviewer_model` propios, asignados automáticamente según complexity (trivial/simple/medium/complex) inferido del task_type. Reviewer **cross-provider** por defecto (claude↔codex, gemini→claude, opencode→claude) — dos cabezas distintas miran el código. Override per-HU desde el modal del board sin tocar config global. OpenCode + Aider son first-class providers en el router. Antes del coder run, un git snapshot ref se crea automático; botón **⏪ Undo** en el modal restaura los ficheros (`git reset --hard <ref>`) y marca status=pending — útil cuando el resultado no convence y quieres re-ejecutar con otro modelo.

**Epic KJC-PCS-0042 — Self-Healing Plans** (BUG-0053/0054, TSK-0399…0404, 8 PRs #707-#714). El plan-fixer ahora **asigna short_id + blocked_by** a las HUs que añade en iteraciones del self-fix loop. El **convergence guard** se vuelve inteligente: distingue *priority* (cycles + missing_hus, crítico) de *secondary* (deps + overlaps) y acepta iteraciones que reducen priority aunque suban secondary. Tras el self-fix LLM corre un **structural integrity pass** determinístico que rompe ciclos (DFS), elimina blocked_by huérfanos y asigna `AUTOFIX-NNN` a HUs sin short_id — porque el LLM es bueno con contenido pero malo con grafos. Nuevos task_types `spike` y `research` (skip Sonar/TDD/tests), title prefix `[SPIKE]`/`[DOC]`/`[RESEARCH]` infiere task_type automático. Nuevo comando `kj plan fix [planId] [--prompt "feedback"]` re-corre reviewer + self-fix + structural pass sobre un plan existente sin regenerar. La columna Failed del kanban del board desaparece — HUs fallidas vuelven a Pending con badge ✗ result=fail, disponibles para retry inmediato.

## Fase 70: Filtro de falsos positivos Sonar + cierre del wire de Brain Recovery (v2.16.0)

**v2.16.0** (minor, 2026-05-18) — release orientado a calidad. 4 PRs (#738-#741), 4 846/4 846 tests passing en 401 ficheros. La cabecera es un **filtro determinístico de falsos positivos de Sonar** (KJC-TSK-0416). Antes de v2.16 cualquier issue Sonar de severidad ≥ MINOR aterrizaba en el feedback del coder (rol `sonar-role`) o del auditor sin más; reglas con falsos positivos crónicos como `javascript:S2699` ("test sin assert") en `tests/architecture/` (donde el assert es `expect(offenders, msg).toEqual([])` con mensaje custom que Sonar no detecta) provocaban que el coder gastara tokens "arreglando" tests que ya pasaban. v2.16 introduce dos mecanismos complementarios: (1) **rules estáticas** `{ rule, filePattern, reason }` desde un catálogo built-in extensible per project vía `config.sonar.false_positives`; (2) **inline ignores** con `// karajan-sonar-ignore: <ruleId>` en la línea del issue (o la anterior), útil para falsos positivos puntuales sin tocar config. Issues filtrados quedan registrados con `_suppressedBy` para auditoría. El catálogo built-in arranca con la regla `javascript:S2699` para `tests/architecture/` y crece según los hallazgos del dogfooding.

**TSK-0413 step D — wire universal de Brain Recovery completado** (#739). El módulo `semantic-detector` usaba la signature legacy `runTask(prompt, opts)` mientras `withBrainRecovery` espera `runTask({ prompt, timeoutMs })`. Un adapter inline en el módulo normaliza la llamada. Era el último caller legacy del pipeline — ahora **todas** las invocaciones a agentes IA pasan por el clasificador universal de Brain Recovery, sin excepciones. Test confirma skip-on-fail intacto: en test env el sleep del wrapper es no-op, el abort viene rápido, semantic detection sigue siendo best-effort.

**Codemod `.replace(/regex/g, …)` → `.replaceAll(/regex/g, …)` en 41 sitios de `src/`** (#738). Mismo comportamiento (replaceAll exige flag `/g`, replace con `/g` lo hacía global por accidente). Semántica explícita, detectada por el propio `kj audit` v2.15.0 como hint de modernización ES2024. El alias `planCommand` se eliminó a favor de `planGenerateCommand` (16 call sites en tests actualizados con `sed` rename). Cero alias muertos en superficie pública del CLI.

**Audit cleanup — BLOCKER false positives refactorizados** (#740). Tests de arquitectura usaban `expect(offenders, "msg").toEqual([])` con mensaje custom como segundo argumento de `expect()`. Sonar no detecta el assert así. Refactor: extraer el mensaje a una variable previa, `expect(offenders).toEqual([])`. Reduce el BLOCKER count del `kj audit` v2.15.0 en 11 (todos eran falsos positivos del mismo patrón, no test sin assert real).

## Fase 71: Collectors estructurales determinísticos del audit — knip + madge (v2.17.0)

**v2.17.0** (minor + breaking engines, 2026-05-18) — 4 PRs (#743–#746), 4 872/4 872 tests passing en 402 ficheros. La conversación interna que motiva esta fase es importante: el dogfooding y el análisis de CodeGraph (npm `@colbymchenry/codegraph`, knowledge graph SQLite-backed) propusieron integrarlo en Karajan para enriquecer triage/coder/reviewer con un índice semántico del repo. La decisión razonada fue **no integrarlo**: el value-prop de CodeGraph (94 % fewer tool calls en exploración interactiva) no traslada a un orquestador donde el scope ya viene acotado por el planner; el coste (SQLite, tree-sitter wasms, worker threads con WASM heap leak workaround, FileLock cross-process, hard-exit en Node 25) contradice la filosofía declarada de mantener KJ simple. La alternativa: atacar los **mismos problemas** (dead code, ciclos de imports) con dos herramientas npm puras y maduras — **knip** y **madge** — incorporadas como `dependencies` directas para que `kj audit` las consuma siempre, sin opt-in.

**Madge circular-deps collector** (#744) — dimensión `architecture`. Detecta cadenas de import circulares vía `madge` invocado programáticamente. Stack-aware: solo activa si el stack contiene JS/TS; proyectos Python/Go/Rust devuelven `available:false` y el audit continúa. Honra `tsconfig.json`/`jsconfig.json` para path-aliases. Excludes built-in: `node_modules`, `dist`, `build`, `coverage`, ficheros `.test.*`/`.spec.*`. Timeout 60 s. Severidad heurística por longitud de cadena: ≥4 ficheros = MAJOR (refactor obligatorio típicamente), 2–3 = MINOR. Findings se renderizan en el `deterministic-summary` y se inyectan al prompt del auditor con regla `madge:circular-import` para que el LLM los fold en la dimensión architecture sin tener que adivinarlos.

**Knip dead-exports collector** (#745) — dimensión `codeQuality`. Detecta exports/tipos sin uso (severidad MINOR — pueden ser superficie pública para downstream) y **ficheros sin uso** (severidad MAJOR — casi siempre dead code real). Stack-aware: solo activa si hay `package.json` + JS/TS. Subprocess via `node <knip-bin> --reporter json --no-progress --no-exit-code`, timeout 120 s, buffer 16 MB. Path al binario resuelto via `require.resolve("knip")` + path math, porque knip restringe su `exports` field a `.` y `./session` y no expone `bin/`. Reporta hasta 100 unused-exports/types + 50 unused-files por scan (los excedentes quedan registrados en `truncated`).

**Filtro generalizado** (#743) — el filtro determinístico de falsos positivos de Sonar introducido en v2.16 (TSK-0416) se generaliza a todos los collectors. `src/sonar/issue-filter.js` se mueve a `src/audit/issue-filter.js` con shape extendido: cada rule lleva `{ tool, rule, filePattern, reason }`. Nuevo marker inline `// karajan-audit-ignore: <tool>:<ruleId>` funciona para cualquier collector; el legacy `// karajan-sonar-ignore: <ruleId>` sigue funcionando solo para issues con tool="sonar". `config.audit.false_positives` es la nueva config canónica; `config.sonar.false_positives` queda como alias retrocompatible (entradas tratadas con tool="sonar" implícito). Compat shim en la ruta antigua para no romper imports.

**Catálogo built-in de FPs** (#746) — 4 entradas shipped por defecto que cubren los falsos positivos más obvios de los nuevos collectors: `knip:unused-files` en `tests/fixtures/` (cargados por path en runtime, knip no los ve), `knip:unused-files` en `examples/` (entry points user-facing), `knip:unused-exports` en barrel files `index.{js,ts,mjs,cjs,jsx,tsx}` (legitimate public API surface aunque no haya in-tree caller), `madge:circular-import` en `node_modules/` (defensive, problema de upstream).

**BREAKING engines** — Node `>=20.10.0` → `>=20.19.0` (requisito de knip 6.x). Mismo patrón que el bump v2.8.0 (18 → 20.10). Usuarios en 20.10–20.18 deben actualizar a 20.19+ o 22.12+ antes de instalar 2.17.

**SEA bundle**: knip + oxc-parser + oxc-resolver + madge añadidos a `external` en `esbuild-sea.config.mjs`. Las llamadas `require.resolve("knip")` y `await import("madge")` fallan limpio en el binario standalone → los collectors devuelven `available:false` y el audit continúa sin esas secciones. npm installs tienen las deps en `node_modules` y funcionan normal. Mismo patrón ya usado para `better-sqlite3` + hu-board en v2.13.

Con esto, `kj audit` queda con **5 collectors determinísticos** (sonar, osv, semgrep, madge, knip), todos pasando por el mismo FP filter, todos con flag `--no-*` para desactivarlos puntualmente, y todos con stack gating que los hace no-op en proyectos donde no aplican.

## Fase 72: Consolidación del directorio home — ~/.kj/ dentro de ~/.karajan/ (v2.19.0)

**v2.19.0** (minor, 2026-05-23) — 3 PRs (#781, #782, #783) que cierran la [épica KJC-PCS-0047](https://planning-game.web.app). El estado HOME de Karajan estaba partido entre dos directorios sin ADR: `~/.kj/` guardaba planes, hibernación standby, runs y worktrees; `~/.karajan/` guardaba sesiones, hu-stories, config, webperf, domains y roles. Cuatro implementaciones divergentes de `getKjHome()` habían ido derivando entre `src/plan/plan-store.js`, `src/brain/standby-store.js`, `src/utils/garbage-collector.js` y `packages/hu-board/src/db.js` (el último ya apuntaba a `.karajan/` pero con el nombre legacy). Usuarios nuevos no encontraban sus planes; equipos no podían predecir dónde vivía el estado.

**PR #781 — unificar el resolver.** El nuevo `src/utils/paths.js::resolveHome({ defaultSegment })` es la fuente única de verdad. Precedencia: `KARAJAN_HOME` > `KJ_HOME` (con warning one-shot `[warn] KJ_HOME is deprecated, rename to KARAJAN_HOME` la primera vez del proceso) > tmp VITEST > `~/<defaultSegment>`. La raíz VITEST queda unificada como `karajan-vitest-<pid>-<rand>/<segment>` para que plan-store (`.kj`) y db.js (`.karajan`) compartan el mismo tmp prefix por test run. Tres módulos eliminan su `getKjHome()` propio (~30 LOC menos cada uno) e importan el resolver. Defaults intencionadamente sin cambiar en este PR — solo el mecanismo. +156 LOC netos, 8 tests nuevos de precedencia pasan.

**PR #782 — auto-migrator + hook CLI.** El nuevo `src/utils/home-migration.js::migrateKjToKarajan()` se ejecuta en cada invocación de `kj`. Idempotente vía `~/.karajan/.kj-migrated.json`. Backup tarball en `~/.karajan/backup/kj-pre-migration-<ISO>.tar.gz` ANTES de mover — restaurar es un `tar -xzf` away. `plans/`, `standby/` y `worktrees/` se mueven enteros; `runs/` se mergea con `.karajan/` ganando en caso de colisión de nombres (es la raíz canónica de runs, usada por 4 paths del código de producción). Cross-device seguro (`fs.rename` cae a `fs.cp + fs.rm` con `EXDEV` para overlay mounts, volumes docker, NFS). Guard VITEST para que tests con `KJ_HOME` nunca migren contra el HOME real del developer. Hook en `src/cli.js` con static import (el migrator corre siempre — sin beneficio de lazy-load, y el budget arquitectónico de imports dinámicos no debe crecer por un caller permanente). +182 LOC netos, 5 escenarios de migración testeados.

**PR #783 — flip de cada default a `~/.karajan/`.** Plan-store, standby-store y garbage-collector ahora resuelven su segment a `.karajan`. El legacy `getKjHomeLegacy()` queda eliminado (no quedan callers). El `sync.js` del HU Board en `fullScan()` y `startWatcher()` lee AMBAS ubicaciones (`~/.karajan/plans/` y `~/.kj/plans/`) para que los usuarios que arranquen el board antes de cualquier comando `kj` post-upgrade — el trigger del auto-migrator — sigan viendo updates en vivo. Nueva check de `kj doctor` `legacy-kj-home` reporta `~/.kj/` sin migrar con severidad `warn` y la línea fix `Run any kj command (e.g. kj doctor) — the migrator runs automatically`. +37 LOC contados (docs excluidos), +71 LOC raw.

**Experiencia de usuario.** La primera invocación de `kj <comando>` post-upgrade imprime una línea en stderr:

> `[warn] Migrated 12 plans + 3 standby from /home/user/.kj to /home/user/.karajan (backup: /home/user/.karajan/backup/kj-pre-migration-2026-05-24T....tar.gz)`

Invocaciones siguientes: silencioso. Usuarios con `KJ_HOME=...` en su rcfile ven además una vez por proceso: `[warn] KJ_HOME is deprecated, rename to KARAJAN_HOME`. `kj doctor` lista `legacy ~/.kj/ directory` como check; antes de migración → `warn` con la línea fix, después → `info` (silencioso).

**Fuera de scope (backlog).** 38 llamadas directas a `os.homedir()` en config / resolve-bin / devtools / webperf / leak-detector / postinstall bypasean el resolver unificado — siempre escriben en `~/.karajan/` literal sin respetar `KARAJAN_HOME`. Trackeado como [KJC-TSK-0420](https://planning-game.web.app); no bloquea. Más 4 paths del código construyen su propia ruta `~/.karajan/runs/`; trackeado como [KJC-TSK-0421](https://planning-game.web.app), refactor puro DRY.

## Fase 73: Patch — fix de packaging de kj board start + housekeeping de la consolidación (v2.19.1)

**v2.19.1** (patch, 2026-05-23) — 4 PRs (#789, #790, #791, #792 release). Un fix **APPLICATION BLOCKER** más los dos follow-ups de la épica de consolidación del directorio home. v2.19.0 había salido con un bug de packaging que rompía `kj board start` para todos los usuarios en una instalación nueva por `npm install -g karajan-code`.

**Fix principal — #791 (KJC-BUG-0056).** Reportado por [@aitormf](https://github.com/aitormf). Dos causas independientes que se combinaban para romper la feature del HU Board en cualquier instalación nueva desde npm:

1. **`packages/` no estaba en el tarball.** El array `package.json::files` del root listaba `src/`, `bin/`, `templates/`, `scripts/` y un par de docs — pero NO `packages/`. Confirmado vía `npm pack --dry-run`: cero archivos del HU Board. Incluso después de que `npm install -g karajan-code` completase con éxito, el directorio simplemente no existía en disco y `kj board start` fallaba antes de poder importar `server.js`.

2. **Las deps del HU Board no estaban en el root.** Aunque los usuarios copiasen `packages/hu-board/` a mano (el workaround que algunos intentaron), conseguían `Cannot find package 'helmet' imported from .../packages/hu-board/src/server.js` — porque las cinco dependencias del HU Board (`helmet`, `chokidar`, `better-sqlite3`, `express`, `express-rate-limit`) estaban declaradas en `packages/hu-board/package.json` pero ausentes del `dependencies` del root. `npm install -g karajan-code` solo resuelve las deps del root, no las de sub-packages no-workspace.

Fix: añadir `packages/hu-board/{src,public,package.json}` a `files`; añadir las cinco deps del HU Board al `dependencies` del root a las versiones exactas que declara el sub-package (para que `npm dedupe` colapse a una única copia alcanzable por traversal hacia arriba desde `server.js`); regenerar `package-lock.json`. Verificado end-to-end: `npm pack` envía ahora 28 archivos del board (vs 0 antes); `node packages/hu-board/src/server.js` arranca limpio.

**Interno — #790 (KJC-TSK-0420).** 38 callers directos de `os.homedir()` enrutados por los helpers de `src/utils/paths.js`. `KARAJAN_HOME=/some/path kj <anything>` redirige ahora TODOS los componentes a `/some/path/…` — no solo plans / standby / sessions, sino también el cache de webperf, el run-registry, el board prompt bridge, el token de auth del HU Board, `hu-board.pid`, el config viewer del board, y el check de dir-setup de `kj doctor`. Tres helpers nuevos (`getWebperfDir`, `getRunsDir`, `getPromptsDir`), y `packages/hu-board/src/db.js::getKjHome` ganó prioridad de `KARAJAN_HOME`. Los callers no-Karajan legítimos (lookup de bin npm-global, fs-leak detector, configs de terceros en `~/.claude.json` y `~/.codex/config.toml`) quedan intactos.

**Interno — #789 (KJC-TSK-0421).** 5 construcciones inline de `~/.karajan/hu-board-runs/` (una en `garbage-collector.js`, cuatro a lo largo del paquete HU Board) unificadas bajo un único helper `getHuBoardRunsDir()` en `packages/hu-board/src/db.js`. Refactor puro DRY — sin cambio semántico. Cierra la deuda técnica secundaria de KJC-PCS-0047.

## Fase 74: Patch — recuperación automática del 401 de SonarQube (v2.19.2)

**v2.19.2** (patch, 2026-05-23) — 2 PRs (#793 fix, #794 release). Cierra [KJC-BUG-0057](https://planning-game.web.app), el segundo bug reportado por Aitor el mismo día que KJC-BUG-0056. El fix del board en v2.19.1 desbloqueó `kj board start`, pero `kj run` y `kj audit` le seguían fallando con `SonarQube authentication failed (HTTP 401)` aunque admin/admin funcionaba en la UI de Sonar.

**Causa raíz.** `bootstrapSonarToken()` vive en `src/sonar/token-bootstrap.js` desde v2.10.2. Probe admin/admin contra el host de Sonar, rota la password por defecto si sigue en su sitio (persistiendo la nueva a `~/.karajan/sonar.admin-password`), revoca el token `karajan-cli` existente y genera un `GLOBAL_ANALYSIS_TOKEN` fresco. Plumbing sólido. Pero **solo se invocaba desde `kj init`**. Cualquier otro código path que tocase Sonar con un token ausente / stale / revocado / de instancia inconsistente tiraba `SonarApiError` HTTP 401 con el hint "Regenerate with `kj init`" — forzando al usuario a hacer plumbing que Karajan tiene credenciales para hacer solo.

El feedback del usuario fue inequívoco: *"Si karajan ve que no funciona sonar, que tiene el user/passw, que genere nuevo token, karajan debe tener capacidad de hacer esto y no tiene que hacerlo la IA, es algo programatico."*

**Fix (#793).** Nuevo `src/sonar/token-recovery.js` exponiendo `recoverSonarToken(config, logger)`:

1. **Latch per-process.** Un Sonar run que 401 en N endpoints dispara UN intento de bootstrap, no N.
2. Llama a `bootstrapSonarToken({ host: config.sonarqube.host })` — código completo de v2.10.2.
3. **Muta** `config.sonarqube.token` en memoria así el retry inmediato usa el nuevo token (sin reload de config).
4. Persiste a `~/.karajan/sonar-credentials.json` vía `saveSonarToken` para que futuros procesos lo capten por la cadena de resolver normal en lugar de disparar recovery de nuevo.

`src/sonar/api.js::sonarFetchOnce` gana una flag oculta `_retriedAfterRecovery`. En HTTP 401:

- Primera llamada → `recoverSonarToken`, recurse con `_retriedAfterRecovery=true`. Si recovery tiene éxito, el retry usa el nuevo token transparentemente y el caller nunca ve el 401.
- Recovery falla → tira `SonarApiError` con hint más accionable apuntando a `~/.karajan/sonar-credentials.json` para guardar admin credentials.
- Retry todavía 401 → tira con hint distinto sobre que la instancia de Sonar está inconsistente.

Programático. Cero LLM. Reportado por [@aitormf](https://github.com/aitormf).

## Fase 75: Home dir canónico del HU Board (v2.19.3)

**v2.19.3** (patch, 2026-05-23) — Cierra KJC-BUG-0059. PR #795. Reportado por [@aitormf](https://github.com/aitormf).

La consolidación del directorio home de v2.19.0 (Fase 72) renombró el root canónico de planes de `~/.kj/plans/` a `~/.karajan/plans/` y trajo un auto-migrator que físicamente movió cada plan existente. La migración en sí funcionó — pero cinco call sites bajo `packages/hu-board/` todavía tenían el path legacy hard-coded como default, supervivientes de la consolidación porque la Fase 72 solo tocó `src/`. Tras el migrator (o tras crear cualquier plan nuevo post-v2.19.0), los planes vivían bajo `~/.karajan/plans/<slug>/`; el board seguía mirando bajo `~/.kj/plans/<slug>/` y no encontraba nada — así que la UX del board colapsaba aunque el resto de `kj` funcionase perfecto.

Los síntomas user-visible eran seis:

1. `GET /api/projects/:id/preflight` no podía extraer `projectDir` de ningún plan → la card top mostraba `Directorio del proyecto — no detectado` (el literal que Aitor vio).
2. `GET /api/projects/:id/plans-outcome` devolvía `plans: []` para todo proyecto que solo tuviese planes post-v2.19.0.
3. `DELETE /api/projects/:id` barría la ruta incorrecta, dejando dirs residuales `~/.karajan/plans/<slug>/` en disco tras un 🗑 delete.
4. `DELETE /api/plans/:planId` escaneaba el root incorrecto → fallaba silenciosamente al borrar el fichero de plan.
5. `packages/hu-board/src/preflight.js::checkPlans` no encontraba planes aun habiéndolos válidos.
6. `packages/hu-board/src/plan-mutations.js::plansRoot` ESCRIBÍA nuevos run logs per-HU al root legacy, partiendo el estado entre ambos dirs y nunca siendo GC'd por `cleanup-zombies.js` (que también escaneaba solo el root legacy).

El fix es de dos capas, espejando la disciplina de resolver establecida por la Fase 72.

**Capa 1 — tres exports nuevos en `packages/hu-board/src/db.js`:**

- `getHuBoardPlansDir()` — root canónico (`~/.karajan/plans/`, o override `KJ_PLANS_DIR`).
- `getHuBoardLegacyPlansDir()` — root legacy (`~/.kj/plans/`, null cuando `KJ_PLANS_DIR` está set para que un override explícito no pueda dual-scanear).
- `getHuBoardPlansDirs()` — ordenado `[canonical, legacy?]` para read callers que necesiten iterar ambos durante la ventana de migración.

**Capa 2 — callers separados por intent.** Los paths single-writer (`plan-mutations.js::plansRoot`) usan solo el resolver canónico. Todos los paths de read / delete / GC (los cuatro endpoints de `api.js`, `preflight.js::checkPlans`, `cleanup-zombies.js`) iteran `getHuBoardPlansDirs()` para que los usuarios mid-migration con planes aún bajo `~/.kj/` no sufran regresión encima del bug original.

Esto mantiene el board estrictamente future-canonical para estado nuevo (no más splits de writes entre ambos roots) mientras sigue siendo read-compatible con el root legacy hasta que el auto-migrator de la Fase 72 termine de mover todo. El lookup legacy se eliminará cuando la telemetría de Karajan indique que el migrator ha corrido en > 99% de instalaciones (trackeado vía el marker file `.kj-migrated.json`).

29 ficheros de test del hu-board / 349 tests siguieron verdes a través del fix — la suite existente ya cubría los endpoints relevantes mockeando las env vars; el fix los desbloqueó también. No fueron estrictamente necesarios tests nuevos, pero una cohorte futura de tests de integración sobre el path de fallback legacy (planificada para v2.20.0) cerrará el comportamiento.

Budget de LOC: +108 / -44, net +64. Dentro del límite hard de 200. Una PR, una bug card, un release — fix patch-sized para un bug patch-sized.

## Fase 76: kj resume continúa desde checkpoint + autoInit deja de hacer commits zombie (v2.19.4)

**v2.19.4** (patch, 2026-05-24) — dos bugs cerrados en un solo release. PRs #797 y #798, ambos reportados durante el ciclo de v2.19.3.

### KJC-BUG-0058 — `kj resume` re-ejecutaba researcher + architect + planner (PR #798)

Reportado por Aitor Martínez con screenshot: una sesión pausada durante Sonar, al reanudar con `kj resume <sessionId>`, mostraba `[researcher] Read ...` en el terminal segundos después. Todo el pipeline pre-loop — HU-reviewer → intent → discover → triage → domainCurator → researcher → architect → planner — re-ejecutaba desde cero. Las stages caras de LLM volvían a correr. El value-prop de resume ("continúa donde paraste") quedaba vacío.

Causa raíz de dos capas. **Capa uno**: `resumeFlow` en `src/orchestrator/flow-runner.js:280` cargaba la sesión y llamaba a `runFlow` sin pasar ninguna señal sobre qué stages estaban ya hechas. **Capa dos**: `runFlow` → `initFlowContext` (init-context.js:175) inicializaba `ctx.stageResults = {}` incondicionalmente; `runPreLoopStages` (pre-loop.js:62) re-ejecutaba cada stage. La sesión SÍ mantenía outputs de pre-loop en `ctx.stageResults` durante el run — pero nada los volcaba a `session.json`. El estado nunca cruzaba la frontera de proceso.

El fix es de dos capas, espejando el bug.

**Capa uno — persistencia.** Dos nuevos mutators en `src/session/mutators.js`:

- `setStageResult(session, name, result)` — puebla `session.stage_results[name]` y añade `name` a `session.stages_completed[]`. Idempotente en el array.
- `setStageBundle(session, name, bundle)` — añade `session.stage_bundles[name]` para cross-stage context que el stageResult solo no puede cargar. `researchContext` de researcher, `architectContext` de architect y `plannedTask` de planner son requeridos por stages downstream y viven SOLO en memoria hasta que el bundle los persiste. `setStageBundle` además llama a `setStageResult` para que los readers legacy y el resumeSkip path sigan funcionando a través de un único entry point.

**Capa dos — driver.** Dos closures dentro de `runPreLoopStages`:

- `persistStage(name, result)` — escribe `stageResults[name]`, llama a `setStageResult`, llama a `saveSession`. Captura errores de save y loguea `warn` — un FS flaky no debería abortar un run largo.
- `resumeSkip(name)` — devuelve true cuando `stageResults[name]` ya está poblado (rehydratado de la sesión cargada), emite evento de progreso `stage:skipped` y una línea de log.

Sitios cacheables envueltos: huReviewer (dos entry points — primera stage y auto-activación post-triage), intent, discover, domainCurator, researcher, architect, planner. Researcher / architect / planner llaman además a `setStageBundle` para que resume pueda replay de su context cross-stage.

**Triage NO se skipea en resume.** Produce `roleOverrides` que stages downstream y el Brain decisor necesitan; re-ejecutarla es el path seguro y es la stage pre-loop más barata. Las stages caras que custodia (researcher, architect, planner) SÍ se skipean si están completas.

El entry point de la rehydratación es una línea en `init-context.js`:

```js
ctx.stageResults = { ...(ctx.session?.stage_results || {}) };
```

Ese spread es lo que permite a `resumeSkip` detectar stages completadas sin un nuevo flag enhebrándose por toda la cadena.

Budget de LOC: +197 / -43, net +154. Dentro de 200 hard / 150 ideal. 10 ficheros de test / 57 tests de orchestrator siguieron verdes; nuevo test `tests/orchestrator/resume-skip-stages.test.js` pin del contract.

### KJC-BUG-0060 — `autoInit()` commiteaba vacíos en main del usuario (PR #797)

Reportado durante el propio release de v2.19.3: tras `git checkout main`, `git status` mostraba `[adelante 27]` ante origin/main. Cada uno de los 27 commits titulado `initial commit`, autor el `user.email` local de karajan-code (que diverge del global), tree apuntando al **mismo árbol que su parent** — completamente vacíos. El reflog acumulaba **2 495 SHAs** del mismo patrón desde abril 2026. Ninguno había llegado nunca a origin/main (el push o CI los habrían rechazado), runtime impact cero, pero en cada release la historia local parecía pérdida de sync.

Causa raíz: `src/orchestrator/config-init.js::autoInit()` guardaba con `!(await exists(projectDir/.git))`, que falla por dos vías.

1. **Dogfooding kj sobre karajan-code mismo** (kj-linked apunta al source tree). Cuando `kj run` se invoca desde cualquier subdir del repo, `initFlowContext` (drivers/init-context.js:42) pasa ese subdir como `projectDir`. El subdir no tenía `.git/` propio → `exists()` devolvía false → el siguiente `git init` reinicializaba el `.git/` del *padre* (idempotente, inofensivo), y el `git commit --allow-empty` resolvía hacia arriba al repo padre y aterrizaba commit vacío en `main`.
2. **Race FS transitoria.** EACCES / ENOENT durante un scan concurrente de `.karajan/` flipearían `exists()` a falso negativo y dispararían el mismo bug.

Fix: cambio el FS probe estático por la upward-traversal del propio git.

```js
try {
  execFileSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: projectDir, stdio: "pipe" });
  // ya dentro de un work tree — propio o de un padre — bail out
} catch {
  execFileSync("git", ["init"], { cwd: projectDir, stdio: "pipe" });
  // YA NO `git commit --allow-empty`
}
```

Dos cambios en un solo fix.

1. `rev-parse --is-inside-work-tree` hace la misma búsqueda hacia arriba que git usaría para el commit; el guard no puede discrepar con la operación que custodia. Los FS probes false-positive son irrelevantes; si git dice que estamos dentro de un work tree, ningún commit cae en el sitio equivocado de todos modos.
2. El seed commit vacío se elimina. Ninguna stage downstream (diff, review, coder, sonar) necesita un root commit; los 2 495 zombies nunca rompieron nada. El seed era decorativo y resultó ser el síntoma user-visible real.

Budget de LOC: +117 / -9, net +108. Dentro de 200 hard / 150 ideal. 9 ficheros de test / 54 tests de orchestrator siguieron verdes; nuevo test `tests/orchestrator/config-init-autoinit.test.js` pin de los tres escenarios de aceptación (subdir de repo, dir limpio, repo propio).

## Fase 77: Cluster HU Board polish + UX papercuts (v2.20.0)

**v2.20.0** (minor, 2026-05-24) — cinco cards en el cluster HU Board polish: dos features net-new (HU `PREFLIGHT-000` auto-inject + wizard de scope `kj init`), dos PG housekeeping syncs de trabajo ya aterrizado (botón Stop + auto-cleanup ampliado), un docs refresh.

El tema unificador: **dejar de hacer al usuario recordar el plumbing de Karajan**. Cada card mueve una responsabilidad que estaba sentada en el mental stack del usuario al propio Karajan. No hagas al usuario añadir un step `Verify env` a cada task.md — inyéctalo. No hagas al usuario editar YAML para cambiar provider del coder por proyecto — dale un flag de scope. No le hagas matar PIDs a mano desde un terminal cuando el board puede hacerlo. No le hagas re-descubrir SPEC conventions vía dogfooding — documéntalas.

### KJC-TSK-0397 — HU `[PREFLIGHT-000]` auto-inject (PR #801)

Cada `kj plan generate` termina ahora con una llamada `prependPreflightHu(plan, projectDir)` que muta el plan en sitio antes de `savePlan`. La nueva HU se sienta en `plan.hus[0]` con id `PREFLIGHT-000`, task_type `infra`, blocked_by `[]`. Cada otra HU recibe `PREFLIGHT-000` añadido a su `blocked_by` (idempotente — ids ya presentes no se duplican). Los `acceptance_tests` de la HU son shell puro, stack-aware:

- Siempre: `git status --porcelain | (! grep -q .)` — el working tree debe estar limpio.
- Node / TypeScript: `node --version` matchea `v2[0-9]` o superior; `npm install --no-audit --no-fund`; `npm test` y `npm run lint` condicionales solo si esos scripts existen.
- Python: `python --version` matchea `Python 3.(1[0-9]|[2-9][0-9])`; `pip install -r requirements.txt` si existe o `poetry install` / `pip install -e .` para pyproject; `pytest --collect-only || true` para que el collect phase no blockee en un repo fresh-init sin tests aún.
- Proyecto Firebase (detectado por `firebase.json`): `firebase projects:list`.
- Proyecto GCP (detectado por `.gcloudignore`): `gcloud auth list --filter=status:ACTIVE` no vacío.

La idempotencia es un contract, no un detalle. El mismo plan fluye a través de structural-pass + plan-fixer + spec-reviewer antes de `savePlan`, y cualquiera de esos puede pasarlo por `prependPreflightHu` más de una vez. Lo mismo para usuarios que declaran manualmente `[PREFLIGHT-000]` en su task.md — `hasPreflightHu(plan)` hace pattern match conservador en id y en substrings del title (`preflight-000`, `verificar entorno`, `preflight check`) para respetar la HU del usuario.

El flag `--no-preflight-hu` opt-outs por invocación. El default del flag es "on" — el default de la *feature* es preflight gating. Seis tests CI + cuatro tests e2e que pre-datan la feature fueron actualizados para pasar `--no-preflight-hu` (asertan sobre plan shapes que no incluyen `PREFLIGHT-000`); el nuevo contract tiene sus propios 6 acceptance tests en `tests/plan/preflight-hu.test.js`.

LOC: +197 / -4 (preflight-hu.js 102 líneas + test 84 líneas + glue en otros sitios), net +197 — justo bajo el límite hard de 200.

### KJC-TSK-0395 — `kj init` scope wizard + `--global` / `--local` (PR #802)

Hasta v2.20.0, `kj init` siempre escribía en `~/.karajan/kj.config.yml`. No había concepto de scope a nivel CLI aunque `loadConfig` había honrado `<project>/.karajan/kj.config.yml` como capa override durante un tiempo. Resultado: power users que querían `coder=claude` para un repo y `coder=opencode` para otro tenían que editar YAML a mano.

`resolveConfigScope({ flags, interactive })` resuelve el path destino: `--global` → `getConfigPath()`; `--local` → `getProjectConfigPath(process.cwd())`; ambos → throw `Cannot pass both --global and --local`; interactivo + sin flags → `wizard.select(...)` con ambas opciones descritas en texto humano; no-interactivo + sin flags → global (default legacy CI). La función está exportada para que unit tests puedan drivearla sin spinning up el resto de `initCommand`.

La mitad interesante está en `loadConfig`. Antes de v2.20.0, una project config sin contrapartida global se comportaba silenciosamente como una global config — pero sin los defaults merged (`DEFAULTS < global < project`), así que varios campos que el usuario esperaba heredar de la baseline global salían como `undefined`. Casi siempre un error de copy-paste (el usuario arrastró un dir `.karajan/` de otro repo). El nuevo `loadConfig` rechaza con mensaje accionable apuntando a `kj init --global` primero.

Ese único fix convierte el implícito "puedes hacer esto técnicamente pero se rompe" en el explícito "no puedes hacer esto; aquí está lo que sí". El fix surface el error en la primera invocación de `kj` en lugar de esperar hasta que el tercer comando queme tokens contra una config medio-resuelta.

LOC: +120 / -5, net +115. Dentro de 200/150. Cinco nuevos acceptance tests en `tests/commands/init-scope.test.js`; `tests/init-wizard.test.js` existente necesitó tres líneas actualizadas (mock exporta ahora `getProjectConfigPath`, la queue mockResolvedValueOnce prepende `global`, expected select count 15 → 16).

### KJC-TSK-0396 (PG sync) — botón `⏹ Stop` del HU Board

El botón en sí fue shipped por primera vez en v2.10.x (PRs #702 + #703). Lo que el release de hoy añade es el cierre de la card PG con los commits canónicos como evidencia. El wiring merece registrarse aquí porque es el único endpoint del board que cruza la frontera de proceso:

- Frontend: cuando al menos una HU está en `coding`/`reviewing`, el section header renderiza un botón ⏹ Stop rojo junto al running badge. Click → `showConfirm` (estilo destructive) → `POST /api/runs/:planId/stop` por cada `plan_id` único en el set running → `POST /api/sync` → re-render. El botón usa el mismo patrón delegate-on-document que el botón ▶ Run, con `data-plan-id` + `data-pids` para que un HU-launched run y un plan-launched run surfacen igual.
- Backend: `/runs/:planId/stop` consulta `getActiveRuns(planId)` (registry cross-process persistido bajo `~/.karajan/hu-board-runs/`), envía `SIGTERM` a cada PID tracked, sleeps `req.body.timeoutMs ?? 5000` ms, envía `SIGKILL` a cualquiera aún vivo. Luego INCONDICIONALMENTE resetea `stories.status` de `coding|reviewing|running` a `pending` para ese `plan_id` para que un run killed manualmente (Ctrl+C en el terminal launching) aún deje el board en estado consistente. Shape de respuesta: `{ stopped, killed, errors, hu_reset_count }`.
- Cross-process registry: `packages/hu-board/src/run-tracker.js` persiste `{ pid, planId, startedAt }` para que el botón Stop del board pueda matar runs que el usuario lanzó en su terminal (y viceversa, trabajo futuro).

### KJC-TSK-0377 (PG sync) — auto-cleanup ampliado

`packages/hu-board/src/ephemeral-cleaner.js` originalmente apuntaba a cuatro prefijos: `tmp_*`, `test_*`, `demo_*`, `kj-test-*`. PR #683 (v2.12.x) añadió `auto-tmp_*`, `auto-test_*` (cubriendo proyectos auto-batch), `s_*` (placeholders stray con session-id creados por sync handlers cuando un `kj run` aterriza sin `projectDir`), y `plan-*` (el mismo caso para placeholders plan-id). Más semántica `is_test = 2`: 1 significa "usuario marcó como efímero", 2 significa "usuario marcó explícitamente como keep", null significa "fallback a detección por prefijo".

El valor arquitectónico de esta card es la **jerarquía de exempción**: la detección por prefijo es la regla default, pero `is_test = 1/2` es un override por fila. Eso evita que el cleaner se interponga con usuarios que deliberadamente tienen un repo `test_<project>` que quieren conservar.

### KJC-TSK-0385 — refresh de docs/task-templates/spec-conventions.md (PR #800)

Dos secciones añadidas documentando lo que antes era implícito en el prompt del planner:

- **Sección 8** — Headings numerados en un task file (`## 1.`, `### 2.1`, `§5`) activan el campo `spec_section` REQUIRED en cada step emitido. La activación es detectada por `detectSpecSections(task)`; una vez dispara, el planner rechaza dejar `spec_section` null. Usuarios veían findings 'missing spec_section' sin entender la regla de activación.
- **Sección 9** — Cada step ships con 2-4 `acceptance_tests`, mix de `gherkin` (comportamiento observable) y `shell` (comandos concretos exit 0 en éxito), pre-implementación, sin placeholder `npx vitest run`. El planner los compone; el sub-pipeline corre los shell tras cada iteración del coder. El gap estaba entre "veo acceptance_tests en mi plan" y "entiendo para qué son".

Más un fix de path `~/.kj/plans/` → `~/.karajan/plans/` en dos sitios de `plan-generate.md` (post-consolidación home v2.19.0).

## Fase 78: Rol Onboarder brownfield (v2.21.0)

**v2.21.0** (minor, 2026-05-24) — cierra KJC-TSK-0384 en tres PRs. El Onboarder es el puente entre un codebase *existente* y el pipeline de Karajan: digiere lo que el proyecto YA es para que el planner / researcher / coder escriban tareas que encajan, en lugar de escribir tareas que el proyecto no fue construido para absorber.

La unión arquitectónica que abre importa más que el UX win inmediato. El Onboarder es el **prerequisito de la épica Project RAG** (KJC-PCS-0049, arranca en v2.22.0). RAG necesita una señal per-proyecto de "qué vive dónde" antes de indexar inteligentemente; el Architecture Brief es esa señal en su primera forma, machine-readable lo suficiente como para que el indexer se sembré con él.

### PR 1 — collectors deterministas

`src/onboarder/collectors/index.js` expone cinco extractores puros, JSON-serialisables, fail-soft. El contract: toma un `projectDir`, devuelve un JSON value. Sin excepciones en la superficie pública — cada collector captura sus propios fallos I/O y devuelve `null` / `[]` para el slot, así que el `Promise.all` de `collectAll` nunca falla parcialmente. Misma disciplina que el `composePreflightTests` del HU preflight (KJC-TSK-0397): el synthesis step downstream debe poder asumir que el bundle es estructuralmente válido aunque la mitad del proyecto falte.

| Collector | Devuelve | Modo de fallo |
|---|---|---|
| `collectTree(projectDir, { maxDepth = 2 })` | `[{ path, kind, bytes, children? }]` ignorando `node_modules` / `.git` / `dist` / etc. | Subdir ilegible → saltado, walk continúa |
| `collectGitHistory(projectDir, { maxHotFiles = 10 })` | `{ commitCount, branches, hotFiles, headSha }` o `null` en non-git | Resultado entero `null` en greenfield |
| `collectConfigs(projectDir)` | `{ present: string[], scripts: object? }` | package.json ausente → `scripts: null`, otros configs fuera de `present` |
| `collectAdrs(projectDir)` | Rutas relativas matching `adr-N`, `NNNN-*.md`, `architecture*.md` bajo `docs/adr*` y `docs/architecture/` | `[]` cuando no matchea nada |
| `collectAll(projectDir)` | Bundle con cada collector + timestamp ISO `collectedAt` | Slots independientes; nada aborta |

La heurística de hot files es deliberadamente barata: top N por appearance count en `git log --name-only --pretty=format: -n 200`. No es la señal más refinada — un megacommit reciente puede sesgarla — pero suficiente para que el synthesis step pregunte "dónde ocurre el trabajo aquí?" sin un segundo LLM round-trip.

### PR 2 — OnboarderRole + comando `kj onboard`

`src/roles/onboarder-role.js` es la subclase más fina de `AgentRole` del codebase. Deriva el prompt a `templates/roles/onboarder.md` (que vive en la cohorte de AI-rule files y cuenta contra el LOC budget por la two-cohort rule). El parser del rol desempaqueta un bloque markdown con fence si el agente emitió uno, sino trim del raw output; `handleParseNull` devuelve soft-success con cualquier raw output que existiese, así que un proyecto greenfield nunca propaga error hacia arriba.

`src/commands/onboard.js` orquesta el pipeline:

```text
collectAll(projectDir)
  → si flags.noSynth: escribe el bundle raw dentro de un JSON fence, listo.
  → else: OnboarderRole.run({ bundle }) → escribe el Brief markdown parseado.
```

El target de output es `~/.karajan/onboarding/<slug>.md` donde `<slug>` es un basename sanitised de `projectDir`. La función `briefPath(projectDir)` está exportada precisamente porque PR 3 necesita el mismo slug rule para leer la cache determinísticamente — writer y reader comparten una source of truth.

El flag `--no-synth` merece su propio párrafo. Hace dump del bundle raw de collectors sin invocar ningún LLM, útil para dos contextos: runs CI que quieren el snapshot estructural sin pagar el synthesis cost, y cualquier consumer que prefiera leer el JSON directamente (un futuro RAG indexer, por ejemplo).

### PR 3 — `kj plan generate --use-onboarding`

El más pequeño de los tres PRs (net +84 LOC) pero el que cierra el loop. `src/onboarder/cache.js::readCachedBrief(projectDir)` devuelve `{ found, path, content? }`, nunca throw. `kj plan generate` lee el brief cuando el flag está set y lo prepende al planner context bajo un heading `## Architecture Brief (from kj onboard)`. El prepend compone — cualquier `--context` explícito que el usuario pase queda en su sitio, justo debajo del brief.

La semántica de errores es intencional. Sin el flag → sin lectura de cache, sin log line. Con el flag y cache miss → `warn` log para que el usuario note la invocación olvidada de `kj onboard`; planning procede anyway sin el brief. Con el flag y cache presente → el brief fluye, una línea de `runLog` registra el path de inyección. Loud donde importa; silent donde no.

El nuevo flag `useOnboarding` se forwardea por el whitelist explícito en `src/cli/register-plan.js`, espejando la lección aprendida de KJC-TSK-0397: un flag droppeado del whitelist surface como "la feature no funciona" con cero error — nunca confíes en el forward implícito.

### Qué viene después

La épica **Project RAG** (KJC-PCS-0049) abre en v2.22.0. Ocho PRs planeadas:

1. Vector store sobre `better-sqlite3` + `sqlite-vec` (`~/.karajan/rag.db`).
2. Adapter embedder para el endpoint Ollama local existente (`nomic-embed-text` o `mxbai-embed-large`).
3. Chunker (markdown semantic para planes, AST-aware para código).
4. Indexer (chokidar watcher sobre `~/.karajan/plans/` + `projectDir`).
5. Retriever + ranking.
6. CLI: `kj rag <query> [--scope plans|code|all]` + `kj rag index --project <id>`.
7. Tool MCP: `kj_rag_query` para otros agentes.
8. Panel búsqueda HU Board.

El `onboarding/<slug>.md` del Onboarder es la señal seed para la primera pasada del indexer — ya sabe QUÉ es el proyecto, así que el indexer puede elegir estrategias de chunking (por lenguaje) y pesos (hot files primero) sin re-escanear.

## Fase 79: La épica Project RAG entregada end-to-end (v2.22.0 → v2.25.0)

Lo que en la Fase 78 era una frase sobre la siguiente épica aterrizó en cuatro minor releases consecutivos. El patrón fue inusual: la misma épica (KJC-PCS-0049) se estructuró deliberadamente como una secuencia de minors pequeños en vez de un solo bump grande, para que cada capa de integración pudiera publicarse, dogfoodearse y refinarse antes de que la siguiente saliera.

**v2.22.0 — MVP CLI** (6 PRs, pasos 1-6). Cinco módulos neutros bajo `src/rag/`: `vec-store.js` (init sqlite-vec, manejo de BigInt rowid), `embedder.js` (adapter Ollama con `OllamaEmbedderError`), `chunker.js` (variantes markdown + plan + source compartiendo un splitter `windowText`), `indexer.js` (indexing idempotente de fichero + pasada de proyecto), `retriever.js` (cosine sobre `topK*2`, kind boost: plan +0.05, onboarding +0.03, code 0). Más `src/commands/rag.js` con `kj rag index [--with-sources]` y `kj rag query <text> [--scope] [--top-k] [--json]`. El build SEA reventó primero con las deps nativas (better-sqlite3, sqlite-vec); `ragStubPlugin` añadido a `scripts/esbuild-sea.config.mjs` lo resolvió interceptando rutas `/rag/` y `commands/rag.js` en build time para que los binarios SEA salten la compilación nativa. `~/.karajan/rag.db` es el store por defecto; `KJ_RAG_DB` lo sobreescribe.

**v2.23.0 — tres superficies de consumo más** (3 PRs, pasos 7-8 + Camino A). MCP recibe `kj_rag_query` + `kj_rag_index` (`src/mcp/handlers/rag-handler.js`, tool count 25 → 27); HU Board obtiene un panel de búsqueda entre el panel de preflight y el kanban (`POST /api/rag/query` + rag-panel en frontend); los role templates (`templates/roles/{coder,researcher,architect,planner,spec-reviewer}.md`) ganan cada uno una sección 'Prior context (RAG, opt-in)' calibrada por rol — coder/architect/spec-reviewer en `topK:3, scope:'all'`, researcher/planner en `topK:5, scope:'plans'`. Regla compartida en todos los roles: cuando el store responde `empty:true`, proceder sin retrieval, NO bloquear, NO pedir a un humano que haga seed. Frontera de capas establecida: `src/mcp/handlers/rag-handler.js` no puede importar de `src/commands/rag.js` (capas pares); ambos consumen `src/rag/*` como neutro.

**v2.24.0 — Camino C: auto-retrieval pre-loop**. `runRagContextStage` (`src/orchestrator/stages/rag-context-stage.js`) corre entre triage y domainCurator. El movimiento arquitectónico que hizo esto 9 LOC en vez de un refactor por cada rol: como `task` es un parámetro string plano que fluye por `runPlanningPhases` hacia researcher/architect/planner vía parameter passing, **una mutación en el pre-loop driver alimenta seis consumidores downstream** con cero cambio de código por stage. Cinco guards impiden que el stage tire excepciones — `disabled`, `no-task`, `empty`, `no-hits`, `error` — y solo uno es un hint al humano (`empty` → "corre kj rag index para hacer seed"). Static imports (no dinámicos) mantienen el headroom del budget de dynamic imports intacto; el SEA stub plugin los maneja transparentemente en build time.

**v2.25.0 — Camino B + Camino D: el plan de superficies de consumo cierra**. Camino B es `templates/skills/kj-rag-query.md`, deployado por `kj init` a `.claude/commands/` para que los Skills hosts sin MCP alcancen RAG por `/kj-rag-query <texto>`. Wrapper delgado sobre el CLI: passthrough flags, renderiza los hits como background context en vez de JSON crudo, surface `empty:true` como hint de una línea que no bloquea la conversación. Camino D es `src/orchestrator/stages/rag-preload-decisor.js` — una heurística pura `shouldPreloadRag({triage, task, config})` cableada en `pre-loop.js` antes de `runRagContextStage`. Nuevo `config.rag.preload.policy`: `always` (comportamiento default v2.24.0, mantenido por back-compat), `never` (benchmarking), `auto` (nuevo default). En modo `auto`, retrieval dispara cuando triage descompone, level ∈ {complex, high, epic}, task body ≥ 200 chars, o `config.rag.preload.brownfield` está activado; si no, el stage persiste `{ skipped: true, reason: 'auto:low-value' }` para que resume + audit vean por qué se saltó retrieval en cada sesión.

**Qué cambió en cómo Karajan piensa sobre los agentes**. Antes de v2.22.0 cada rol-agente asumía que trabajaba desde cold context — task text + role prompt + lo que la memoria de trabajo del host contuviera. Después de v2.25.0 cada rol tiene un camino opt-in al prior context que NO contamina los role prompts (Camino A es per-rol, calibrado; Camino C es one-shot, transparente; Camino B es human-driven; Camino D refina coste). Cuatro puntos de entrada cubriendo MCP, Skills, inyección automática y query explícita — ninguno acoplado a un host específico, y todos compartiendo la misma capa neutra `src/rag/*` debajo.

## Fase 80: RAG Auto-Bootstrap — Ollama en Docker out of the box (v2.26.0)

La Fase 79 cerró el plan de superficies de consumo: RAG alcanzable desde CLI, MCP, Board, role instructions, pre-loop y slash command. Pero el dogfooding de v2.25.0 sacó a la luz un problema estructural que nadie había cuestionado: la feature solo funcionaba si el usuario **ya tenía Ollama instalado en el host**. La dependencia era invisible — ningún path de instalación la mencionaba, y el fallo cuando Ollama faltaba parecía un bug de Karajan.

La Fase 80 convierte el embedder en parte first-class del install de Karajan, exactamente como SonarQube se hizo first-class en v2.7. Tres PRs que replican el patrón de sonar hasta la disposición de los archivos:

**KJC-TSK-0435 — `src/rag/ollama-manager.js` (PR #825)**. Paridad lado-a-lado con `src/sonar/manager.js`: `normalizeOllamaConfig`, `buildComposeTemplate`, `ensureComposeFile`, `isOllamaReachable`, `findAvailableOllamaPort`, `waitForOllamaReady`, `ollamaUp` / `ollamaDown`. `ollamaUp` corta corto cuando el puerto del host ya responde a `/api/tags` (devuelve `reusedHost` para que el caller cablee la instancia existente al config en vez de levantar una duplicada). Con `external: true` e inalcanzable, rehúsa — el usuario optó por no dejar que Karajan maneje el container, así que Karajan no levanta uno silenciosamente.

**KJC-TSK-0436 — Capability + auto-pull + `kj init` (PR #828)**. `src/rag/ollama-capability.js` expone `checkDockerAvailable` y `checkRamCapacity` (>= 4 GB free default). Agregado como `checkOllamaCapability()`. `kj init` corre `bootstrapOllama()` entre `installSkills` y el stack detection. Capability falla → warn con motivo explícito y continúa (init nunca peta sobre el usuario). Capable → `ollamaUp()` → `waitForOllamaReady()` → `docker exec kj-ollama ollama pull nomic-embed-text`.

**KJC-TSK-0437 — `kj doctor` + `kj ollama` (PR #827)**. `src/checks/ollama.js` se enchufa a `buildChecks()` al lado de `getSonarChecks()`. Cuando `rag.preload.enabled !== true` el check reporta `info: Disabled in config`. Si no, hace ping a `/api/tags` y reporta `ok` / `warn` con fix hint apuntando a `kj ollama start`. El subcomando `kj ollama [start|stop|status|pull <model>]` envuelve las capas de manager y capability para que el usuario maneje el lifecycle sin tocar docker compose.

**Bug fix bundled — KJC-BUG-0061 (PR #824)**. El smoke test que motivó la Fase 80 también cazó tres bugs latentes repartidos entre v2.21.0 → v2.25.0: `kj onboard --no-synth` se ignoraba en silencio por Commander mapping; el branch synth invocaba `OnboarderRole.run()` sin `init()`; y `kj rag query --json` en store vacío emitía solo `[]` en vez de `{ hits, empty, topK, scope }`, rompiendo el contrato modo-Skills del wrapper `/kj-rag-query`. Los tres arreglados entre v2.25.0 y v2.26.0.

**Qué cambia para los nuevos usuarios**. Antes de v2.26.0: instalar Karajan → instalar Ollama manualmente → pullear el modelo manualmente → cablear `rag.embedder.url` → correr. Después de v2.26.0: instalar Karajan → `kj init` hace todo lo anterior y te dice si funcionó. Tres cosas menos que pueden salir mal, tres motivos menos para rebotar contra el producto. **Viene en v2.27.0+**: chokidar watcher, chunker AST, BM25+cosine, adapters OpenAI/Voyage.

## Fase 81: Pasada de calidad del RAG — dashboard, tres providers, filtro de metadata, rerank (v2.29.0)

La Fase 80 hizo del embedder un ciudadano de primera del install; la Fase 81 hace **observable y ajustable la salida del retriever**. Cinco PRs aterrizan en un único minor, todos apuntando al hueco entre "el RAG funciona" y "el RAG funciona bien para *esta* query en *este* proyecto".

**KJC-TSK-0445 — Dashboard de retrieval en el HU Board (PR #843)**. Nueva página standalone `/rag.html` servida por el HU Board ya existente. Backend `GET /api/rag/stats` abre la `rag.db` local en read-only y devuelve snapshot: total de chunks, tamaño de DB en disco, timestamp del último indexado, chunks agrupados por kind (`code / plan / onboarding`) y por slug de proyecto (top 20). El embedder activo se lee del `kj.config.yml`. DB inexistente devuelve `{ initialized: false, message }` para que la página muestre estado vacío en vez de petar. El frontend no tiene deps de charting — barras con `<div>` + CSS. Es el puente hacia la Fase 82: visibilidad primero, controles después.

**KJC-TSK-0446 — Cohere + Mistral embedder adapters (PR #848)**. Dos cloud providers más que reusan el `_cloud-base.js` con auth Bearer: `embed-multilingual-v3.0` (1024 dim) para retrieval multilingüe fuerte; `mistral-embed` (1024 dim) para usuarios EU-hosted con GDPR. Env vars `KJ_COHERE_KEY` / `KJ_MISTRAL_KEY` Karajan-scoped — la invariante arquitectónica de no leer nunca API keys con nombre de provider (`COHERE_API_KEY`, `MISTRAL_API_KEY`) se mantiene intacta. El slot "Anthropic via OAuth" del roadmap v2.28 se descarta porque Anthropic no tiene endpoint de embeddings; Cohere + Mistral cubren ese hueco con servicios first-party.

**KJC-TSK-0447 — Embedder local ONNX (PR #850)**. Sexto provider — y el primero totalmente local fuera de Ollama. `src/rag/embedders/onnx.js` envuelve `@huggingface/transformers` (con `@xenova/transformers` como fallback legacy) y corre modelos sentence-transformer directamente en Node. Default `Xenova/all-MiniLM-L6-v2` (384 dim, ~80 MB cacheados primera vez); alternativa de mayor calidad `Xenova/jina-embeddings-v2-base-en` (768 dim). Ambos paquetes transformers son **peer deps opcionales**, no auto-instalados — combined ~500 MB con WASM y ONNX runtime, demasiado para imponérselo a quien nunca elige `provider: onnx`. El adapter lanza hint de install accionable cuando faltan. Desbloquea la Fase 83 (zero-config init): default sensato con **cero** infraestructura.

**KJC-TSK-0448 — Filtro `--where` de metadata (PR #??)**. El retriever ahora acepta restricciones por-chunk con gramática mínima `KEY=VALUE AND KEY=VALUE`. `kind` filtra contra la columna; cualquier otra key cae por `json_extract(c.metadata, '$.<key>') = ?` de SQLite, así cualquier cosa que el chunker emita (`symbol`, `hu_id`, `headingPath`, `file`, …) es queryable sin cambios de schema. El filtro aplica uniformemente a ambos lados (semantic y BM25) del retriever híbrido, así la fusion de scores sigue funcionando. Valores entre comillas para espacios; rechazo de input malformado con error explícito.

**KJC-TSK-0449 — Rerank cross-encoder (PR #??)**. Flag opt-in `--rerank` que re-puntúa los topK supervivientes con un cross-encoder (query, passage) — `Xenova/ms-marco-MiniLM-L-6-v2` por default. Los cross-encoders son más lentos que los bi-encoders (encodean el par junto en lugar de cachear el embedding del passage), así que el reranker corre solo sobre los candidatos post-fusion + post-boost, nunca sobre el corpus entero. Encaja después de los kind+source boosts como palanca de calidad de grano más fino, no como sustituto.

**Qué cambia para los usuarios**. Antes de v2.29.0: "¿está el RAG indexando mi repo?" no tenía respuesta fuera del CLI. Opciones cloud eran OpenAI / Voyage; correr RAG sin cloud ni Docker requería Ollama. Queries con restricciones de metadata necesitaban filtro client-side. La calidad del ranking estaba topada por la fusion del retriever híbrido. Después de v2.29.0: el dashboard responde la pregunta de visibilidad de un click; ONNX responde "quiero RAG sin infra"; `--where` responde "encuentra el chunk donde `symbol=loadConfig`"; `--rerank` responde "quiero el mejor ranking posible y voy a pagar por él". **Viene en v2.30.0+**: config UI editable en el HU Board (toggle roles, swap embedder, ajustar alpha/mode/rerank sin tocar el YAML), luego v2.31 zero-config init (wizard reducido a una pregunta crítica, defaults inteligentes para todo lo demás).

## Fase 82: Config UI editable en el HU Board (v2.30.0)

La Fase 81 hizo observable el retriever; la Fase 82 hace **editable toda la config desde el board**. Cuatro PRs aterrizan el modal de settings end-to-end, cerrando los teaser de v2.29.0 (toggle roles, swap embedder, ajustar alpha/mode/rerank sin tocar el YAML) en una superficie real.

**KJC-TSK-0450 — Toggles de roles del pipeline (PR #854)**. El modal de settings gana una sección "Pipeline roles" donde cada rol opcional (researcher, architect, refactorer, security, audit, rag-context) es un checkbox. Backend usa una whitelist estricta en `packages/hu-board/src/config-yaml.js` (`EDITABLE_FIELDS`) y escritura atómica (escribe a `.tmp`, `rename`, mantiene `.bak`) — la estructura YAML del usuario se preserva, sin reformateo, sin pérdida de comentarios. Cualquier cosa que no esté en la whitelist devuelve 400.

**KJC-TSK-0451 — Controles de RAG (PR #855)**. Sliders + selects para `rag.search.{mode,alpha,rerank}`: `mode ∈ {hybrid, semantic, bm25}`, `alpha ∈ [0, 1]` (peso semantic vs lexical en hybrid), `rerank` toggle. El modal muestra preview en vivo del payload antes de enviar, así el usuario ve exactamente qué se escribe a disco.

**KJC-TSK-0452 — Secciones agrupadas en el modal de config (PR #856)**. Reorg visual: Pipeline / RAG / Coder / Reviewer / Brain en bloques colapsables. Reduce el scroll y mantiene usable el modal cuando la superficie de config crece — sin esto, v2.30 sentiría como un muro de fields.

**KJC-TSK-0453 — Toggle de scope (PR #857)**. La grande: cada sección ahora tiene un switch "Scope: global / project" decidiendo dónde aterriza la escritura. `'global'` → `~/.karajan/kj.config.yml`; `'project'` → `<projectDir>/.karajan/kj.config.yml`. `projectDir` se resuelve igual que el journal-parser (`process.env.KJ_PROJECT_DIR || process.cwd()`). Cuando ambos ficheros existen, el config a nivel proyecto gana — matching las reglas de precedencia del CLI de Karajan.

**Qué cambia para los usuarios**. Antes de v2.30.0: cambiar un toggle de rol o un embedder significaba abrir el YAML a mano, esperando no romper la indentación. Después de v2.30.0: abrir el board, click en settings, flip al toggle, elegir el scope. El atomic write + `.bak` lo hace seguro; la whitelist lo deja sandboxed. **Viene en v2.31.0+**: zero-config init wizard reducido a una pregunta crítica con defaults inteligentes — ahora que la config es editable desde el board, init puede shippar un `~/.karajan/kj.config.yml` mínimo y dejar que el usuario rellene el resto visualmente en vez de por prompts.

## Fase 83: HU Board compartido en equipo (v2.31.0)

La Fase 82 cerró la historia de edición per-máquina; la Fase 83 cierra la historia **multi-máquina**. El HU Board ahora modela un cohort: un plan puede vivir en `~/.karajan/plans/<planId>/` (solo local) o en `.karajan-shared/plans/<planId>/` (compartido entre todas las máquinas que corren Karajan sobre el mismo proyecto). Siete PRs (#859–#865) aterrizan el flujo end-to-end y cierran el prerequisito de larga data KJC-PRP-0002.

**KJC-TSK-0456 / KJC-TSK-0457 — Merge en loader + badge en scanner (PR #859 / PR #860)**. `loadPlan()` lee tanto el plan local como el cohort compartido y fusiona HUs por `id`. El scanner del board hace un sibling scan sobre `.karajan-shared/`, marca `is_shared = 1` en cada chunk que viene de allí, y la respuesta de `/api/plans/:id/hus` expone un booleano `shared`. El frontend renderiza un badge `shared` junto al id de la HU — la pertenencia al cohort es visible sin abrir el fichero del plan.

**KJC-TSK-0458 — CLI `kj plan share <planId>` (PR #861)**. Comando nuevo. Copia el directorio del plan desde `~/.karajan/plans/` a `<projectDir>/.karajan-shared/plans/` atómicamente (escribe a `.tmp`, `rename`). Rechaza sobreescribir un plan ya compartido salvo con `--force`. El comportamiento por defecto comparte el plan entero; los filtros opcionales `--only id1,id2` / `--exclude id3,id4` llegan en PR4.

**KJC-TSK-0459 — `kj plan unshare` + cableado del badge `shared` (PR #862)**. `kj plan unshare <planId>` elimina la copia compartida; la local sigue intacta. El badge del board sigue al cohort en vivo — haces unshare un plan y el badge desaparece en el siguiente scan, sin reiniciar el server. Un nuevo `projectIsSharedCache` memoiza el lookup per-proyecto para que la UI no machaque la API en cada render de HU.

**KJC-TSK-0460 — Filtros `--only` / `--exclude` (PR #863)**. El comando share gana filtrado selectivo. `--only` acepta una lista comma-separated de HU ids; solo esos se copian al cohort. `--exclude` es el inverso. Mutuamente excluyentes, con validación de que cada id existe en el plan. Permite que un runner comparta *partes* de un plan mientras mantiene el resto local.

**KJC-TSK-0461 — Config `sharedConflictPolicy` (PR #864)**. Cuando el mismo id de HU existe tanto en el cohort local como en el compartido (ediciones concurrentes en distintas máquinas), `sharedConflictPolicy` decide qué hace `loadPlan()`: `'local-wins'` (default, fast path), `'shared-wins'` (el cohort es la source of truth), o `'error'` (rechaza cargar y fuerza resolución manual). Configurable en `kj.config.yml` bajo `huBoard.sharedConflictPolicy`.

**KJC-TSK-0462 — Campo `assignee` por HU (PR #865)**. Nuevo field en la whitelist `EDITABLE_HU_FIELDS`. String libre (un nombre, un id de máquina, un email) para que dos runners trabajando sobre el mismo cohort puedan reclamar su parte. Persiste vía el mismo atomic-write path que los demás fields editables de HU.

**Qué desbloquea**. v2.31.0 cierra el prerequisito de team-shared HU Board (KJC-PRP-0002) — el último item del roadmap antes de que la reescritura del Brain en v3.0 pueda apoyarse en un substrato multi-runner estable. Varias máquinas ahora pueden compartir un plan, ver progreso de las demás en el mismo board, y reclamar trabajo no-superpuesto vía `assignee`, sin pisarse.

## Fase 84: AI Harness Scorecard hardening (v2.32.0)

La Fase 83 cerró el substrato multi-runner; la Fase 84 cierra el gap de **rigor de ingeniería**. KJC-PCS-0051 ("AI Harness Scorecard hardening") corre la suite de dogfooding contra el mismo scorecard interno que Karajan aplica a proyectos cliente — cinco FAILs en una "Plan A" punch list (gate de formatter, reporters de coverage, lint de commits, detector nocturno de drift, linter de seguridad) más dos bug fixes colaterales. Los cinco quick-wins shippan en v2.32.0.

**KJC-TSK-0464 — Job CI `prettier --check` (PR #868)**. El repo tenía `prettier` en dev deps pero ningún gate CI imponiendo el formato. La Fase 84 añade un job `prettier --check` con scope curado a `.github/workflows/quality.yml` que falla el build sobre cualquier fichero sin formatear bajo `src/`, `tests/`, `packages/`, `scripts/` (excluyendo los directorios de snapshots/fixtures). Atrapa el drift en tiempo de PR, no en tiempo de release.

**KJC-TSK-0465 — Coverage v8 + upload de artifact (PR #870)**. La config de Vitest gana un trío de reporters `@vitest/coverage-v8`: `text` (resumen en consola en cada `npm test`), `html` (informe navegable bajo `coverage/`), `lcov` (machine-readable, leído por CI). El job CI sube el directorio `coverage/` como artifact de GitHub Actions retenido 7 días, así que cada PR carga un informe de coverage descargable. El ratchet de thresholds por paquete sigue opt-in — el artifact es la ground truth, no un hard gate.

**KJC-TSK-0466 — GitHub Action de `commitlint` (PR #872)**. `wagoid/commitlint-github-action@v6` corre en cada PR y re-ejecuta las mismas reglas de Conventional Commits que el pre-commit hook local impone. El hook CLI es fácil de saltar con `--no-verify`; el gate de CI no. La Action lee `commitlint.config.mjs` desde la raíz del repo, así que no hay duplicación de reglas.

**KJC-TSK-0467 — Detector nocturno de drift (PR #873)**. Nuevo workflow programado `.github/workflows/nightly-drift.yml` que corre a las 03:00 UTC contra `main`, ejecuta `npm outdated --json` + `npm audit --json --omit=dev`, y postea un comentario a una issue de tracking cuando cualquiera de las dos superficies cambia. Usa `actions/github-script@v8` (la sintaxis v7 fue deprecada upstream). La issue queda abierta como log rotante — el drift es visible sin contaminar la cola de PRs.

**KJC-TSK-0468 — `eslint-plugin-security` (PR #874)**. Añade `eslint-plugin-security@4.0.0` con un set curado de reglas en `eslint.config.js`: `detect-eval-with-expression`, `detect-non-literal-require`, `detect-unsafe-regex`, `detect-buffer-noassert`, `detect-child-process`, `detect-pseudoRandomBytes`. El plugin completo habría encendido cientos de falsos positivos; el subset curado se mantiene útil. Hallazgos netos nuevos: 14 warnings de `detect-non-literal-regexp` tracked como follow-up, ninguno en los paths security-críticos.

**KJC-BUG-0065 / KJC-BUG-0066 (PR #869 / PR #871)**. Los dos fixes colaterales. BUG-0065 reparó 42 tests que llevaban fallando en `main` tras un refactor de los helpers de stage del journal — los tests apuntaban a la firma vieja y fueron atrapados por la baseline run de coverage v8 de TSK-0465. BUG-0066 arregló un `await` ausente sobre `openEditor` en el refine loop del spec-review — sin él el proceso del editor quedaba huérfano y el loop seguía antes de que el usuario pudiera guardar, comiéndose la spec refinada.

**Qué cambia para ingenieros**. Antes de v2.32.0: el CI del propio proyecto era *más blando* que los gates que Karajan aplicaba a proyectos de usuarios vía `kj audit` — formatter sin check, mensajes de commit impuestos solo localmente, sin visibilidad nocturna del drift de deps, lint de seguridad en el roadmap. Después de v2.32.0: el mismo scorecard con el que Karajan te puntúa, Karajan se puntúa a sí mismo. Los siguientes FAILs del punch list (escalar el coverage de `src/mcp/handlers/**` de vuelta a 80/80, resolver los 14 warnings de `detect-non-literal-regexp`) están tracked como tareas standalone, no como release blockers.

## Fase 85: AI Harness Scorecard métrica dorada (v2.33.0)

La Fase 84 cerró los FAILs que el scorecard externo señaló contra Karajan; la Fase 85 cierra el loop al revés — **el scorecard se convierte en una señal de primera clase dentro del propio audit de Karajan**. KJC-PCS-0051 Plan B convierte `kj audit` en un loop continuo de medición de calidad con un único número dorado y una nota A–F, persistido per-proyecto, sin gastar ni un token LLM en la métrica. Cuatro PRs (#877–#880), todas bajo el shrink-budget.

**KJC-TSK-0470 — Bootstrap Docker de `ai-harness-scorecard` (PR #877)**. `kj audit` auto-pulla ahora `addyosmani/ai-harness-scorecard` en el primer uso y corre un scan one-shot contra el cwd. El bootstrap reutiliza el mismo patrón default-on-con-`--no-*` que estableció el auto-bootstrap de Ollama en v2.26.0 — no instalas nada, no entregas nada manualmente; el único requisito es un daemon Docker corriendo. `--no-harness` permite opt-out en entornos air-gapped. Runtime warm ~10 s; pull-en-primer-run ~30 s una vez y nunca más.

**KJC-TSK-0471 — Integración en el report de audit (PR #878)**. La salida del harness (un score determinista 0–100 más una nota A–F más booleans por check) se splice en el headline del audit report junto al tally de findings deterministas. Paridad CLI/MCP preservada; el payload JSON expone `harness.score`, `harness.grade`, `harness.checks[]` para que tooling downstream (paneles del HU Board, dashboards custom) pueda leer la métrica sin re-correr el scan. La sección del harness va POR ENCIMA de los findings del LLM — es lo primero que ve el usuario porque es la señal más barata y más confiable.

**KJC-TSK-0472 — DB de histórico per-proyecto (PR #879)**. Cada run de audit se persiste en `.karajan/audit-history.db` — un store SQLite per-proyecto, WAL-mode para lecturas concurrentes durante un run, `PRAGMA user_version=1` para migraciones versionadas. El schema captura `run_id`, `started_at`, `score`, `grade`, `checks_json`, `commit_sha`. Per-proyecto (no global): la DB vive dentro del `.karajan/` del repo, así cada codebase lleva su propio histórico de puntuación; gitignored por defecto. Las migraciones versionadas significan que futuros cambios de schema (añadir `branch`, `harness_image_sha`, …) ratchearán hacia adelante sin romper runs viejos.

**KJC-TSK-0473 — Diff vs baseline + sparkline de tendencia (PR #880)**. El audit report muestra ahora el delta vs el baseline anterior (`Δ +7 vs run #12 de 2026-05-21`) y un sparkline Unicode opcional (`▁▂▃▄▅▆▇█`) con la tendencia de los últimos N runs. Edge cases enumerados en 12 tests unitarios (`tests/audit/audit-history-display.test.js`): primer run (sin línea de diff), baseline stale (>30 días → marker de warning), mayor delta de la ventana (resaltado), commit SHA faltante (fallback al número de run), sparkline con <2 puntos (suprimido). Módulo de display puro — sin deps nativas, sin stub SEA necesario; el lector SQLite vive en el módulo de audit-history y ya está SEA-stubeado.

**Qué cambia para ingenieros**. Antes de v2.33.0: `kj audit` producía una lista textual de findings LLM; "¿este PR mejoró el codebase?" no tenía respuesta excepto ojeando el diff. Después de v2.33.0: cada run da un número, una nota, un delta vs la vez anterior y un sparkline en el tiempo — todo determinista, todo reproducible, todo gratis. El número dorado permite a un equipo plotear AI-friendliness como una curva sobre un sprint en vez de adivinar si las cosas están mejorando. KJC-PCS-0051 cierra en dos fases: el Plan A (v2.32.0) puso el CI de Karajan tan estricto como el scorecard exigía; el Plan B (v2.33.0) convirtió el scorecard en parte permanente del output de audit de Karajan. 5 250+ tests pasando en 466 ficheros.

## Fase 86: RAG multi-lenguaje + Quality & Observability (v2.34.0)

Dos épicas paralelas — **KJC-PCS-0052** y **KJC-PCS-0053** — cierran en la misma ventana de release. La Fase 86 es la mayor expansión de subsystem de la línea v2.x hasta la fecha: el Project RAG deja de ser una isla JavaScript/TypeScript y gana soporte de primera clase para **Python, Rust, Go y Java**, mientras otra épica convierte la calidad del retrieval de un vibe en una señal medida con golden queries, dedup por content-hash, diversificación MMR y un doc deep-dive. Diecisiete PRs en total, 5 368 / 5 368 tests pasando en 482 ficheros de test.

**KJC-PCS-0052 — RAG multi-lenguaje.** Cuatro chunkers AST embarcan en esta ventana usando **gramáticas WASM de `web-tree-sitter`** vendidas bajo `vendor/tree-sitter-grammars/` para que los binarios SEA sigan funcionando sin descargas en runtime. **Python** (KJC-TSK-0478, PR #884), **Rust** (KJC-TSK-0479, PR #885), **Go** (KJC-TSK-0481, PR #886) y **Java** (KJC-TSK-0486, PR #888) aportan cada uno un chunker que recorre el parse tree, extrae funciones top-level, clases / structs / impls / interfaces y métodos, y etiqueta los chunks con metadata `kind` que el kind-boost re-ranker ya entiende desde JS/TS. Un nuevo **registry de adaptadores de lenguaje** (`src/lang/registry.js` → `adapterForPath(file)`, KJC-TSK-0474 PR-A) enruta cada path de fichero a su adaptador; el indexer cablea `preparePython` / `prepareRust` / `prepareGo` / `prepareJava` junto al path JS/TS existente (KJC-TSK-0480, PR-B.2.4). Los **collectors multi-stack** en `kj audit` (PR-C) reconocen proyectos Python (pyproject/poetry/requirements), Rust (Cargo.toml), Go (go.mod) y Java (pom.xml/build.gradle) y adaptan los checks de dependencias / licencias / SAST en consecuencia; **`kj onboard` multi-stack** (PR-D) espeja la detección para que la experiencia de primer uso sea consistente. El watcher (KJC-TSK-0482, PR #893) sigue ahora extensiones de fuente para cada lenguaje soportado, no solo `.js` / `.ts`.

**KJC-TSK-0455 — Reindex incremental por git diff.** Nueva tabla `vec_store_meta` que registra `last_indexed_commit`. `kj rag index --since <ref>` reindexa solo los ficheros que cambian entre `<ref>` y `HEAD`, en vez de crawlear el árbol entero. Un **hook git post-merge** dispara automáticamente el reindex incremental tras cada merge; un **check de drift pre-run** compara `HEAD` vs `last_indexed_commit` y avisa cuando divergen, para que un índice rancio no engañe en silencio al retriever. Dos PRs (#882, #883).

**KJC-PCS-0053 — Quality & Observability.** **Harness de golden queries** (KJC-TSK-0483, PRs #899 / #900): un nuevo comando `kj rag eval` corre un set curado de queries contra el índice actual y reporta **recall@k** (binario: ¿el doc esperado entró en el top k?) y **MRR** (mean reciprocal rank puro). Un baseline JSON queda commiteado en el repo; cambios en chunker / embedder / pesos hybrid se evalúan ahora contra una señal medible, no vibes. **Dedup por content-hash** (KJC-TSK-0484 PR-A, PR #895): cada chunk recibe una huella sha256; el indexer se salta el re-embed cuando el hash coincide con la fila guardada. **Diversificación MMR** (KJC-TSK-0484 PR-B, PR #896): un pase MMR en la cabeza del retriever (λ=0.5) diversifica el top-k para que el LLM reciba dispersión en vez de N casi-duplicados del mismo párrafo. **Deep-dive de `docs/RAG.md`** (KJC-TSK-0485, PR #894): la referencia dobla su scope — comportamiento de chunker per-stack, matemáticas del pesado hybrid, workflow de eval, semántica del hash-skip, tuning de MMR, particularidades multi-stack.

**Qué cambia para ingenieros**. Antes de v2.34.0: RAG funcionaba muy bien en JS/TS, era una caja negra en otros lenguajes y los cambios de calidad del retrieval se medían ojeando los resultados. Después de v2.34.0: cualquier codebase Python, Rust, Go o Java obtiene la misma calidad de chunker que JS/TS ya tenía; cualquier cambio en el pipeline de retrieval se puede A/B-testar con un único comando (`kj rag eval`) y produce un delta concreto de recall@k / MRR; el índice se mantiene barato de actualizar (hash-skip en el re-embed, `--since` para reindex incremental, hook post-merge para automatización). Los diecisiete PRs (#882, #883, #884, #885, #886, #888, #889, #890, #891, #892, #893, #894, #895, #896, #898, #899, #900) cierran ambas épicas por completo.

## Fase 87: v3.0.0 — movida de runtime a Node 22+ (v3.0.0)

La Fase 87 marca el **primer major** de la línea v3. La historia es corta y poco glamurosa a propósito: **Node 20 llegó a end-of-life el 2026-04-30**, y tres dependency majors que dependen de Node 22 se acumulaban en la cola (`lint-staged 17` necesita Node 22, `commander 15` necesita Node 22.12, `better-sqlite3 12.10` retira los prebuilds de Node 20). En lugar de publicar cuatro minors escalonados que cada uno parchea un constraint, v3.0.0 corta un único major que mete la movida de runtime junto con los dep majors que dependen de ella.

**Sin cambios en API pública.** `kj run`, `kj plan`, herramientas MCP, plantillas de rol, RAG, HU Board, audit, telemetría — todo idéntico a v2.34.0. El cambio breaking es exactamente una línea de `package.json`: `engines.node` pasa de `>=20.10` a `>=22.22.1`. Los adopters que ya están en Node 22 instalan con `npm install -g karajan-code@3` y no notan nada; los que siguen en Node 20 bumpean su runtime primero.

**¿Por qué un major?** Semver. Cambiar la versión mínima de Node es un breaking change para los downstream consumers — punto. La sección `Why a major?` del CHANGELOG deletrea el razonamiento para que los adopters entiendan que el bump de runtime es el breaking change, no ninguna superficie de CLI. La alternativa — cuatro minors escalonados durante un mes, cada uno marcado "soft-breaking, sube Node cuando puedas" — habría repartido el mismo dolor por cuatro ventanas de release sin ganancia.

**Empaquetado en v3.0.0**: PR #918 (KJC-TSK-0500, `engines.node` 20.10 → 22.22.1), PR #920 (KJC-TSK-0491, `lint-staged` 16 → 17), PR #922 (KJC-TSK-0490, `commander` 14 → 15), PR #923 (KJC-TSK-0488, `better-sqlite3` 11 → 12.10), y PR #926 (KJC-TSK-0202, sección de footprint & hardware requirements en el README para que los adopters puedan dimensionar su máquina antes de instalar). 5 368 / 5 368 tests pasando across 487 test files — misma superficie que v2.34.0, mismo verde.

**La migración es un único comando.** `nvm install 22.22.1 && nvm use 22.22.1 && npm install -g karajan-code@3 && kj doctor`. El `~/.karajan/` existente (sesiones, planes, índice RAG, audit history, DB del HU Board) es forward-compatible — nada que migrar a mano. v3.0.0 es una release de bump de runtime + deps, no de features; el próximo minor (v3.1.0) es cuando el trabajo del Brain rewrite se retoma.

## Fase 88: v3.1.0 — Quality gates + housekeeping + auditor (v3.1.0)

La Fase 88 es el **primer minor de la línea v3**. Sin breaking changes; drop-in upgrade desde v3.0.0. La release empaqueta cinco frentes que aterrizaron desde v3.0.0 — dos nuevas quality gates en el pipeline, tres nuevos comandos de housekeeping, un auditor semántico de test-diet, el refactor estructural del HU Board y una tanda de fixes de seguridad + flakes.

**Quality gates.** El pipeline gana dos nuevas etapas. **Tool-correctness judge** (KJC-TSK-0375) es un rol + stage entregado en tres PRs (#964 rol/prompt, #965 extractor de tool calls desde transcripts de agente, #966 stage cableado en quality-gates) que valora si el coder usó las herramientas correctas. **TDD-discipline** (KJC-TSK-0398) llega en tres PRs (#957 módulo + flag de config, #958 helper de stash quirúrgico, #959 cableado al pipeline) y verifica que los tests se escribieron antes que la implementación vía un stash quirúrgico + inspección del diff del working tree.

**Housekeeping.** Tres nuevos flags en `kj clean` (KJC-TSK-0499) — `--repo` (ramas obsoletas, dist, candidatos tmp, PR #930), `--vector-stores` (índices RAG huérfanos, PR #931) y el paraguas `--all` (PR #932 + `docs/CLEANUP.md`). **`kj sync --apply`** (KJC-TSK-0348, PR #967) cierra el loop SPDD escribiendo el parche de drift del canvas con backup.

**Auditor semántico de test-diet** (KJC-TSK-0345, PRs #968 + #969). El nuevo `scripts/audit-test-diet.mjs` + `npm run audit:test-diet` complementa al auditor existente de bucket-LOC con cinco categorías de pérdida de sentido: empty-no-expect, skipped-pending, imports-orphan, deprecated-export, subsumed-candidate. La regla subsumed-candidate exige ≥50% de solapamiento de nombres `it()` además del subset de imports — la subsunción puramente por imports produjo un falso positivo en `tests/budget.test.js` (refinado en PR #969). Se usa para verificar que la suite de 498 tests tiene 0 hallazgos — la suite está limpia.

**HU Board.** Canonical statuses en la API (KJC-TSK-0394, PR #962, los valores legacy disparan una sugerencia) + un refactor estructural de 17 PRs (KJC-TSK-0501, PRs #936–#954) partiendo `packages/hu-board/public/app.js` en módulos `utils/`: formatters, modals, api, sessions-view, board-view, dashboard/graph views, story detail + project picker, preflight + log panel + plan rollup, HU action handlers, project actions modal, story edit form, config editor, command launcher, preflight + run launcher, server-push updates, initialization listeners.

**Fixes**: guards contra prototype pollution en `setDeep` / `setDotPath` (KJC-BUG-0076, PR #933), clasificación Docker del harness-scorecard (KJC-BUG-0077, PR #935), flake del freemem de `ollama-capability` (KJC-BUG-0078, PR #939), pin de clock en e2e de hibernate (KJC-BUG-0079, PR #963), limpieza de tmp dirs en vitest (KJC-BUG-0075, PR #929).

**Stats**: 498 ficheros de test, 5 400+ tests pasando. 39 commits desde v3.0.0. PRs #928–#969 + release #970.

## Fase 89: v3.2.0 — Seguimiento de coste end-to-end (v3.2.0)

Cierra la épica **Cost** (KJC-PCS-0055) — las siete piezas Cost A a Cost G aterrizan en una release, cerrando el bucle desde el gasto en tokens hasta la UI.

**Cost A — registro de pricing** (KJC-TSK-0512). `model-pricing.json` lleva USD-por-token de input/output para Claude, GPT, Gemini y modelos locales. Lookup exacto con fallback por prefijo; versionado para que los adopters puedan auditar los rates que produjeron su factura.

**Cost B — agregador** (KJC-TSK-0513). `aggregateRunCost()` reduce una lista de entries del `BudgetTracker` en `{totalUsd, byModel, byProvider, unknownModelTokens}`. Los tokens de modelo desconocido salen a parte en vez de ser ignorados, así el usuario detecta huecos en la tabla de pricing en vez de fiarse de un total bajo.

**Cost C — schema** (KJC-TSK-0514). Migración idempotente añade `cost_usd REAL` en `stories`. La semántica es nítida: NULL = sin medir, 0 = ejecución gratis real. Cualquier cosa que aplaste ambos en "$0.00" miente.

**Cost D — hook del orquestador** (KJC-TSK-0515, PR #1031). El `BudgetTracker` de la sesión es acumulativo entre todas las HUs, así que una lectura ingenua estamparía cada HU con el total acumulado. En su lugar, `runSingleHu` captura `entries.length` al arrancar y trocea al salir; `setLiveOutcomeUpdater` luego hace lazy-import de `hu-board/db.js` y escribe la suma del slice vía `setStoryCost`. El lazy import mantiene el pre-loop libre de deps del board.

**Cost E — API** (KJC-TSK-0516). `GET /api/projects/:id/cost` devuelve `{totalUsd, byPlan, unknownModelTokens, currency}` para un proyecto. Agrega entre planes, expone leakage de modelo desconocido para que la UI pueda mostrar el disclaimer "$X (Y tokens con pricing desconocido no incluidos)".

**Cost F — badge de card** (KJC-TSK-0517). `formatCost(cost_usd)` devuelve `{label: "$0.02", tooltip: "Estimated cost: $0.0234"}` — dos precisiones atómicas, para que el renderer no pueda mostrar una sin la otra por accidente. Input null devuelve null → badge se oculta → sin "$0.00" engañoso.

**Cost G — chip de cabecera** (KJC-TSK-0518, PR #1030). `formatProjectCostSummary` construye un chip `Total: $1.54` con un tooltip multilínea `By plan: ...` con conteo de HUs. La misma null-safety que F.

**¿Por qué un minor?** Solo aditivo; sin cambios en API ni en superficie CLI. La columna `cost_usd` es nueva pero los lectores downstream o manejan NULL (UI del board, la nuestra) o ignoran la columna completamente (lectores antiguos).

**Stats**: 187 LOC solo para Cost D (bastante por debajo del cap de 200 del budget). Cost A–G envíados como PRs separados para mantener cada slice revisable de forma aislada.

## Fase 90: v3.3.0 — Observabilidad de caché cross-provider (v3.3.0)

Cierra la épica **Phase 0** (KJC-PCS-0056). Karajan tenía el coste end-to-end (Fase 89) pero no el `cache_pct` — un coder podía duplicar la ratio de hits de caché y el journal no se enteraba. Phase 0 cierra ese blind spot en **Anthropic, OpenAI/Codex, Gemini, aider y opencode** mediante ocho slices quirúrgicos Φ0-A a Φ0-H, todos aterrizados en la misma release.

**Φ0-A — passthrough de anthropic** (KJC-TSK-0519). `usage.cache_read_input_tokens` fluye por `claude-agent.js` hasta la entrada del BudgetTracker. Ya era canónico; este slice simplemente deja de descartarlo por el camino.

**Φ0-B — passthrough de codex** (KJC-TSK-0520). `usage.prompt_tokens_details.cached_tokens` extraído del shape de respuesta JSON del codex-cli y normalizado al mismo campo `cached_tokens`. El e2e real está bloqueado por bwrap del host; cubierto por unit tests sobre el shape de respuesta.

**Φ0-C — context-caching de gemini** (KJC-TSK-0521). `usage.cachedContentTokenCount` extraído de la respuesta de la Gemini API. Muestra cold→hot sobre un repo Karajan: 87,9% → 96,8% cache_pct, validando el shape.

**Φ0-D — aider + opencode vía LiteLLM** (KJC-TSK-0522). Ambos envuelven LiteLLM, que normaliza a `usage.cached_tokens`. Un adapter, dos agentes cubiertos.

**Φ0-E — cursor-snapshot del BudgetTracker** (KJC-TSK-0523). `budget.js::computeUsage()` reduce los cuatro shapes de proveedor a un único `cached_tokens` canónico por entrada. `summary()` expone `breakdown_by_role.{coder,reviewer}.{tokens_in,cached_tokens,cost_usd}`. El patrón cursor-snapshot (igual que Cost D) mantiene los slices por HU independientes del tracker acumulativo de sesión.

**Φ0-F — sección "Cache hits" en summary.md** (KJC-TSK-0524). Cada `summary.md` gana un bloque `## Cache hits` con una línea `tokens_in / cached_tokens / cache_pct` por rol. Null-safe: la sección se omite cuando ningún rol expuso datos de caché.

**Φ0-G — badge cached en el HU Board** (KJC-TSK-0525). `formatCacheRatio(cached, tokens_in)` retorna `{label:"🎯 N%", tooltip}` o null. La card oculta el badge cuando `tokens_in=0`, distinguiendo "sin medir" de "0% de ratio de hits" — misma higiene null-vs-zero que Cost F.

**Φ0-H — telemetría computeCachedPct** (KJC-TSK-0526). El evento `pipeline_complete` gana `cached_tokens_pct: { coder, reviewer }`, con `null` por slot cuando su `tokens_in=0`. El tracking-por-cohorte futuro aterriza sin re-instrumentar.

**Datos reales medidos el 2026-06-09 sobre un repo Karajan**: pasada en frío en Claude 47,2% cache_pct ($0,6141), pasada en caliente 94,3% cache_pct ($0,1452) — **76,4% de reducción de coste** sobre una carga de prompt sostenido. Gemini 87,9% → 96,8% sobre el mismo shape. Codex medido por unit tests (e2e real bloqueado por host).

**¿Por qué un minor?** Solo aditivo; sin cambios en API ni en superficie CLI. El badge y la sección de summary se renderizan solo cuando hay medición; los consumidores downstream o honran el nuevo campo o lo ignoran. Drop-in upgrade desde v3.2.0.

**Stats**: ocho PRs en ocho cards. Cada slice aterrizó independientemente, todos bajo el budget de 200 LOC. v3.3.0 es la base para la Fase 1 (planner consciente del coste — elegir modelo por rol según predicciones de cache_pct × cost_usd).

## Fase 91: v3.4.0 — Prompts cache-friendly (v3.4.0)

La Phase 1 del roadmap de caché (épica KJC-PCS-0057) actúa sobre lo que la Phase 0 midió. Cada prompt builder emite ahora un layout `{ stable, volatile }` vía `src/prompts/prompt-layout.js`: el bloque estable (preámbulo, reglas, constraints, skills, contexts) es byte-idéntico entre iteraciones de la misma HU y entre HUs del mismo plan, y se renderiza primero; la cola volátil (task, plan, acceptance tests, feedback del reviewer, git diff) conserva su orden relativo legacy.

Dos palancas según familia de provider: los CLIs de OpenAI/Gemini/LiteLLM cachean automáticamente sobre el prefijo literal de tokens, así que el reorden solo ya los activa; Anthropic cachea sobre breakpoints que su CLI coloca en el system block, así que `ClaudeAgent` envía el bucket estable vía `--append-system-prompt` y solo la cola volátil en `-p`. Rollback implícito: los roles que no proveen buckets mantienen el comportamiento single-prompt legacy.

Medido en runs reales (2026-06-11): coder Claude cold cache_pct 47.2% → 99.60%, hot 94.3% → 99.69%, coste del coder por HU $0.6141 → $0.1447 (−76%). Ambos runs APPROVED con el audit final CERTIFIED. Una suite de regresión prefix-stability (asserts de longest-common-prefix + el mínimo de 1024 tokens de OpenAI + marcadores anti-fuga de volátil) congela el contrato en CI. Seis slices, PRs #1044–#1050.

## Fase 92: v3.4.2 — Hardening post-Phase-1 + el gate pre-publish (v3.4.2)

La línea de mantenimiento que convirtió un ridículo recurrente en una garantía estructural. Tres releases de npm (v3.2.0, v3.3.0, v3.4.1) habían salido sin poder ejecutar ni `kj --version`: la suite de tests corría contra el workspace linkado (los symlinks resuelven todo), mientras que el tarball publicado —con `bundleDependencies` y resolución top-level— nunca se instalaba ni se ejecutaba en ningún punto del pipeline.

v3.4.1 traía la limpieza post-Phase-1 (journal en todos los finales KJC-BUG-0084, cached_tokens del audit KJC-BUG-0085, preflight fail-fast de Sonar KJC-BUG-0083, más el top del audit: escapeRegExp, poda de dead exports, descomposición de regex, fs-async + cache de planes del HU Board) pero rompió el install: `@karajan/core` arrastraba `sqlite-vec` al bundle y su `files: []` lo dejaba sin entrypoint.

v3.4.2 ataca la causa raíz por dos vías. **Resolución**: las deps de runtime de core (better-sqlite3, execa, sqlite-vec) pasan a `peerDependencies`, resueltas completas desde el install del consumidor. **Proceso**: `scripts/verify-pack.mjs` empaqueta el tarball real, lo instala en un tmpdir aislado y ejecuta `kj --version` / `--help`, enganchado como `prepublishOnly` (el publish se aborta solo si el artefacto no arranca) y como job de CI `pack-smoke` en cada PR (KJC-TSK-0553). Un test de regresión `core-no-bundled-deps` congela el contrato de dependencias. v3.4.1 quedó deprecada en npm; v3.4.2 es el primer install 3.x completamente limpio.

## Fase 93: v3.5.0 — Harness de calidad (kj harden + kj check) (v3.5.0)

La épica que convierte "cómo se construyó Karajan" en superficie de producto. `kj harden` (KJC-PCS-0059) instala todo el harness de calidad en cualquier repo —nuevo o existente— en un comando: hooks de git, config de lint/formato/commits, gates de CI y guías para agentes IA, todo idempotente, consciente del stack y delimitado por marcadores `kj:managed` que nunca sobrescriben el contenido del usuario.

La restricción definitoria es **no imponer runtime ajeno**. Los hooks instalados llaman al toolchain del propio proyecto —`go vet`/`gofmt`/`go test` en Go, `ruff`/`pytest` en Python, scripts de package.json en JS/TS— y el hook commit-msg (Conventional Commits + tope de 100 caracteres + bloqueo de atribución a IA) es POSIX puro. Así, endurecer un repo Go, Python o Java nunca convierte a Node en dependencia de commit de sus contribuidores; Node hace falta una vez, en quien ejecuta `kj harden`. Un monorepo fullstack se detecta por raíz de lenguaje, y cada lado recibe su config en su propia carpeta.

`kj check` verifica el harness como gate de deriva en CI (exit 0/≠0, `--json`) y aflora el hueco del greenfield —un lenguaje añadido tras endurecer cuya config nunca se sembró—. `kj init` ejecuta el mismo motor, así que un proyecto recién inicializado queda endurecido de serie. La lógica del harness y la generación de guías se absorbieron del `dev-toolkit` del autor, de modo que Karajan no depende de ningún MCP externo. Once PRs en nueve slices (H-A…H-G + H-B2 + H-C2); 5 717 tests verdes; install limpio verificado.

## Fase 94: v3.6.0 — Harden consultivo (v3.6.0)

El harness aprende a **comparar en vez de solo instalar** (épica KJC-PCS-0060). Un motor de comparación en solo lectura clasifica cada artefacto gestionado de un repo existente como **falta**, **es del usuario** o **gestionado por kj** (al día o desactualizado), reconociendo formatos equivalentes (`.eslintrc.*` legacy, `.commitlintrc.*`, keys inline en `package.json`) para no dar falsos «falta» — y para la config propia del usuario lista las mejoras concretas que aportaría el estándar kj. `kj harden --report` lo muestra por artefacto (más `--json`); `kj harden --interactive` deja adoptar el estándar pieza a pieza, con default seguro (deja lo tuyo salvo que digas lo contrario). El control de alcance —ignora dirs de ejemplos/fixtures por defecto, más `--only`/`--exclude` y `package.json` `kj.harden` por repo— mantiene el endurecido fuera de ejemplos y sub-tools.

La release también redondea el primer uso: `kj init` quita la pregunta de scope en frío, mete el routing avanzado por rol tras un único opt-in, habla un inglés consistente con la jerga glosada, ya no filtra el banner de update de Squeezr, y termina con un siguiente paso claro. Y cierra un hueco real de packaging — la red de seguridad `kj-trash` (snapshots de operaciones destructivas) nunca estaba en el tarball publicado; ahora se publica como bin raíz, blindada por un gate verify-pack ampliado para que no recaiga.

## Fase 95: v3.7.0 — Entrega autónoma (v3.7.0)

La culminación de la visión: dada una spec, Karajan planifica, descompone en HUs y ejecuta hasta terminar **sin humano en el bucle** (épica KJC-PCS-0062). Un único eje de autonomía — `interactive | assisted | autonomous`, resuelto flag > env > config > default — encamina cada decisión que sería humana por un único choke point que o pregunta al humano o se la pasa **al Arbiter**. El Arbiter resuelve los conflictos entre agentes (reviewer vs coder, un test de aceptación que no pasa tras N iteraciones, una spec ambigua) eligiendo la respuesta **menos mala** contra un orden de verdad fijo: los tests de aceptación mandan sobre el must-fix del reviewer, y este sobre el nice-to-have; ante un fallo de parseo degrada de forma conservadora en vez de bloquear.

`kj autorun <spec>` encadena plan → run → informe de resultado de forma atómica con propagación de exit code. En modo autónomo las stages del pipeline nunca se bloquean en una pregunta y un tope de wall-clock garantiza que un run no se cuelgue, así que el bucle siempre termina con un informe **DELIVERED / INCOMPLETE** que lista las HUs cumplidas/no cumplidas y los defectos residuales — la perfección no es el listón, cumplir el encargo sí. El default sigue siendo `interactive`, así que los runs interactivos existentes no cambian ni un byte. El spine se verificó en vivo end-to-end sobre specs reales (coder + reviewer reales, `node --test` en verde, sin humano).

## Fase 96: v3.8.0 — kj start (v3.8.0)

El Brain gana una puerta de entrada. **`kj start [intent]`** es el único punto de entrada al squad autónomo (épica KJC-PCS-0061): el usuario expresa una intención y, como mucho, la madurez del proyecto — el Brain orquesta todo lo demás, en solo lectura, antes de proponer nada. Un **clasificador de madurez** determinista infiere `new | existing | legacy` a partir de señales (solo scaffolding, código real + tests + CI, o salud descuidada) y un **barrido en solo lectura** ejecuta los comandos de evaluación (`doctor` / `check` / `harden` / `onboard`) sin tocar el código del usuario — `init` solo escribe en `.karajan/`. El barrido se condensa en un informe estable, y un **rol decisor** barato elige la siguiente intención de un **conjunto cerrado**; el bucle mapea cada intención que escribe a un comando guardado + args existente y **confirma antes de cualquier cosa que escriba** — el modelo nunca ejecuta comandos por su cuenta, y el usuario nunca tiene que aprenderse `doctor`/`check`/`harden` directamente.

Le acompañan dos movimientos de apoyo. **`kj advanced`** recorta `kj --help` a los comandos esenciales e indexa toda la superficie bajo un único namespace, protegido por un gate de paridad de ayuda. Y la **redacción de secretos inbound** (KJC-TSK-0583) cierra la contraparte del guard de commit outbound existente: una credencial hardcodeada en el working tree llegaba literal al modelo reviewer (posiblemente en la nube) dentro del diff; `src/guards/secret-redactor.js` enmascara ahora cada secreto antes de que el modelo lo vea, reutilizando el catálogo `CREDENTIAL_PATTERNS` existente (determinista, sin coste de IA, no-op en texto limpio) y conservando un prefijo identificable (`AKIA***REDACTED***`, `sk-ant-***REDACTED***`) para que el reviewer aún pueda señalar "muévelo a .env" sin ver jamás el valor.

## Fase 97: v3.9.0 — Binarios standalone (v3.9.0)

Karajan pasa a ser instalable en una máquina sin Node de ningún tipo (épica KJC-PCS-0006). El release distribuye ejecutables `kj` precompilados — `linux-x64` y `win-x64` — construidos con la maquinaria SEA (Single Executable Application) de Node, de modo que toda la CLI es un único fichero autocontenido. Un **instalador sin Node** lo pone en su sitio: `curl -fsSL https://karajancode.com/install.sh | sh` en Unix (`sh` POSIX, sin bashismos) e `irm https://karajancode.com/install.ps1 | iex` en Windows, cada uno verificando el SHA256 del binario antes de que toque el disco, dejándolo en `~/.local/bin` / `%LOCALAPPDATA%\Karajan` y limpiando el bloqueo de fichero descargado del sistema operativo — cuarentena `xattr` en macOS, mark-of-the-web vía `Unblock-File` en Windows — sobre la copia que acaba de comprobar. El aviso de "actualización disponible" ahora distingue el canal: detecta si `kj` corre como binario SEA (`node:sea`) o desde npm e imprime el comando de actualización que corresponde. macOS se distribuyó por npm de momento, mientras el build `darwin-arm64` seguía endureciéndose.

La integridad del release es la otra mitad de la historia, aprendida por las malas de publicaciones rotas anteriores. El tag `v*` ahora **crea la GitHub Release desde la sección del CHANGELOG que le corresponde primero** — la subida del SEA necesita que la Release ya exista, que era el hueco "run failed" post-publish — y cada binario construido debe **pasar un smoke-test (arrancar `--version` / `--help`) antes de que su asset se suba**, así un ejecutable roto se caza en CI y no lo descubre el primer usuario que lo descarga.

## Fase 98: v3.10.0–v3.10.1 — El binario de macOS, hecho realidad (v3.10.1)

El binario de Apple Silicon pasa de "no existe" a "ejecuta una tarea real". **v3.10.0** consiguió que arrancara: el build `darwin-arm64` hacía segfault al iniciar (exit 139) porque `postject` sobre Mach-O necesita `--macho-segment-name NODE_SEA` para que el blob SEA aterrice donde el loader de Node lo busca — sin ello el blob iba a un segmento que el loader nunca inspecciona (KJC-BUG-0096). El flag es solo para Mach-O, así que se aplica únicamente en los builds de macOS. Un job de CI `macos-latest` ahora construye y arranca el binario en cada cambio del build SEA, porque Node upstream solo prueba en CI los single-executables en Linux y un crash de macOS podría, si no, aflorar solo en el momento del release. Mientras duró el hueco, los instaladores dejaron de descargar un binario que no arrancaba y apuntaron limpiamente a los usuarios de macOS hacia npm.

**v3.10.1** consiguió que de verdad funcionara. Arrancar nunca fue prueba de que el bundle estuviera bien cableado: todos los binarios pasaban `--version` / `--help` / `init` pero morían en `kj run` con `maybeAutoUpdate is not a function` (KJC-BUG-0097). El bundler SEA stubea `src/rag/*` para mantener el SQLite nativo fuera del ejecutable, y `src/rag/auto-update.js` caía bajo ese filtro — pero `run.js` llama a su `maybeAutoUpdate()` en cada run. El stub ahora lo reexporta como un no-op silencioso (el auto-update del RAG no está disponible en el binario de todos modos), y el gate `sea-smoke` más el test `sea-build` se ampliaron para ejercitar `kj run` en sí, no solo el arranque. Con eso, el binario de macOS Apple Silicon se distribuye junto a `linux-x64` y `win-x64` en la GitHub Release — objetivo "tenerlo para Mac" cumplido.

## Fase 99: v3.10.2 — Privacidad, contención de rutas y transparencia del triage (v3.10.2)

Un patch que agrupa tres arreglos sin relación entre sí, cada uno digno de publicarse. **Privacidad**: una dirección de correo personal se había filtrado en los metadatos del paquete visibles para el usuario; se reemplaza por el handle público para que los scrapers no puedan recolectarla (#1156) — la misma clase de incidente que convirtió la sanitización de salidas en regla permanente. **Seguridad**: las escrituras de fichero de acción directa (`create_file`, `git_add`) confinaban su destino al directorio del proyecto con una comprobación de prefijo de cadena, que una ruta hermana como `../project-evil` podía sortear; el guard ahora usa un test de contención basado en `path.relative`, de modo que una ruta manipulada no puede escaparse del repo (KJC-BUG-0098). **Observabilidad**: el triage decidía qué roles activar pero exponía solo un `reasoning` global — el *porqué* por rol era invisible. El triage ahora emite un `roleRationale` determinista (rol, activado, fuente, motivo) que refleja la lógica de activación, renderizado bajo el evento `triage:end` para que cada decisión de activar/omitir sea auditable; describe el disparador de cada rol en vez de una afirmación por tarea, así que nunca se inventa. El release también registra los **no-objetivos por diseño** del proyecto en `docs/design-decisions.md` — por qué `npm install` no corre con `--ignore-scripts`, por qué no hay sandbox integrado, por qué no hay config YAML/JSON editable por el usuario — para que las revisiones dejen de reproponerlos (KJC-TSK-0602).

## Fase 100: v3.11.0 — install-tools se convierte en el actuador (v3.11.0)

`kj install-tools` tenía una identidad partida con `kj doctor`: los dos te decían qué faltaba, ninguno lo instalaba. Este release limpia la división — `kj doctor` es el diagnosticador, `kj install-tools` es el **actuador** que sí instala las herramientas externas de auditoría que Karajan no empaqueta (semgrep, osv-scanner, lighthouse, docker, sonar). El comando es un asistente: muestra el comando exacto de cada herramienta e instala al aceptar (épica KJC-PCS-0006). Las primitivas de debajo mantienen las dos promesas de seguridad que hacen fiable a un instalador. Las instalaciones con privilegios ejecutan `sudo` en la propia tty del usuario, así que **kj nunca captura ni registra la contraseña** (KJC-TSK-0606); las descargas de binarios aterrizan en un fichero temporal, reciben `chmod 0755` y luego se renombran atómicamente, de modo que una descarga fallida nunca deja un artefacto a medio instalar. En una máquina sin gestor de paquetes, osv-scanner se instala desde su binario estático de GitHub y semgrep cae a un comando concreto de Docker/pipx en vez de una simple URL de docs (KJC-TSK-0607). Docker en Linux prefiere el gestor de paquetes de la distro (`apt` → docker.io, `dnf` → docker) o descarga el script oficial de Docker a un fichero y lo ejecuta con sudo — **nunca `curl | sh`** — y es opt-in, con el valor por defecto en no y el comando mostrado primero; macOS/Windows apuntan a los docs oficiales (KJC-TSK-0609). Los mensajes nombran el siguiente paso concreto en lugar de una URL: sonar indica que necesita Docker primero, y una herramienta sin gestor de paquetes queda apuntada a `kj doctor` (KJC-TSK-0610). De acompañamiento: tres refinamientos de rol del catálogo comunitario *Augmented Coding Patterns* — disensión de socio activo (KJC-TSK-0603), un micro-gate de alineación (KJC-TSK-0604) y reformulación en positivo de instrucciones de alto impacto (KJC-TSK-0605) — más dos arreglos de instalación: el hook post-merge del RAG respeta ahora `core.hooksPath` para que un repo endurecido reindexe de verdad tras un merge (KJC-BUG-0100), y el instalador de macOS elige el asset `darwin-arm64` (KJC-BUG-0101).

## Fase 101: v3.14.0 — Modo paso a paso y paralelismo gobernado (v3.14.0)

Dos modos de ejecución nuevos. `kj run --step` pone una compuerta tras cada iteración con un informe compacto (veredicto del reviewer, siguiente paso, gasto vs techo) donde las respuestas de texto libre se convierten en directivas que el coder lee en la siguiente iteración. `kj run --parallel <n>` ejecuta las HUs de un plan concurrentemente en git worktrees por HU, planificadas sobre el grafo blocked_by con aislamiento conservador por scope, semáforo compartido y techo de presupuesto por plan; la stage de SonarQube se serializa entre carriles. El camino paralelo, antes sin límite, ahora vale 1 por defecto — secuencial — y es estrictamente opt-in.

## Fase 102: v3.15.0 — Carriles para proyectos reales, proveedores con precio, board desacoplado (v3.15.0)

Tres movimientos convergentes. Los carriles worktree paralelos se hicieron viables en códigos reales: los worktrees nuevos se preparan solos (submodules + instalación de dependencias) y cada carril recibe un slot estable de un registro con lock de fichero, exportado como `KJ_LANE_SLOT` / `KJ_PORT_OFFSET` para que los servicios arrancados por los tests desplacen sus puertos (diseño a partir de la skill worktree-docker-envs de Jorge del Casar). El registro de modelos aprendió Kimi K2 de Moonshot y DeepSeek con precios reales, accesibles vía OpenCode como proveedores OpenAI-compatibles — el tracking de coste deja de ir a ciegas con modelos no nativos. Y el HU Board completó su independencia: el subárbol rag se movió a `karajan-core/rag`, el board resuelve todo a través del paquete, y un test de arquitectura prohíbe imports relativos hacia el árbol del CLI. Dos lecciones operativas quedaron grabadas en el proceso: publicar karajan-core ANTES de mergear a sus consumidores, y la cuarentena por edad de pnpm moderno puede resolver dependencias rancias en silencio (el gate de empaquetado ahora la desactiva).

## Fase 103: v4.0.0 — Karajan Environment: el agente anfitrión orquesta, Karajan gobierna (v4.0.0)

La inversión arquitectónica. Una demo real compleja (2026-07-19) destapó un falso verde integral en el modelo subprocess — un run terminó "approved" sin ninguna pasada del reviewer, sin post-loop y sin push — mientras días del modelo inverso (un humano encargando a un agente anfitrión bajo gates deterministas en git) no dejaron pasar ni un error. La v4 convirtió el modelo inverso en el producto. Tres capas: un **playbook** (`kj env install`) renderizado desde una única fuente a CLAUDE.md y AGENTS.md que ordena el método (RAG antes de codificar, card primero en el `state_backend` configurado, TDD, revisión IA-cruzada); una **primitiva de revisión de primera clase** (`kj review --staged`) que enruta cada diff a una IA distinta del anfitrión y registra el veredicto con clave sha256 del diff crudo; y un **gate de pre-commit** (`kj review --install-gate`, marcador trackeado en git) que rechaza cualquier commit sin veredicto aprobado que case — resolver-hasta-pasar por construcción. El índice RAG se construye en la instalación y se actualiza por delta antes de cada consulta. El pipeline subprocess sobrevive como modo headless: sus sesiones estampan el veredicto de su reviewer interno y ambos mundos comparten un mismo gate. El repo se gobierna con su propio entorno; en su primer commit gobernado, el reviewer cruzado rechazó la versión inicial del autor con dos issues legítimos — el diseño demostrándose a sí mismo el primer día.

## Fase 104: v4.2.0 — Pre-gate determinista: sonar antes de cualquier opinión de IA (v4.2.0)

El gate aprende a medir antes de juzgar. Con el brain fuera del core, saltarse el análisis estático estaba a una decisión de distancia — demostrado el día en que el propio brain metió tres issues de sonar en código nuevo y nada lo impidió. Desde la v4.2.0, `kj review --staged` ejecuta SonarQube como pre-gate determinista: un solo escaneo por máquina (single-flight a través del tool governor de la v4.1.10), findings filtrados a los ficheros CAMBIADOS e impresos antes de cualquier veredicto de IA. Los findings BLOCKER/CRITICAL rechazan en el acto — exit 1, sin invocar al reviewer cruzado, cero tokens gastados en código que un linter ya condenó. Los advisory viajan dentro del task del reviewer para que el veredicto los pondere. Una máquina sin sonar degrada con aviso y continúa — el gate nunca inutiliza un portátil. En su primer uso real, el pre-gate revisó su propio diff y destapó tres issues preexistentes en el mismísimo fichero que lo implementa, corregidos en el mismo PR.

## Fase 105: v4.5.0 — Cualquier board, pero siempre un board (v4.5.0)

El board deja de ser el de kj y pasa a ser el del proyecto — sin volverse jamás opcional. Card-first siempre fue la columna vertebral del método, pero asumía el HU Board propio de kj; los proyectos que ya vivían en Linear, Trello, Jira o GitHub Issues acababan con dos boards a medias, que es peor que ninguno. Desde la v4.5.0 el proyecto declara su backend: el HU Board de kj (default), el MCP del Planning Game, o cualquier board externo por nombre — y el playbook apunta card-first a ESE board, trabajado con los MCP/tools del propio agente anfitrión, con kj negándose a espejarlo. El contrapeso es una garantía: `kj env install` verifica que existe vía de acceso operativa al board declarado — integrado, MCP configurado o token de API exportado — y bloquea con los pasos exactos cuando no la hay, antes incluso de tocar el RAG. No existe `none`: Karajan no funciona sin board, porque el board es lo que hace posible el trabajo en orden, las cards honestas y los carriles con sentido.

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

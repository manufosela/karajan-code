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

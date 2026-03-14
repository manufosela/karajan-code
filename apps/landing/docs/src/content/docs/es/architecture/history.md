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

---
title: Visión General de la Arquitectura
description: Arquitectura de alto nivel de Karajan Code.
---

Karajan Code implementa un patrón de **Orquestación de IA basada en Roles**. El sistema coordina múltiples agentes de IA a través de un pipeline estructurado donde cada responsabilidad (codificar, revisar, testear, seguridad) es un rol discreto e independientemente configurable.

## Principios de Diseño

- **Roles de agente desacoplados.** Cada capacidad IA es un rol separado con sus propias instrucciones, agente y modelo
- **Ciclo de vida estandarizado.** Todos los roles implementan la misma interfaz `BaseRole` (init, execute, report)
- **CLI-first.** Envuelve CLIs existentes de agentes IA (Claude, Codex, Gemini, Aider, OpenCode) en lugar de llamar APIs directamente
- **Zero-config.** Detecta automáticamente frameworks de test, arranca SonarQube, simplifica el pipeline para tareas triviales. No requiere configuración por proyecto
- **Quality gates.** Análisis estático (SonarQube), revisión de código, TDD obligatorio y escaneo de inyección integrados
- **Solomon como jefe del pipeline.** Cada rechazo del reviewer es evaluado por Solomon, que puede anular bloqueos por estilo y mediar conflictos
- **Guardia de inyección.** Los diffs se escanean en busca de prompt injection antes de llegar al reviewer IA
- **Bootstrap gate.** Todos los prerequisitos se validan antes de que cualquier herramienta se ejecute. Falla con instrucciones de corrección, nunca degrada silenciosamente
- **Fail-fast con escalado.** La detección de repeticiones activa arbitraje Solomon o intervención humana
- **Persistencia de sesión.** Todo el estado se almacena en disco para pausa/reanudación y recuperación ante caídas
- **Extensible.** Agentes custom via plugins, reglas custom via ficheros markdown

## Diagrama del Sistema

```
┌─────────────────────────────────────────────────────────────────┐
│                    CLI / MCP / kj-tail                           │
│              (kj run, kj_run tool, kj-tail)                     │
└──────────────────────┬──────────────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────────────┐
│                    Bootstrap Gate                                 │
│         (git, remote, config, agents, SonarQube)                 │
└──────────────────────┬───────────────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────────────┐
│                      Orchestrator                                │
│          (pipeline loop, fail-fast, budget, session)             │
│                                                                  │
│  ┌────────────┐ ┌────────┐ ┌────────┐ ┌─────────┐ ┌────────┐   │
│  │HU-Reviewer?│→│ Triage │→│Discover│→│Architect│→│Planner │   │
│  └────────────┘ └────────┘ └────────┘ └─────────┘ └───┬────┘   │
│                                                        │        │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐  │        │
│  │ Commiter │←│  Audit   │←│ Security │←│  Tester  │←─┤        │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘  │        │
│                                                        ▼        │
│                ┌──────────┐ ┌──────────┐ ┌──────────┐           │
│                │ Solomon  │←│ Reviewer │←│  Sonar   │←── Coder  │
│                └────┬─────┘ └──────────┘ └──────────┘           │
│                     │         ▲                                  │
│            override?│    Injection                               │
│             continue│     Guard                                  │
│                     │                                            │
│                approved? ──no──→ loop back to Coder              │
└─────────────────────┬────────────────────────────────────────────┘
                      │
         ┌────────────┼────────────────┐
         ▼            ▼                ▼
  ┌─────────────┐ ┌───────────┐ ┌──────────────┐
  │ Agent Layer │ │  SonarQube │ │ Session Store │
  │ (BaseAgent) │ │  (Docker)  │ │    (disk)     │
  └──────┬──────┘ └───────────┘ └──────────────┘
         │
  ┌──────┴───────────────────────────────────┐
  │ Claude │ Codex │ Gemini │ Aider │ OpenCode │ Plugins
  └──────────────────────────────────────────┘
```

## Estructura de Módulos

```
src/
├── cli.js                    # CLI entry point (Commander.js)
├── orchestrator.js           # Main pipeline coordinator
├── bootstrap.js              # Bootstrap gate (prerequisite validation)
├── config.js                 # Config loading & validation
├── session-store.js          # Session persistence (create, pause, resume)
├── session-cleanup.js        # Expired session cleanup
├── repeat-detector.js        # Fail-fast: detect repeated issues
├── activity-log.js           # Session activity logging
│
├── orchestrator/             # Pipeline stage implementations
│   ├── pre-loop-stages.js    #   HU-reviewer, triage, discover, researcher, architect, planner
│   ├── iteration-stages.js   #   Coder, refactorer, guards, TDD, sonar, injection guard, reviewer
│   ├── post-loop-stages.js   #   Tester, security, impeccable, audit
│   ├── preflight-checks.js   #   Pre-run environment validation
│   ├── solomon-escalation.js #   Conflict resolution and escalation
│   ├── solomon-rules.js      #   Solomon's 5 evaluation rules
│   ├── reviewer-fallback.js  #   Fallback reviewer logic
│   ├── agent-fallback.js     #   Fallback agent selection
│   ├── standby.js            #   Rate-limit standby with backoff
│   └── pipeline-context.js   #   Shared pipeline state object
│
├── roles/                    # Role implementations (15 roles)
│   ├── base-role.js          #   Abstract base (init, execute, report)
│   ├── triage-role.js        #   Task complexity classifier
│   ├── discover-role.js      #   Gap detection (Mom Test, Wendel, JTBD)
│   ├── researcher-role.js    #   Codebase investigation
│   ├── architect-role.js     #   Architecture design
│   ├── planner-role.js       #   Implementation planning
│   ├── hu-reviewer-role.js   #   User story certification (6 dimensions, 7 antipatterns)
│   ├── coder-role.js         #   Code & test generation
│   ├── refactorer-role.js    #   Code quality improvement
│   ├── reviewer-role.js      #   Code review
│   ├── tester-role.js        #   Test quality gate
│   ├── security-role.js      #   OWASP security audit
│   ├── impeccable-role.js    #   UI/UX audit (a11y, performance, theming)
│   ├── audit-role.js         #   Read-only codebase health analysis (A-F scores)
│   ├── solomon-role.js       #   Pipeline boss, conflict arbitration
│   ├── sonar-role.js         #   SonarQube (non-AI)
│   ├── commiter-role.js      #   Git automation
│   └── index.js              #   Role registry
│
├── agents/                   # AI agent adapters (5 agents)
│   ├── index.js              #   Agent registry (register, create)
│   ├── base-agent.js         #   Abstract base class
│   ├── claude-agent.js       #   Claude CLI wrapper
│   ├── codex-agent.js        #   Codex CLI wrapper
│   ├── gemini-agent.js       #   Gemini CLI wrapper
│   ├── aider-agent.js        #   Aider CLI wrapper
│   ├── opencode-agent.js     #   OpenCode CLI wrapper
│   ├── host-agent.js         #   Delegate to host AI agent (MCP mode)
│   ├── model-registry.js     #   Model availability & pricing
│   ├── availability.js       #   Check if agents are installed
│   └── resolve-bin.js        #   Resolve agent binary path
│
├── guards/                   # Deterministic guards (no AI)
│   ├── intent-guard.js       #   Validates coder output matches task intent
│   ├── output-guard.js       #   Validates coder output structure
│   ├── perf-guard.js         #   Performance regression detection
│   └── policy-resolver.js    #   Task-type policy resolution
│
├── hu/                       # HU (User Story) system
│   ├── store.js              #   Local HU file storage
│   ├── graph.js              #   Dependency graph with topological sort
│   └── parallel-executor.js  #   Parallel HU execution via git worktrees
│
├── webperf/                  # WebPerf Quality Gate
│   └── runner.js             #   Core Web Vitals measurement via Chrome DevTools
│
├── commands/                 # CLI command handlers
│   ├── run.js, code.js, review.js, plan.js, resume.js
│   ├── audit.js, architect.js, discover.js, researcher.js, triage.js
│   ├── init.js, doctor.js, config.js, report.js, board.js
│   ├── roles.js, agents.js, scan.js, sonar.js
│
├── mcp/                      # MCP server (23 tools)
│   ├── server.js             #   Stdio transport entry point
│   ├── tools.js              #   Tool schemas (23 tools)
│   ├── server-handlers.js    #   Tool handlers
│   ├── direct-role-runner.js #   Shared boilerplate for standalone role MCP tools
│   ├── run-kj.js             #   Subprocess spawner
│   ├── progress.js           #   Real-time notifications
│   ├── preflight.js          #   MCP preflight validation
│   ├── orphan-guard.js       #   Zombie process prevention
│   └── tool-arg-normalizers.js # Input normalization
│
├── prompts/                  # Prompt builders
│   ├── coder.js              #   Task + feedback + rules
│   ├── reviewer.js           #   Diff + rules
│   ├── planner.js            #   Task + research context
│   ├── architect.js          #   Architecture design prompt
│   ├── triage.js             #   Complexity classification prompt
│   ├── discover.js           #   Gap detection prompt (5 modes)
│   ├── hu-reviewer.js        #   HU certification prompt
│   ├── audit.js              #   Codebase health analysis prompt
│   └── rtk-snippet.js        #   Shared RTK token optimization instructions
│
├── review/                   # Code review infrastructure
│   ├── profiles.js           #   standard/strict/paranoid/relaxed
│   ├── schema.js             #   Reviewer output JSON schema
│   ├── parser.js             #   Parse reviewer response
│   ├── diff-generator.js     #   Git diff generation
│   ├── tdd-policy.js         #   TDD compliance check
│   └── scope-filter.js       #   Defer out-of-scope issues as tech debt
│
├── sonar/                    # SonarQube integration
│   ├── manager.js            #   Docker compose lifecycle (auto-start)
│   ├── scanner.js            #   sonar-scanner execution
│   ├── cloud-scanner.js      #   SonarCloud support
│   ├── api.js                #   REST API client
│   ├── enforcer.js           #   Quality gate enforcement
│   ├── credentials.js        #   Token management (no hardcoded defaults)
│   └── project-key.js        #   Project key detection
│
├── plugins/                  # Plugin system
│   └── loader.js             #   Discover & load plugins
│
├── planning-game/            # Planning Game integration
│   ├── adapter.js            #   Card ID parsing, task enrichment
│   ├── pipeline-adapter.js   #   Event-driven pipeline status updates
│   ├── client.js             #   REST client
│   ├── decomposition.js      #   Task decomposition with linked cards
│   └── architect-adrs.js     #   Auto ADR generation from tradeoffs
│
├── becaria/                  # BecarIA gateway (GitHub PR automation)
│   ├── dispatch.js           #   PR event dispatcher
│   ├── repo.js               #   Repository operations
│   └── pr-diff.js            #   PR diff extraction
│
├── git/                      # Git automation
│   └── automation.js         #   Branch, commit, push, PR
│
└── utils/                    # Shared utilities
    ├── injection-guard.js    #   Prompt injection scanner (directives, unicode, payloads)
    ├── budget.js             #   Token & cost tracking
    ├── pricing.js            #   Model pricing lookup
    ├── model-selector.js     #   Smart model selection per role
    ├── retry.js              #   Exponential backoff
    ├── rate-limit-detector.js #  Rate limit and provider outage detection
    ├── stall-detector.js     #   Agent heartbeat and stall detection
    ├── process.js            #   Subprocess execution
    ├── json-extract.js       #   Robust JSON extraction from agent output
    ├── run-log.js            #   File-based run log for kj-tail
    ├── git.js                #   Git operations
    ├── agent-detect.js       #   Agent binary detection
    ├── project-detect.js     #   Test framework & SonarQube config detection
    ├── rtk-detect.js         #   RTK availability detection
    ├── os-detect.js          #   OS-aware install commands
    ├── events.js             #   Event emission
    ├── display.js            #   CLI formatting (icons, colors, stage output)
    ├── logger.js             #   Logging
    ├── paths.js              #   KJ_HOME resolution
    ├── wizard.js             #   Interactive prompts
    └── fs.js                 #   File system helpers

templates/
├── roles/                    # Role instruction files (.md)
│   ├── coder.md, reviewer.md, planner.md, architect.md
│   ├── triage.md, discover.md, researcher.md, hu-reviewer.md
│   ├── tester.md, security.md, solomon.md, sonar.md
│   ├── impeccable.md, audit.md, commiter.md, refactorer.md
│   └── reviewer-strict.md, reviewer-paranoid.md, reviewer-relaxed.md
└── skills/                   # Skill definitions for MCP tools
    ├── kj-run.md, kj-code.md, kj-review.md, kj-audit.md
    ├── kj-discover.md, kj-architect.md, kj-security.md
    ├── kj-test.md, kj-sonar.md, kj-board.md

packages/
└── hu-board/                 # HU Board dashboard (standalone app)
    ├── src/server.js         #   Express server
    ├── src/db.js             #   SQLite storage
    ├── src/sync.js           #   File watcher (chokidar)
    ├── src/routes/api.js     #   REST API
    ├── public/               #   Vanilla JS frontend (kanban, sessions)
    └── Dockerfile            #   Docker deployment
```

## Abstracciones Principales

### BaseRole

Cada rol del pipeline extiende `BaseRole`. Proporciona un ciclo de vida uniforme:

```javascript
class BaseRole {
  constructor({ name, config, logger, emitter })
  async init(context)       // Load instructions from .md template
  async execute(input)      // Role-specific logic
  async run(input)          // Wrapper: init, execute, validate, emit events
  report()                  // { role, ok, result, summary, timestamp }
}
```

Las instrucciones de rol se cargan desde ficheros markdown en orden de prioridad:
1. Override de proyecto: `.karajan/roles/<role>.md`
2. Override de usuario: `~/.karajan/roles/<role>.md`
3. Default built-in: `templates/roles/<role>.md`

### BaseAgent

Cada adaptador de agente IA extiende `BaseAgent`:

```javascript
class BaseAgent {
  constructor(name, config, logger)
  async runTask(task)       // Execute coding/planning task
  async reviewTask(task)    // Execute review task
  getRoleModel(role)        // Get configured model for role
}
```

Los agentes envuelven herramientas CLI como subprocesos. El registry de agentes permite registro al arranque (built-in) o via plugins (custom).

### Agent Registry

```javascript
registerAgent("claude", ClaudeAgent, { bin: "claude", installUrl: "..." })
const agent = createAgent("claude", config, logger)
const result = await agent.runTask({ prompt, role: "coder" })
```

### Orchestrator

El orchestrator impulsa el pipeline completo a través de tres fases:

1. **Pre-loop.** Bootstrap gate, HU-reviewer, triage, discover, researcher, architect, planner
2. **Bucle de iteración.** Coder, refactorer, guards, TDD check, sonar, injection guard, reviewer, Solomon (se repite hasta aprobación o máximo de iteraciones)
3. **Post-loop.** Tester, security, impeccable, audit, commiter (solo tras aprobación)

## Flujo del Pipeline

```
Input (descripción de tarea)
    │
    ▼
┌─ Bootstrap Gate ───────────┐
│  Validate: git, remote,    │
│  config, agents, sonar     │
└────────────┬───────────────┘
    │
    ▼
┌─ Pre-loop ─────────────────────┐
│  [HU-Reviewer?] → certify HU  │
│  [Triage]       → classify     │
│  [Discover?]    → detect gaps  │
│  [Researcher?]  → investigate  │
│  [Architect?]   → design       │
│  [Planner?]     → plan steps   │
└────────────────────────────────┘
    │
    ▼
┌─ Iteration Loop (1..N) ─────────────────────────────────┐
│                                                          │
│  [Coder]          → write code & tests                  │
│  [Refactorer?]    → improve clarity                     │
│  [Guards]         → intent + output + perf checks       │
│  [TDD Check]      → enforce test changes                │
│  [SonarQube?]     → static analysis + quality gate      │
│  [Impeccable?]    → UI/UX audit (frontend tasks)        │
│  [Injection Guard] → scan diff for prompt injection     │
│  [Reviewer]       → code review                         │
│       ├→ approved   → exit loop                         │
│       └→ rejected   → Solomon evaluates                 │
│  [Solomon]        → override style-only? continue? stop?│
│       ├→ continue   → loop back with conditions         │
│       ├→ override   → approve despite reviewer          │
│       └→ escalate   → human intervention                │
│                                                          │
└──────────────────────────────────────────────────────────┘
    │
    ▼
┌─ Post-loop ────────────────────┐
│  [Tester?]     → test quality  │
│  [Security?]   → OWASP audit   │
│  [Audit]       → certify code  │
│  [Commiter?]   → git finalize  │
└────────────────────────────────┘
    │
    ▼
Resultado (informe de sesión, presupuesto, commits)
```

## Resolución de Configuración

La configuración se carga y fusiona en este orden:

1. **Defaults built-in** en `config.js`
2. **Config de usuario** en `~/.karajan/kj.config.yml` (o `$KJ_HOME/kj.config.yml`)
3. **Config de proyecto** en `.karajan.yml` en la raíz del proyecto
4. **Contexto de producto** en `.karajan/context.md` (se inyecta en todos los prompts de roles)
5. **Flags CLI** sobreescriben todo

La selección de modelo sigue una jerarquía similar:
```
roles.<role>.model → <role>_options.model → agent default
```

## Ciclo de Vida de Sesión

```
create → running → [pause?] → approved | failed
                       ↓
                    paused → resume → running
```

Las sesiones se persisten en `~/.karajan/sessions/{sessionId}/session.json` e incluyen:
- Descripción de tarea y snapshot de configuración
- Checkpoints por etapa (timestamp, iteración, notas)
- Historial de feedback del reviewer
- Tracking de presupuesto (tokens, costes estimados)
- Estado de pausa (pregunta, contexto, respuesta)

Esto permite recuperación ante caídas, pausa/reanudación e informes post-ejecución.

## Inspiraciones

La arquitectura se nutre de varias fuentes:

- **[jorgecasar/ai-orchestration](https://github.com/jorgecasar/legacy-s-end-2/tree/main/packages/ai-orchestration)** Arquitectura hexagonal limpia con puertos y adaptadores para orquestación de IA. Influyó en el diseño de adaptadores de agentes y la abstracción de roles de Karajan.
- **Arquitectura Hexagonal (Puertos y Adaptadores).** La capa de agentes actúa como adaptadores (Claude, Codex, etc.) detrás de un puerto unificado (`BaseAgent`).
- **Patrón Pipeline.** El orchestrator compone roles en un pipeline configurable e iterativo con quality gates.
- **Arquitectura Dirigida por Eventos.** Los roles emiten eventos para tracking de progreso, notificaciones MCP y monitorización en tiempo real con kj-tail.

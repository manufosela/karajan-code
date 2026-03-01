---
title: Visión General de la Arquitectura
description: Arquitectura de alto nivel de Karajan Code.
---

Karajan Code implementa un patrón de **Orquestación de IA basada en Roles**. El sistema coordina múltiples agentes de IA a través de un pipeline estructurado donde cada responsabilidad (codificar, revisar, testear, seguridad) es un rol discreto e independientemente configurable.

## Principios de Diseño

- **Roles de agente desacoplados** — Cada capacidad IA es un rol separado con sus propias instrucciones, agente y modelo
- **Ciclo de vida estandarizado** — Todos los roles implementan la misma interfaz `BaseRole` (init → execute → report)
- **CLI-first** — Envuelve CLIs existentes de agentes IA (Claude, Codex, Gemini, Aider) en lugar de llamar APIs directamente
- **Quality gates** — Análisis estático (SonarQube), revisión de código y TDD obligatorio integrados
- **Fail-fast con escalado** — La detección de repeticiones activa arbitraje Solomon o intervención humana
- **Persistencia de sesión** — Todo el estado se almacena en disco para pausa/reanudación y recuperación ante caídas
- **Extensible** — Agentes custom via plugins, reglas custom via ficheros markdown

## Diagrama del Sistema

```
┌─────────────────────────────────────────────────────────────┐
│                         CLI / MCP                           │
│                   (kj run, kj_run tool)                     │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│                      Orchestrator                           │
│         (bucle del pipeline, fail-fast, presupuesto)        │
│                                                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │  Triage  │→ │Researcher│→ │ Planner  │→ │  Coder   │   │
│  └──────────┘  └──────────┘  └──────────┘  └────┬─────┘   │
│                                                  │         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐       │         │
│  │ Commiter │← │ Security │← │  Tester  │←──────┤         │
│  └──────────┘  └──────────┘  └──────────┘       │         │
│                                                  ▼         │
│                              ┌──────────┐  ┌──────────┐   │
│                              │ Reviewer │← │  Sonar   │   │
│                              └────┬─────┘  └──────────┘   │
│                                   │                        │
│                          approved? ──no──→ bucle           │
└───────────────────────────┬─────────────────────────────────┘
                            │
           ┌────────────────┼────────────────┐
           ▼                ▼                ▼
    ┌─────────────┐  ┌───────────┐  ┌──────────────┐
    │ Agent Layer │  │  SonarQube │  │ Session Store │
    │ (BaseAgent) │  │  (Docker)  │  │    (disco)    │
    └──────┬──────┘  └───────────┘  └──────────────┘
           │
    ┌──────┴──────────────────────────┐
    │   Claude │ Codex │ Gemini │ Aider │ Plugins
    └─────────────────────────────────┘
```

## Estructura de Módulos

```
src/
├── cli.js                    # Punto de entrada CLI (Commander.js)
├── orchestrator.js           # Coordinador principal del pipeline
├── config.js                 # Carga y validación de config
├── session-store.js          # Persistencia de sesiones (crear, pausar, reanudar)
├── repeat-detector.js        # Fail-fast: detectar issues repetidos
├── activity-log.js           # Log de actividad de sesiones
│
├── orchestrator/             # Implementaciones de etapas del pipeline
│   ├── pre-loop-stages.js    #   Triage, researcher, planner
│   ├── iteration-stages.js   #   Coder, refactorer, TDD, sonar, reviewer
│   ├── post-loop-stages.js   #   Tester, security
│   ├── reviewer-fallback.js  #   Lógica de reviewer de respaldo
│   └── solomon-escalation.js #   Resolución de conflictos
│
├── roles/                    # Implementaciones de roles
│   ├── base-role.js          #   Base abstracta (init → execute → report)
│   ├── coder-role.js         #   Generación de código y tests
│   ├── reviewer-role.js      #   Revisión de código
│   ├── planner-role.js       #   Planificación de implementación
│   ├── refactorer-role.js    #   Mejora de calidad de código
│   ├── tester-role.js        #   Quality gate de tests
│   ├── security-role.js      #   Auditoría de seguridad OWASP
│   ├── researcher-role.js    #   Investigación del codebase
│   ├── solomon-role.js       #   Arbitraje de conflictos
│   ├── sonar-role.js         #   SonarQube (no-IA)
│   ├── triage-role.js        #   Clasificador de complejidad
│   └── commiter-role.js      #   Automatización git
│
├── agents/                   # Adaptadores de agentes IA
│   ├── index.js              #   Registry de agentes (register, create)
│   ├── base-agent.js         #   Clase base abstracta
│   ├── claude-agent.js       #   Wrapper de Claude CLI
│   ├── codex-agent.js        #   Wrapper de Codex CLI
│   ├── gemini-agent.js       #   Wrapper de Gemini CLI
│   ├── aider-agent.js        #   Wrapper de Aider CLI
│   ├── model-registry.js     #   Disponibilidad y pricing de modelos
│   ├── availability.js       #   Comprobar si agentes están instalados
│   └── resolve-bin.js        #   Resolver ruta del binario
│
├── commands/                 # Handlers de comandos CLI
├── mcp/                      # Servidor MCP (stdio transport)
├── prompts/                  # Constructores de prompts
├── review/                   # Infraestructura de revisión de código
├── sonar/                    # Integración SonarQube
├── plugins/                  # Sistema de plugins
├── planning-game/            # Integración Planning Game
├── git/                      # Automatización git
└── utils/                    # Utilidades compartidas

templates/
└── roles/                    # Ficheros de instrucciones de roles (.md)
```

## Abstracciones Principales

### BaseRole

Cada rol del pipeline extiende `BaseRole`. Proporciona un ciclo de vida uniforme:

```javascript
class BaseRole {
  constructor({ name, config, logger, emitter })
  async init(context)       // Cargar instrucciones desde template .md
  async execute(input)      // Lógica específica del rol
  async run(input)          // Wrapper: init → execute → validate → emit events
  report()                  // { role, ok, result, summary, timestamp }
}
```

Las instrucciones de rol se cargan desde ficheros markdown en orden de prioridad:
1. Override de proyecto: `.karajan/roles/<rol>.md`
2. Override de usuario: `~/.karajan/roles/<rol>.md`
3. Default built-in: `templates/roles/<rol>.md`

### BaseAgent

Cada adaptador de agente IA extiende `BaseAgent`:

```javascript
class BaseAgent {
  constructor(name, config, logger)
  async runTask(task)       // Ejecutar tarea de codificación/planificación
  async reviewTask(task)    // Ejecutar tarea de revisión
  getRoleModel(role)        // Obtener modelo configurado para el rol
}
```

Los agentes envuelven herramientas CLI como subprocesos. El registry de agentes permite registro al arranque (built-in) o via plugins (custom).

### Registry de Agentes

```javascript
registerAgent("claude", ClaudeAgent, { bin: "claude", installUrl: "..." })
const agent = createAgent("claude", config, logger)
const result = await agent.runTask({ prompt, role: "coder" })
```

### Orchestrator

El orchestrator impulsa el pipeline completo a través de tres fases:

1. **Pre-loop** — triage, researcher, planner (opcionales)
2. **Bucle de iteración** — coder → refactorer → TDD check → sonar → reviewer (se repite hasta aprobación o max iteraciones)
3. **Post-loop** — tester, security, git finalize (solo tras aprobación)

## Flujo del Pipeline

```
Input (descripción de tarea)
    │
    ▼
┌─ Pre-loop ──────────────────┐
│  [Triage?]    → clasificar  │
│  [Researcher?] → investigar  │
│  [Planner?]   → planificar  │
└─────────────────────────────┘
    │
    ▼
┌─ Bucle de Iteración (1..N) ────────────────────────┐
│                                                     │
│  [Coder]      → escribir código y tests             │
│  [Refactorer?] → mejorar claridad                   │
│  [TDD Check]  → verificar cambios en tests          │
│  [SonarQube?] → análisis estático + quality gate    │
│       └→ ¿repetición detectada? → pausa/escalado    │
│  [Reviewer]   → revisión de código                  │
│       ├→ aprobado  → salir del bucle ✓              │
│       ├→ rechazado → reintentar con feedback        │
│       └→ max retries → ¿Solomon? → escalado humano  │
│                                                     │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─ Post-loop ─────────────────┐
│  [Tester?]   → calidad test │
│  [Security?] → auditoría    │
│  [Commiter?] → git finalize │
└─────────────────────────────┘
    │
    ▼
Resultado (informe de sesión, presupuesto, commits)
```

## Resolución de Configuración

La config se carga y fusiona en este orden:

1. **Defaults built-in** — hardcoded en `config.js`
2. **Config de usuario** — `~/.karajan/kj.config.yml` (o `$KJ_HOME/kj.config.yml`)
3. **Config de proyecto** — `.karajan.yml` en la raíz del proyecto (overrides de pricing)
4. **Flags CLI** — los argumentos de línea de comandos sobreescriben todo

La selección de modelo sigue una jerarquía similar:
```
roles.<rol>.model → <rol>_options.model → default del agente
```

## Ciclo de Vida de Sesión

```
create → running → [¿pausa?] → approved | failed
                       ↓
                    paused → resume → running
```

Las sesiones se persisten en `~/.karajan/sessions/{sessionId}/session.json` e incluyen:
- Descripción de tarea y snapshot de config
- Checkpoints por etapa (timestamp, iteración, notas)
- Historial de feedback del reviewer
- Tracking de presupuesto (tokens, costes estimados)
- Estado de pausa (pregunta, contexto, respuesta)

Esto permite recuperación ante caídas, pausa/reanudación e informes post-ejecución.

## Inspiraciones

La arquitectura se nutre de varias fuentes:

- **[jorgecasar/ai-orchestration](https://github.com/jorgecasar/legacy-s-end-2/tree/main/packages/ai-orchestration)** — Arquitectura hexagonal limpia con puertos y adaptadores para orquestación de IA. Influyó en el diseño de adaptadores de agentes y la abstracción de roles de Karajan.
- **Arquitectura Hexagonal (Puertos y Adaptadores)** — La capa de agentes actúa como adaptadores (Claude, Codex, etc.) detrás de un puerto unificado (`BaseAgent`).
- **Patrón Pipeline** — El orchestrator compone roles en un pipeline configurable e iterativo con quality gates.
- **Arquitectura Dirigida por Eventos** — Los roles emiten eventos para tracking de progreso y notificaciones MCP.

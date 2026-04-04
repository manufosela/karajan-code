# Karajan Code — Arquitectura

## Visión general

Karajan es un **orquestador local multi-agente de código**. Coordina un pipeline de agentes IA (Claude, Codex, Gemini, Aider, OpenCode) a través de roles especializados para planificar, implementar, testear y revisar código.

Desde v2.0, Karajan introduce la capa **Karajan Brain**: un orquestador IA que enruta toda la comunicación entre roles, enriquece feedback, verifica outputs y consulta a Solomon (el juez IA) solo en dilemas genuinos.

```
┌─────────────────────────────────────────────────────────┐
│                  Usuario (CLI / MCP)                     │
└──────────────────────────┬──────────────────────────────┘
                           │
                           ▼
                 ┌─────────────────────┐
                 │   Karajan Brain     │◄─── Solomon (en dilemas)
                 │  (orquestador IA)   │
                 └──────────┬──────────┘
                            │
        ┌───────────────────┼───────────────────┐
        ▼                   ▼                   ▼
   ┌─────────┐        ┌─────────┐        ┌─────────┐
   │ Triage  │───────▶│ Planner │───────▶│  Coder  │
   └─────────┘        └─────────┘        └────┬────┘
                                              │
        ┌─────────────────────────────────────┤
        ▼                   ▼                 ▼
   ┌─────────┐        ┌─────────┐        ┌─────────┐
   │Reviewer │        │ Tester  │        │Security │
   └─────────┘        └─────────┘        └─────────┘
        │                   │                 │
        └───────────────────┴─────────────────┘
                            │
                            ▼
                     ┌─────────┐
                     │  Audit  │──▶ Git commit / PR
                     └─────────┘
```

## Estructura top-level

```
karajan-code/
├── src/              # Código fuente (28k LOC, 234 ficheros)
├── tests/            # Suite de tests (3057 tests)
├── templates/        # Definiciones de roles (MD) + skills + workflows
├── docs/             # Documentación (estás aquí)
├── scripts/          # Scripts de install/release
├── bin/              # Entry points CLI (kj, kj-tail, karajan-mcp)
└── .github/          # Workflows de CI
```

## Subsistemas en `src/`

### Pipeline principal (`src/orchestrator/`)

El pipeline principal vive en `src/orchestrator.js` (~1400 LOC) y llama a funciones de `src/orchestrator/`:

| Fichero | Propósito |
|---------|-----------|
| `config-init.js` | Auto-init (repo git, .gitignore, .karajan/), asignación de roles, dry-run, budget manager, init de sesión, triage overrides, auto-simplify, flag overrides, resolución de políticas |
| `flow-control.js` | Manejo de checkpoints, timeouts de sesión, checks de budget excedido, lógica de auto-continue |
| `ci-integration.js` | Integración CI/CD: creación de PR temprana, push incremental, dispatch de comentarios de review |
| `session-journal.js` | Persiste estado del pipeline en `.reviews/session_*/` (triage.md, research.md, plan.md, iterations.md, decisions.md, tree.txt, summary.md) |
| `brain-coordinator.js` | **v2**: Integra los módulos de Karajan Brain (queue, enrichment, verification, actions, compression) |
| `feedback-queue.js` | **v2**: Cola tipada de mensajes estructurada que reemplaza el string plano `last_reviewer_feedback` |
| `feedback-enrichment.js` | **v2**: Transforma feedback vago en planes de acción concretos con pistas de ficheros |
| `verification-gate.js` | **v2**: Detecta iteraciones del coder sin cambios vía git diff --numstat |
| `direct-actions.js` | **v2**: Comandos allow-listed que Brain puede ejecutar (npm install, gitignore, create_file, git_add) |
| `role-output-compressor.js` | **v2**: Estrategias por rol para 40-70% de ahorro de tokens entre roles |
| `pre-loop-stages.js` | Orquestación de Triage, Discover, Researcher, Architect, Planner, HU Reviewer |
| `post-loop-stages.js` | Orquestación de Tester, Security, Impeccable, Audit con cadena de fallback |
| `iteration-stages.js` | Orquestación de Coder, Refactorer, TDD check, Sonar, Reviewer (por iteración) |
| `hu-sub-pipeline.js` | Procesamiento de batches de HU con grafo de dependencias |
| `solomon-escalation.js` | Invocación de Solomon con contexto de conflicto y rulings previos |
| `solomon-rules.js` | Motor de reglas determinísticas (detección de stale, scope guard, alertas de deps) |
| `preflight-checks.js` | Validación del entorno antes de arrancar el pipeline |
| `agent-fallback.js` | Enrutamiento de fallback cuando el coder principal falla |
| `reviewer-fallback.js` | Enrutamiento de fallback cuando el reviewer principal falla |
| `standby.js` | Manejo de rate-limit / cooldown |
| `pipeline-context.js` | Objeto de contexto compartido pasado entre stages |
| `stages/` | Implementaciones individuales de stages (coder, reviewer, tester, etc.) |

### Roles (`src/roles/`)

Cada rol es una clase ES. La mayoría extiende `AgentRole` (base para roles LLM).

| Fichero | Rol | Provider | Notas |
|---------|-----|----------|-------|
| `base-role.js` | BaseRole | — | Base abstracta con carga de templates, emisión de eventos |
| `agent-role.js` | AgentRole | — | Base LLM-backed (~200 LOC eliminadas de cada subclase) |
| `karajan-brain-role.js` | **KarajanBrainRole** | claude | **v2**: orquestador central |
| `coder-role.js` | CoderRole | claude | Escribe código |
| `reviewer-role.js` | ReviewerRole | codex | Code review |
| `planner-role.js` | PlannerRole | claude | Plan paso a paso |
| `researcher-role.js` | ResearcherRole | claude | Análisis de codebase |
| `architect-role.js` | ArchitectRole | claude | Diseño de arquitectura |
| `tester-role.js` | TesterRole | claude | Ejecuta tests + mide cobertura |
| `security-role.js` | SecurityRole | claude | Escaneo OWASP/CWE |
| `sonar-role.js` | SonarRole | — | Quality gate de SonarQube (externo) |
| `solomon-role.js` | SolomonRole | gemini | Juez IA para dilemas |
| `triage-role.js` | TriageRole | claude | Clasificación de tareas |
| `discover-role.js` | DiscoverRole | claude | Análisis de gaps (Mom Test, Wendel, JTBD) |
| `audit-role.js` | AuditRole | claude | Health check final |
| `impeccable-role.js` | ImpeccableRole | claude | Calidad de diseño frontend/UI |
| `refactorer-role.js` | RefactorerRole | claude | Refactoring de código |
| `commiter-role.js` | CommiterRole | — | Operaciones git (sin LLM) |
| `hu-reviewer-role.js` | HuReviewerRole | claude | Certificación de historias de usuario |
| `domain-curator-role.js` | DomainCuratorRole | — | Carga conocimiento de dominio (sin LLM) |

### Agentes (`src/agents/`)

Adaptadores CLI para providers de IA.

| Fichero | Provider | Binario |
|---------|----------|---------|
| `base-agent.js` | — | base abstracta |
| `claude-agent.js` | Claude Code | `claude` |
| `codex-agent.js` | OpenAI Codex | `codex` |
| `gemini-agent.js` | Google Gemini | `gemini` |
| `aider-agent.js` | Aider | `aider` |
| `opencode-agent.js` | OpenCode | `opencode` |
| `host-agent.js` | Proceso host | — (delega al host MCP actual) |

### Comandos (`src/commands/`)

21 comandos CLI.

| Comando | Propósito |
|---------|-----------|
| `kj init` | Wizard interactivo de setup |
| `kj run <task>` | Pipeline completo |
| `kj code <task>` | Solo coder |
| `kj review` | Solo reviewer |
| `kj plan <task>` | Solo plan |
| `kj discover <task>` | Solo discovery |
| `kj triage <task>` | Solo clasificación |
| `kj researcher <task>` | Solo investigación |
| `kj architect <task>` | Solo arquitectura |
| `kj audit` | Auditoría de codebase |
| `kj scan` | Scan SonarQube |
| `kj doctor` | Checks de entorno |
| `kj status` | Estado de la sesión actual |
| `kj report` | Último reporte |
| `kj resume <id>` | Reanudar sesión pausada |
| `kj roles` | Listar roles / ver template |
| `kj agents` | Listar agentes / asignar providers |
| `kj sonar` | Gestionar Docker de SonarQube |
| `kj board` | Dashboard del HU Board |
| `kj config` | Ver/editar config |
| `kj undo` | Revertir última ejecución |

### MCP Server (`src/mcp/`)

40+ herramientas MCP para integración con Claude Code.

### Guards (`src/guards/`)

Capas de validación determinísticas.

| Fichero | Propósito |
|---------|-----------|
| `output-guard.js` | Escanea diffs en busca de patrones destructivos + credenciales |
| `perf-guard.js` | Anti-patterns de performance frontend (CLS, scripts, font-display) |
| `intent-guard.js` | Clasificación de intent de tarea (50+ keywords) |
| `policy-guard.js` | Enforcement de políticas por tipo de tarea |
| `policy-resolver.js` | Mapea taskType → {tdd, sonar, reviewer, tests_required} |

### Otros subsistemas

| Directorio | Propósito |
|------------|-----------|
| `src/review/` | Generación de diffs, perfiles de review, política TDD |
| `src/sonar/` | Integración SonarQube + SonarCloud, gestión Docker |
| `src/ci/` | Integración CI/CD |
| `src/skills/` | Cliente OpenSkills, detección y carga de skills |
| `src/domains/` | Síntesis de conocimiento de dominio |
| `src/git/` | Automatización git (auto-commit, push, PR) |
| `src/hu/` | Sistema HU (store, graph, splitting-detector) |
| `src/planning-game/` | Integración con Planning Game |
| `src/webperf/` | Core Web Vitals + detección de Chrome DevTools MCP |
| `src/prompts/` | Builders de prompts por rol |
| `src/utils/` | 32 utilidades (budget, display, events, logger, RTK, etc.) |

## Flujo de datos (v2 con Brain habilitado)

1. **Usuario** ejecuta `kj run "descripción de tarea"`
2. **Auto-init** crea repo git, `.gitignore`, `.karajan/` si faltan
3. **Smart init** asigna agentes IA a roles según capacidad
4. **Preflight** valida entorno
5. **Triage** clasifica complejidad de la tarea
6. **Karajan Brain** enruta al siguiente stage según output de triage
7. **Discover → Researcher → Architect → Planner** (opt-in)
8. **Brain** comprime outputs pre-loop, construye resumen del plan
9. **Loop de iteraciones**:
   - **Coder** implementa
   - **Brain verifica** cambios (0 ficheros → reintentar con prompt enriquecido)
   - **Reviewer** revisa
   - **Brain** extrae issues bloqueantes a la cola de feedback, los enriquece
   - Si hay issues de seguridad: enviar al coder (Solomon bypassed)
   - Si hay dilema: **consultar a Solomon** por su opinión, Brain decide
   - Si aprobado: proceder a quality gates
10. **Gates post-loop**: Tester, Security, Impeccable — todos bloqueantes en v2
11. **Audit final**
12. **Journal** escribe todos los outputs de stages a `.reviews/session_*/`
13. **Git commit + PR** (si configurado)

## Capas de configuración

Config cargado en orden (el último gana):
1. `DEFAULTS` en `src/config.js`
2. `~/.karajan/kj.config.yml` (global)
3. `.karajan/kj.config.yml` (proyecto)
4. Flags de CLI (por ejecución)

## Almacenamiento de sesiones

Cada ejecución crea un directorio de sesión en `.karajan/sessions/s_<timestamp>/`:
- `session.json` — estado, budget, checkpoints
- Junto a: `.reviews/session_<timestamp>/` con ficheros del journal

## Decisiones clave

- **JavaScript vanilla** — sin TypeScript. JSDoc para tipos.
- **Módulos ESM** — `"type": "module"` en package.json.
- **Local-first** — sin servicio hosted, todo en la máquina del usuario.
- **Adaptadores CLI, no APIs** — usa CLIs de providers (`claude`, `codex`) como subprocesos, no llamadas API. Zero costes API.
- **Templates de roles en markdown** — los agentes leen sus propias instrucciones desde `templates/roles/*.md`.
- **Skills desde OpenSkills** — instalados globalmente, cargados desde `~/.agent/skills/`.

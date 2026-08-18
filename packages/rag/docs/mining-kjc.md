# Mining de Karajan Code (KJC) — Inventario para portación selectiva

Este documento inventaria los módulos de [Karajan Code](https://github.com/manufosela/karajan-code) que son candidatos a reutilización en Karajan RAG, y marca la recomendación (portar / inspirarse / ignorar).

- **Fuente revisada**: `manufosela/karajan-code` @ `45fd0f20a1a1b5b26bd9e8ac211145460f311a8c` (v2.5.0).
- **Estrategia general**: ver [ADR-001](./adrs/ADR-001-kjc-reuse-strategy.md). Se porta código **con atribución explícita** (comentario con commit/path origen), nunca como dependencia npm.

## Leyenda

- **Portar**: copia adaptada a KJR. Aplica el patrón, ajusta tipos/paths.
- **Inspirarse**: leer para entender decisiones; reimplementar desde cero para encajar con nuestro dominio RAG.
- **Ignorar**: específico del dominio "código" de KJC, no aplicable a RAG.
- **Esperar**: potencialmente útil, pero en fases posteriores.

## Tabla de módulos

### Adapters de CLIs (`src/agents/`)

| Fichero KJC | LoC | Utilidad en KJR | Recomendación | Notas |
|-------------|-----|-----------------|---------------|-------|
| `src/agents/base-agent.js` | 104 | Clase base común a todos los adapters CLI | **Portar** | Nuestra `AdapterResult` + refactor a clase base. Mapea 1:1 con KJR-TSK-0005/0006. |
| `src/agents/index.js` | ~90 | Registry `registerAgent`/`getAvailableAgents`/`createAgent` con autoregistro | **Portar** | Base del `AdapterRegistry` (KJR-TSK-0006/0016). Cambiar firma para DI. |
| `src/agents/claude-agent.js` | — | Implementación CLAUDE CLI | Inspirarse | KJR ya tiene `claude-cli-adapter.js` funcional; contrastar para detectar mejoras (streaming, retries). |
| `src/agents/codex-agent.js` | — | Implementación Codex CLI (NDJSON) | Inspirarse | KJR ya tiene `codex-cli-adapter.js` con extracción `agent_message`. Ver si KJC hace algo que nosotros no. |
| `src/agents/gemini-agent.js` | — | Implementación Gemini CLI | Inspirarse | Idem; comprobar manejo de MCP noise en stdout. |
| `src/agents/aider-agent.js` | — | Implementación Aider | **Esperar** | Aider no está en roadmap inicial de KJR; postergar. |
| `src/agents/opencode-agent.js` | — | Implementación OpenCode | **Esperar** | Idem Aider. |
| `src/agents/host-agent.js` | — | Runs the current host (meta-agent) | Ignorar | Específico del modo "Claude Code ejecuta a Claude Code"; no aplica a RAG. |
| `src/agents/availability.js` | — | Check binario instalado + versión | **Portar** | Útil para `pnpm smoke:*` y diagnósticos. Integrarlo al AdapterRegistry. |
| `src/agents/resolve-bin.js` | — | Resolver path del binario del CLI | **Portar** | Dep directa de `availability.js`. |
| `src/agents/model-registry.js` | — | Modelos por proveedor + metadata | **Esperar** | Útil cuando añadamos selección de modelo dinámica. |

### Sistema de Roles (`src/roles/`)

| Fichero KJC | Utilidad en KJR | Recomendación | Notas |
|-------------|-----------------|---------------|-------|
| `src/roles/base-role.js` (148 LoC) | Abstracción `Role.run(input, tools)` | **Portar** | Núcleo del Role system (KJR-TSK-0015). Ajustar contrato a stages RAG. |
| `src/roles/index.js` | Registry de roles | **Portar** | Plantilla de RoleRegistry (KJR-TSK-0003). |
| `src/roles/architect-role.js` | Diseño arquitectónico pre-código | Ignorar | Rol de coding, no RAG. |
| `src/roles/coder-role.js` | Implementación del código | Ignorar | Idem. |
| `src/roles/reviewer-role.js` | Code review | Ignorar | Idem. |
| `src/roles/audit-role.js` | Auditoría de codebase | Ignorar | Idem. |
| `src/roles/researcher-role.js` | Investigación previa | **Inspirarse** | Un `ResearcherRole` RAG podría preceder a ingesta/chunking (detectar fuentes). |
| `src/roles/domain-curator-role.js` | Curación de conocimiento de dominio | **Inspirarse** | Encaja perfecto con fase de enriquecimiento de chunks con metadata semántica. |
| `src/roles/security-role.js` | Revisión seguridad | **Inspirarse** | Base para el futuro redactor PII de la épica Data Sensitivity. |
| `src/roles/solomon-role.js` | Árbitro entre agentes en desacuerdo | **Inspirarse** | Aplica directamente al módulo de evaluación (LLM-as-judge multi-agente). |
| `src/roles/hu-reviewer-role.js` | Certifica historia de usuario | Ignorar | Específico workflow XP de coding. |
| Resto (`planner, discover, impeccable, karajan-brain, refactorer, commiter, sonar, tester, agent`) | — | Ignorar | Específicos del pipeline de coding. |

### Orquestador (`src/orchestrator/`)

| Fichero KJC | Utilidad en KJR | Recomendación | Notas |
|-------------|-----------------|---------------|-------|
| `src/orchestrator.js` (22 LoC barrel) | API pública `runFlow`, `resumeFlow` | **Inspirarse** | Patrón "barrel fino sobre implementación modular" — mantener idea para KJR. |
| `src/orchestrator/flow-runner.js` | `runFlow` + `resumeFlow` | **Inspirarse** | Leer para decidir la API del Pipeline Engine (KJR-TSK-0002). |
| `src/orchestrator/stages/stage-executor.js` | Contrato `StageExecutor` | **Portar** | Base de los stages RAG (KJR-TSK-0001/0002). |
| `src/orchestrator/stages/{architect,coder,…}-stage.js` | Stages específicos coding | Ignorar | Dominio distinto. |
| `src/orchestrator/config-init.js` | `loadProductContext` | **Esperar** | Útil cuando tengamos pipelines declarativos (KJR-PCS-0008). |
| `src/orchestrator/flow-control.js` | Checkpoints | **Esperar** | Útil para pipelines RAG largos (ingesta masiva). |

### Infraestructura y utilidades

| Fichero KJC | Utilidad en KJR | Recomendación | Notas |
|-------------|-----------------|---------------|-------|
| `src/infrastructure/environment.js` | DI de `fs` + `execa` para tests | **Portar** | Permite mockear el entorno en tests sin spawnear procesos. Aplicable a nuestros adapters (KJR-TSK-0008). |
| `src/guards/` | Deterministic Guards Layer | **Esperar** | Muy útil para validaciones pre/post stage; posponer a Sprint 2. |
| `src/budget/` | Token budget management | **Esperar** | Crucial al escalar; posponer. |
| `src/utils/` | Helpers varios (display, json, fs…) | **Inspirarse** | Copiar selectivamente solo lo que necesitemos. |
| `src/prompts/` | Plantillas de prompts | **Inspirarse** | Ver formato para nuestro `buildStrictJsonPrompt` y futuros prompts RAG. |
| `src/session/` | Journaling de sesión | Ignorar | Específico del flujo coding con retry/resume. |
| `src/mcp/` | MCP server | **Esperar** | Relevante cuando expongamos KJR como MCP; posponer. |
| `src/activity-log.js` | Logging estructurado | **Inspirarse** | Base para nuestro logger del Pipeline. |
| `src/repeat-detector.js` | Detector de loops en agentes | **Esperar** | Defensa anti bucle-infinito; útil en generation multi-agente. |
| `src/bootstrap.js` | Bootstrap de configuración | **Inspirarse** | Ver cómo compone config + registry + logger. |
| `src/config.js` | Parsing de config | **Esperar** | Dependencia de `config-init.js`. |

### Áreas NO aplicables a KJR (ignorar completas)

- `src/audit/`, `src/brain/`, `src/checks/`, `src/ci/`, `src/commands/`, `src/domains/`, `src/git/`, `src/hu/`, `src/plan/`, `src/planning-game/`, `src/plugins/`, `src/review/`, `src/skills/`, `src/sonar/`, `src/webperf/` → muy acopladas al dominio "code".
- `bin/`, `wrappers/`, `Dockerfile`, `docker-compose.yml` → relevantes cuando KJR empaquete binario propio (KJR-PCS-0008).
- `tsconfig.json`, `vitest.config.js` → KJR usa JSDoc + `node:test`, no TypeScript ni Vitest por decisión inicial.
- `.changeset/` → KJC usa changesets; KJR no por ahora.

## Resumen ejecutivo

**Bloques de portación prioritarios** (Sprint 1):

1. **AdapterRegistry** desde `src/agents/index.js` → KJR-TSK-0016.
2. **base-agent.js** → KJR-TSK-0005 (AdapterResult común) y base opcional a las clases de adapters.
3. **base-role.js** + `roles/index.js` → KJR-TSK-0015 (patrón Role) y KJR-TSK-0003 (RoleRegistry).
4. **stage-executor.js** → KJR-TSK-0001/0002 (contrato Stage).

**A vigilar para Sprint 2+**:

- `infrastructure/environment.js` para tests con DI.
- `guards/` como capa de validación determinista.
- `solomon-role.js` como patrón para el evaluador multi-agente.
- `domain-curator-role.js` y `researcher-role.js` como inspiración para roles RAG específicos.
- `budget/` cuando empecemos a ejecutar pipelines grandes con límites de tokens.

**Decisiones documentadas en ADR**:

- Estrategia de reuso (copy + atribución, no dependencia): ADR-001.

# Karajan Code — Architecture

## Overview

Karajan is a **local multi-agent coding orchestrator**. It coordinates a pipeline of AI agents (Claude, Codex, Gemini, Aider, OpenCode) through specialized roles to plan, implement, test, and review code.

From v2.0, Karajan introduces the **Karajan Brain** layer: an AI-powered orchestrator that routes all communication between roles, enriches feedback, verifies outputs, and consults Solomon (the AI judge) only on genuine dilemmas.

```
┌─────────────────────────────────────────────────────────┐
│                    User (CLI / MCP)                      │
└──────────────────────────┬──────────────────────────────┘
                           │
                           ▼
                 ┌─────────────────────┐
                 │   Karajan Brain     │◄─── Solomon (on dilemmas)
                 │  (AI orchestrator)  │
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

## Top-level structure

```
karajan-code/
├── src/              # Source code (28k LOC, 234 files)
├── tests/            # Test suite (3057 tests)
├── templates/        # Role definitions (MD) + skill docs + workflows
├── docs/             # Documentation (you are here)
├── scripts/          # Install, release scripts
├── bin/              # CLI entry points (kj, kj-tail, karajan-mcp)
└── .github/          # CI workflows
```

## `src/` subsystems

### Core pipeline (`src/orchestrator/`)

The main pipeline lives in `src/orchestrator.js` (~1400 LOC) and calls functions from `src/orchestrator/`:

| File | Purpose |
|------|---------|
| `config-init.js` | Auto-init (git repo, .gitignore, .karajan/ scaffolding), role assignment, dry-run handling, budget manager, session init, triage overrides, auto-simplify, flag overrides, policy resolution |
| `flow-control.js` | Checkpoint handling, session timeouts, budget exceeded checks, auto-continue logic |
| `ci-integration.js` | CI/CD integration: early PR creation, incremental push, review dispatch comments |
| `session-journal.js` | Persists pipeline state to `.reviews/session_*/` (triage.md, research.md, plan.md, iterations.md, decisions.md, tree.txt, summary.md) |
| `brain-coordinator.js` | **v2**: Integrates Karajan Brain modules (queue, enrichment, verification, actions, compression) |
| `feedback-queue.js` | **v2**: Structured typed message queue replacing flat `last_reviewer_feedback` string |
| `feedback-enrichment.js` | **v2**: Transforms vague feedback into actionable action plans with file hints |
| `verification-gate.js` | **v2**: Detects 0-change coder iterations via git diff --numstat |
| `direct-actions.js` | **v2**: Allow-listed commands Brain can execute (npm install, gitignore, create_file, git_add) |
| `role-output-compressor.js` | **v2**: Per-role strategies for 40-70% token savings between roles |
| `pre-loop-stages.js` | Triage, Discover, Researcher, Architect, Planner, HU Reviewer orchestration |
| `post-loop-stages.js` | Tester, Security, Impeccable, Audit orchestration with fallback chain |
| `iteration-stages.js` | Coder, Refactorer, TDD check, Sonar, Reviewer orchestration (per iteration) |
| `hu-sub-pipeline.js` | HU batch processing with dependency graph |
| `solomon-escalation.js` | Solomon invocation with conflict context and previous rulings |
| `solomon-rules.js` | Deterministic rules engine (stale detection, scope guard, deps alerts) |
| `preflight-checks.js` | Environment validation before pipeline starts |
| `agent-fallback.js` | Fallback routing when primary coder fails |
| `reviewer-fallback.js` | Fallback routing when primary reviewer fails |
| `standby.js` | Rate-limit / cooldown handling |
| `pipeline-context.js` | Shared context object passed through stages |
| `stages/` | Individual stage implementations (coder, reviewer, tester, etc.) |

### Roles (`src/roles/`)

Every role is an ES class. Most extend `AgentRole` (base for LLM-backed roles).

| File | Role | Provider | Notes |
|------|------|----------|-------|
| `base-role.js` | BaseRole | — | Abstract base with template loading, event emission |
| `agent-role.js` | AgentRole | — | LLM-backed base (~200 LOC eliminated from each subclass) |
| `karajan-brain-role.js` | **KarajanBrainRole** | claude | **v2**: central orchestrator |
| `coder-role.js` | CoderRole | claude | Writes code |
| `reviewer-role.js` | ReviewerRole | codex | Code review |
| `planner-role.js` | PlannerRole | claude | Step-by-step plan |
| `researcher-role.js` | ResearcherRole | claude | Codebase analysis |
| `architect-role.js` | ArchitectRole | claude | Architecture design |
| `tester-role.js` | TesterRole | claude | Runs tests + measures coverage |
| `security-role.js` | SecurityRole | claude | OWASP/CWE scan |
| `sonar-role.js` | SonarRole | — | SonarQube quality gate (external) |
| `solomon-role.js` | SolomonRole | gemini | AI judge for dilemmas |
| `triage-role.js` | TriageRole | claude | Task classification |
| `discover-role.js` | DiscoverRole | claude | Gap analysis (Mom Test, Wendel, JTBD) |
| `audit-role.js` | AuditRole | claude | Final health check |
| `impeccable-role.js` | ImpeccableRole | claude | Frontend/UI design quality |
| `refactorer-role.js` | RefactorerRole | claude | Code refactoring |
| `commiter-role.js` | CommiterRole | — | Git operations (no LLM) |
| `hu-reviewer-role.js` | HuReviewerRole | claude | User story certification |
| `domain-curator-role.js` | DomainCuratorRole | — | Loads domain knowledge (no LLM) |

### Agents (`src/agents/`)

CLI adapters for AI providers.

| File | Provider | Binary |
|------|----------|--------|
| `base-agent.js` | — | abstract base |
| `claude-agent.js` | Claude Code | `claude` |
| `codex-agent.js` | OpenAI Codex | `codex` |
| `gemini-agent.js` | Google Gemini | `gemini` |
| `aider-agent.js` | Aider | `aider` |
| `opencode-agent.js` | OpenCode | `opencode` |
| `host-agent.js` | Host process | — (delegates to current MCP host) |
| `model-registry.js` | — | Model availability per provider |
| `resolve-bin.js` | — | Binary path resolution |
| `availability.js` | — | Detection of installed CLIs |

### Commands (`src/commands/`)

21 CLI commands.

| Command | File | Purpose |
|---------|------|---------|
| `kj init` | init.js | Interactive setup wizard |
| `kj run <task>` | run.js | Full pipeline |
| `kj code <task>` | code.js | Coder only |
| `kj review` | review.js | Reviewer only |
| `kj plan <task>` | plan.js | Plan only |
| `kj discover <task>` | discover.js | Discovery only |
| `kj triage <task>` | triage.js | Classification only |
| `kj researcher <task>` | researcher.js | Research only |
| `kj architect <task>` | architect.js | Architecture only |
| `kj audit` | audit.js | Codebase audit |
| `kj scan` | scan.js | SonarQube scan |
| `kj doctor` | doctor.js | Environment checks |
| `kj status` | status.js | Current session status |
| `kj report` | report.js | Latest report |
| `kj resume <id>` | resume.js | Resume paused session |
| `kj roles` | roles.js | List roles / show template |
| `kj agents` | agents.js | List agents / assign providers |
| `kj sonar` | sonar.js | Manage SonarQube Docker |
| `kj board` | board.js | HU Board dashboard |
| `kj config` | config.js | Show/edit config |
| `kj undo` | undo.js | Revert last run |

### MCP Server (`src/mcp/`)

40+ MCP tools for Claude Code integration.

| File | Purpose |
|------|---------|
| `server.js` | MCP server entry point |
| `tools.js` | All 40+ tool definitions |
| `handlers/run-handler.js` | `kj_run` tool handler |
| `handlers/direct-handlers.js` | kj_code, kj_review, kj_plan, kj_discover, kj_triage, kj_researcher, kj_architect, kj_audit |
| `handlers/management-handlers.js` | kj_init, kj_doctor, kj_config, kj_status, kj_report, kj_roles, etc. |
| `handlers/hu-handlers.js` | HU story CRUD |
| `orphan-guard.js` | Prevents orphaned session cleanup |
| `sovereignty-guard.js` | Prevents pipeline modifying external work |
| `progress.js` | Real-time progress notifications |
| `response-compressor.js` | Compresses verbose agent output |

### Guards (`src/guards/`)

Deterministic validation layers.

| File | Purpose |
|------|---------|
| `output-guard.js` | Scans diffs for destructive patterns + credentials |
| `perf-guard.js` | Frontend perf anti-patterns (CLS, scripts, font-display) |
| `intent-guard.js` | Task intent classification (50+ keywords) |
| `policy-guard.js` | Task-type policy enforcement |
| `policy-resolver.js` | Maps taskType → {tdd, sonar, reviewer, tests_required} |

### Other subsystems

| Directory | Purpose |
|-----------|---------|
| `src/review/` | Diff generation, review profiles, TDD policy, snapshot diff |
| `src/sonar/` | SonarQube + SonarCloud integration, Docker management |
| `src/ci/` | CI/CD integration: dispatch.js, pr-diff.js, repo.js |
| `src/skills/` | OpenSkills client, skill detection, skill loading |
| `src/domains/` | Domain knowledge synthesis |
| `src/git/` | Git automation (auto-commit, push, PR) |
| `src/hu/` | HU system (store, graph, splitting-detector, parallel-executor) |
| `src/planning-game/` | Planning Game integration |
| `src/webperf/` | Core Web Vitals + Chrome DevTools MCP detection |
| `src/audit/` | Basal cost measurement |
| `src/prompts/` | Per-role prompt builders |
| `src/plugins/` | Plugin loader (extensibility) |
| `src/utils/` | 32 utilities (budget, display, events, logger, RTK, etc.) |
| `src/session-store.js` | Session persistence (.karajan/sessions/) |
| `src/session-cleanup.js` | Orphaned session cleanup |
| `src/config.js` | Config loading, role resolution, validation |
| `src/repeat-detector.js` | Loop detection |
| `src/bootstrap.js` | Environment validation gate |
| `src/activity-log.js` | Activity logging |

## Data flow (v2 with Brain enabled)

1. **User** runs `kj run "task description"`
2. **Auto-init** creates git repo, `.gitignore`, `.karajan/` if missing
3. **Smart init** assigns AI agents to roles by capability
4. **Preflight** validates environment
5. **Triage** classifies task complexity
6. **Karajan Brain** routes to next stage based on triage output
7. **Discover → Researcher → Architect → Planner** (opt-in)
8. **Brain** compresses pre-loop outputs, builds plan summary
9. **Iteration loop**:
   - **Coder** implements
   - **Brain verifies** changes (0 files → retry with enriched prompt)
   - **Reviewer** reviews
   - **Brain** extracts blocking issues into feedback queue, enriches them
   - If security issues: send back to coder (Solomon bypassed)
   - If dilemma: **consult Solomon** for opinion, Brain decides
   - If approved: proceed to quality gates
10. **Post-loop gates**: Tester, Security, Impeccable — all blocking in v2
11. **Final Audit**
12. **Journal** writes all stage outputs to `.reviews/session_*/`
13. **Git commit + PR** (if configured)

## Configuration layers

Config loaded in order (later wins):
1. `DEFAULTS` in `src/config.js`
2. `~/.karajan/kj.config.yml` (global)
3. `.karajan/kj.config.yml` (project)
4. CLI flags (per-run)

## Session storage

Each run creates a session directory at `.karajan/sessions/s_<timestamp>/`:
- `session.json` — state, budget, checkpoints
- Alongside: `.reviews/session_<timestamp>/` with journal files

## Key decisions

- **Vanilla JavaScript** — no TypeScript. JSDoc for types.
- **ESM modules** — `"type": "module"` in package.json.
- **Local-first** — no hosted service, runs entirely on user's machine.
- **CLI adapters, not APIs** — uses provider CLIs (`claude`, `codex`) as subprocesses, not API calls. Zero API costs.
- **Role templates as markdown** — agents read their own instructions from `templates/roles/*.md`.
- **Skills from OpenSkills** — globally installed, loaded from `~/.agent/skills/`.

# Getting Started with Karajan Code

## Prerequisites

- Node.js ≥ 18
- Git
- At least one AI CLI installed: `claude`, `codex`, `gemini`, `aider`, or `opencode`
- (Optional) Docker for local SonarQube
- (Optional) RTK for token savings: `cargo install rtk`

## Install

```bash
npm install -g karajan-code
```

Verify:
```bash
kj --version    # 2.0.0
kj doctor       # Check environment
```

## First run

### Option A: Zero config (simplest)

```bash
mkdir my-project && cd my-project
kj run "Build a REST API for a todo list with Express and Vitest tests"
```

Karajan auto-initializes:
1. Creates git repo + `.gitignore`
2. Creates `.karajan/` with role templates
3. Auto-assigns AI agents to roles by capability
4. Runs pipeline: triage → coder → reviewer → tester → security → audit

When done, check `.reviews/session_*/summary.md`.

### Option B: Interactive setup

```bash
kj init
```

The wizard asks:
- Which AI agents to use (detected automatically)
- SonarQube on/off
- TDD enforcement
- HU Board on/off
- Language (en/es)

Writes `~/.karajan/kj.config.yml`. Override per-project with `.karajan/kj.config.yml`.

## Common commands

```bash
kj run "task"                # Full pipeline
kj run "task" --enable-brain # With Karajan Brain (v2)
kj code "task"               # Just coder, no review
kj plan "task"               # Just planning, no implementation
kj review                    # Review uncommitted changes
kj audit                     # Audit whole codebase
kj status                    # Current session
kj resume <session-id>       # Resume paused
kj doctor                    # Environment check
```

## Configuration

Minimal `.karajan/kj.config.yml`:

```yaml
coder: claude
reviewer: codex
max_iterations: 5
max_budget_usd: 5

pipeline:
  planner: { enabled: true }
  researcher: { enabled: true }
  tester: { enabled: true }
  security: { enabled: true }
  brain: { enabled: true }    # v2 — Karajan Brain

sonarqube:
  enabled: true               # Auto-starts Docker if available

git:
  auto_commit: true
  auto_push: false
  auto_pr: false
```

Full reference: [configuration.md](configuration.md).

## Karajan Brain (v2 feature)

Enable the central AI orchestrator:

```yaml
brain:
  enabled: true
  provider: claude            # preferred AI for Brain decisions
```

When enabled, Brain:
- Routes role-to-role communication with intelligence
- Enriches vague feedback with concrete file paths and action plans
- Compresses outputs between roles (40-70% token savings)
- Verifies coder produced real changes (not 0-file iterations)
- Executes direct actions (npm install, .gitignore updates)
- Consults Solomon (AI judge) only on genuine dilemmas

## Where sessions live

- `.karajan/sessions/s_<timestamp>/` — session state
- `.reviews/session_<timestamp>/` — journal files (triage.md, plan.md, iterations.md, summary.md, ...)

## Pipeline visualization

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full architecture diagram and component documentation.

## Troubleshooting

Common issues: [troubleshooting.md](troubleshooting.md)

## Next steps

- Read [ARCHITECTURE.md](ARCHITECTURE.md) to understand the pipeline
- Check [SKILLS.md](SKILLS.md) for OpenSkills integration
- Browse [templates/roles/](../templates/roles/) to see role definitions
- If migrating from v1: [MIGRATION-v2.md](../MIGRATION-v2.md)

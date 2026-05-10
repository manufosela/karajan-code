# Getting Started with Karajan Code

## Prerequisites

- Node.js ≥ 20.10
- Git
- At least one AI CLI installed: `claude`, `codex`, `gemini`, `aider`, or `opencode`
- (Optional) Docker for local SonarQube
- (Optional) RTK for token savings: `cargo install rtk`

### Optional scanners — `kj audit` + `kj webperf`

Karajan's audit pipeline runs deterministic scanners in parallel and feeds their findings into the LLM prompt. **None are required** — Karajan auto-skips any that aren't installed, with a friendly hint. Install whichever match the kind of project you audit.

| Tool | Install | Used by | Gives you |
|------|---------|---------|-----------|
| **SonarQube** | `docker compose -f ~/sonarqube/docker-compose.yml up -d` | `kj audit`, `kj run` | Code quality + security rules with line-precision; `kj audit` cross-references the LLM's findings against Sonar rule IDs |
| **OSV-Scanner** | `go install github.com/google/osv-scanner@latest` | `kj audit` | Dependency CVE coverage broader than `npm audit` (GitHub Advisory DB + GLSA + Go vuln DB + others). No account, no upload |
| **Semgrep** | `pipx install semgrep` (or `brew install semgrep`) | `kj audit` | SAST: XSS, SQLi, taint flow, hardcoded secrets, language-specific anti-patterns. Equivalent to `snyk code` but free for OSS. `--config auto` ships 2 000+ rules |
| **Lighthouse** | `npm install -g lighthouse` | `kj webperf`, `kj audit` (when scan exists) | Core Web Vitals (LCP, CLS, INP) + opportunity audits (render-blocking, unused CSS, image format, font-display) for frontend projects. `kj webperf` writes the result to `~/.karajan/webperf/<slug>/last.json` and `kj audit` reads it automatically |

Skip any of them per-run with the matching `--no-*` flag (`--no-sonar`, `--no-osv`, `--no-semgrep`).

## Install

```bash
npm install -g karajan-code
```

Verify:
```bash
kj --version    # 2.13.0
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
4. Runs pipeline: triage → (auto-HU decomposition if complex) → coder → reviewer → tester → security → audit

If triage detects that the task is complex, Karajan automatically decomposes it into atomic HUs (User Stories). Each HU runs as an independent sub-pipeline with its own branch, commit, and PR. Each HU also carries executable acceptance tests that Brain runs after every coder iteration — all pass → approved, any fail → Brain diagnoses with the exact error.

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
kj plan "task"               # Generate plan + HUs (v2.5)
kj review                    # Review uncommitted changes
kj audit                     # Audit whole codebase
kj status                    # Current session
kj resume <session-id>       # Resume paused
kj doctor                    # Environment check

# Plan management (v2.5+)
kj plan list                 # List plans for this project
kj plan show <planId>        # Show plan details + HU table
kj plan validate <planId>    # Check structure, deps, IDs
kj plan ready <planId>       # Certify all HUs, mark ready to execute
kj plan add-hu <planId>      # Add HU (--title, --type, --deps, --scope)
kj plan remove-hu <planId> <huId>  # Remove HU from plan
kj plan delete <planId>      # Delete plan from disk
kj run --plan <planId> "task"      # Execute an approved plan

# HU Board dashboard
kj board start               # Start web dashboard (port 4000, fallback 4001-4009)
kj board open                # Start + open in browser
kj board status              # Check if running
kj board stop                # Stop the board
```

## Planning workflow (v2.5+)

`kj plan` introduces a two-phase flow: **plan → review → execute**. Instead of running code immediately, you first generate a structured plan with HUs, inspect and adjust it, then execute it when ready.

```bash
# Phase 1: generate a plan with HUs and acceptance tests
kj plan "Refactor the authentication layer to use JWT"
# → writes plan to disk, prints planId (e.g. plan_1234)

# Inspect and adjust
kj plan show plan_1234       # Review HU table, deps, acceptance criteria
kj plan validate plan_1234   # Check structure, no broken deps
kj plan add-hu plan_1234 --title "Add refresh token endpoint" --type feat
kj plan remove-hu plan_1234 hu_03

# Phase 2: certify and execute
kj plan ready plan_1234      # Certifies all HUs, marks plan as ready
kj run --plan plan_1234 "Refactor the authentication layer to use JWT"
# → skips researcher/architect/planner stages, loads plan directly
```

The plan is saved to `.karajan/plans/` and persists across sessions. Use `kj plan list` to see all plans for the current project.

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

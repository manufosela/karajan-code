# Getting Started with Karajan Code

## Prerequisites

- Node.js ≥ 22.22 (Karajan v3.0.0 dropped Node 20 — see CHANGELOG for migration notes)
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

### One-command install with `kj install-tools` (v2.18+)

You don't have to copy the commands above by hand. After `npm install -g karajan-code`:

```bash
kj doctor                 # Shows what's missing and the install command for YOUR system
kj install-tools          # Interactive — installs every missing tool using the package manager you already have
kj install-tools --yes    # Non-interactive (CI / automation)
kj install-tools --dry-run                       # Plan-only, prints what it would do
kj install-tools --only semgrep,osv-scanner      # Subset
```

Behaviour per tool:

- **Semgrep**: picks `pipx install semgrep` if pipx is available, falls back to `brew install semgrep`, then `pip install semgrep`.
- **OSV-Scanner**: picks `go install github.com/google/osv-scanner@latest` if Go is available, falls back to `brew install osv-scanner`.
- **Lighthouse**: `npm install -g lighthouse`. **Only suggested on frontend / fullstack projects** — backend-only projects don't see lighthouse noise. Use `--only lighthouse` to force.
- **Docker**: never auto-installed (platform-specific). Prints docs URL and, on macOS, the `brew install --cask docker` hint.
- **Sonar**: requires Docker. If a `docker-compose.yml` exists in the cwd, suggests `docker compose up -d`; otherwise a one-shot `docker run` with the official SonarQube image.

`kj doctor` lists each missing tool with the exact install command picked for your system and ends with a one-line `Tip: run kj install-tools …` reminder, so the typical flow is:

```bash
kj doctor              # see what's missing
kj install-tools       # fix it
kj doctor              # confirm clean
```

## Install

```bash
npm install -g karajan-code
```

Verify:
```bash
kj --version    # 2.34.0
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
4. Runs pipeline: **spec-reviewer** → triage → (auto-HU decomposition if complex) → coder → reviewer → tester → security → audit

The **spec-reviewer** runs first and audits your task for deficiencies (ambiguity, missing scope, missing acceptance criteria, …). On a clean spec it prints a single `✓ spec OK` line and continues silently. On findings it shows a coloured block on stderr and asks `[c]ontinue / [r]efine / [x]cancel?` — pick `r` to have the role rewrite the spec into a v2 you can edit before the pipeline runs. Bypass with `--skip-spec-review`. Full reference: [spec-reviewer.md](spec-reviewer.md).

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

## Where Karajan stores data

Everything Karajan keeps across runs now lives under a single home root: **`~/.karajan/`**. (Until v2.18.x, plans and standby state lived under `~/.kj/`. From v2.19 the layout is unified; the legacy `~/.kj/` is auto-migrated on the next `kj` command with a tarball backup at `~/.karajan/backup/`.)

| Path | What's there |
|------|--------------|
| `~/.karajan/plans/<slug>/` | Persisted `kj plan` outputs (one subdir per project) |
| `~/.karajan/sessions/<id>/` | Active and completed CLI run sessions |
| `~/.karajan/hu-stories/<id>/` | HU story batches generated by auto-decomposition |
| `~/.karajan/standby/<id>.json` | Hibernated runs (quota / rate-limit recovery) |
| `~/.karajan/runs/<id>.json` | Active run registry (CLI ↔ HU Board sync) |
| `~/.karajan/worktrees/` | Isolated git worktrees |
| `~/.karajan/kj.config.yml` | Global config (overridden per-project by `<project>/.karajan/kj.config.yml`) |
| `~/.karajan/backup/` | Tarballs created by the auto-migrator (safe to remove once you confirm nothing is missing) |
| `<project>/.kj/run.log` | Real-time run log followed by `kj-tail` |
| `<project>/.reviews/session_<id>/` | Per-session journal (triage.md, plan.md, iterations.md, summary.md, …) |

Override the root by exporting `KARAJAN_HOME=/some/path` (legacy `KJ_HOME` still honoured, with a deprecation warning).

> **Footprint & HW**: typical `~/.karajan/` weight is ~40 MB after a few weeks of use. For the full sizing table (npm tarball, Docker images, Ollama models, qmd cache) and HW requirements per install profile, see the [Footprint & hardware requirements section in README](../README.md#footprint--hardware-requirements).

## Pipeline visualization

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full architecture diagram and component documentation.

## Troubleshooting

Common issues: [troubleshooting.md](troubleshooting.md)

## Next steps

- Read [ARCHITECTURE.md](ARCHITECTURE.md) to understand the pipeline
- Use [task file templates](task-templates/README.md) when invoking `kj plan generate`, `kj run`, `kj researcher`, `kj architect`, `kj discover` or `kj refactorer` — they encode the sweet spot between too-brief and too-pre-processed
- Check [SKILLS.md](SKILLS.md) for OpenSkills integration
- Browse [templates/roles/](../templates/roles/) to see role definitions
- If migrating from v1: [MIGRATION-v2.md](../MIGRATION-v2.md)

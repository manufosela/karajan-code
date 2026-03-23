---
title: CLI Commands
description: Complete reference of all kj CLI commands and flags.
---

## Commands Overview

| Command | Description |
|---------|-------------|
| `kj init` | Interactive setup wizard |
| `kj run <task>` | Full pipeline: coder → sonar → reviewer |
| `kj code <task>` | Coder-only mode |
| `kj review <task>` | Reviewer-only mode |
| `kj plan <task>` | Generate implementation plan |
| `kj scan` | Run SonarQube analysis |
| `kj doctor` | Check environment |
| `kj config` | Show configuration |
| `kj report` | Session reports with budget tracking |
| `kj resume <id>` | Resume paused session |
| `kj roles` | Inspect pipeline roles and templates |
| `kj agents` | List or set AI agent per pipeline role |
| `kj audit [task]` | Read-only codebase health audit (5 dimensions, A-F scores) |
| `kj sonar <subcommand>` | Manage SonarQube Docker container |

**Global options:** `--help`, `--version`

---

## kj init

Initialize configuration, review rules, and SonarQube setup.

```bash
kj init [options]
```

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--no-interactive` | boolean | `false` | Skip wizard, use defaults (for CI/scripts) |

**What it does:**
- Creates `~/.karajan/kj.config.yml` with sensible defaults
- Creates `review-rules.md` and `coder-rules.md` in the project
- Detects available AI agents and guides selection
- Starts SonarQube Docker container if enabled

**Examples:**

```bash
# Interactive setup
kj init

# Non-interactive (CI/CD)
kj init --no-interactive
```

---

## kj run

Full pipeline: coder → refactorer → sonar → reviewer loop with optional pre/post stages.

```bash
kj run "<task>" [options]
```

### Task argument

The `<task>` argument accepts:
- A plain text description: `"Fix the login bug"`
- A Planning Game card ID: `"KJC-TSK-0042"` (when `--pg-project` is set or config has `planning_game.project_id`)

### Agent options

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--coder <name>` | string | from config | AI agent for coding (claude, codex, gemini, aider) |
| `--reviewer <name>` | string | from config | AI agent for review |
| `--planner <name>` | string | — | AI agent for planning |
| `--refactorer <name>` | string | — | AI agent for refactoring |
| `--coder-model <model>` | string | — | Specific model for coder (e.g., sonnet, opus) |
| `--reviewer-model <model>` | string | — | Specific model for reviewer |
| `--planner-model <model>` | string | — | Specific model for planner |
| `--refactorer-model <model>` | string | — | Specific model for refactorer |

### Pipeline stage toggles

| Flag | Default | Description |
|------|---------|-------------|
| `--enable-planner` | off | Enable planner stage |
| `--enable-refactorer` | off | Enable refactorer stage |
| `--enable-researcher` | off | Enable researcher stage (codebase investigation) |
| `--enable-tester` | off | Enable tester stage (test quality gate) |
| `--enable-security` | off | Enable security audit stage (OWASP) |
| `--enable-triage` | off | Enable task complexity classification |
| `--enable-reviewer` | on | Enable reviewer stage |
| `--enable-serena` | off | Enable Serena MCP integration |
| `--enable-impeccable` | off | Enable Impeccable design audit (automated UI/UX quality gate) |
| `--enable-hu-reviewer` | off | Enable HU story certification (user story quality gate) |
| `--hu-file <path>` | string | Path to user story file for HU reviewer |
| `--auto-simplify` | on | Auto-simplify pipeline for triage level 1-2 (coder-only, skip reviewer/tester) |
| `--no-auto-simplify` | — | Disable auto-simplify: always run full pipeline regardless of triage level |

### Review and methodology

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--mode <name>` | string | `standard` | Review strictness: `paranoid`, `strict`, `standard`, `relaxed` |
| `--methodology <name>` | string | auto-detected | Development approach: `tdd` or `standard`. Auto-detected from project test framework since v1.25.0 |
| `--reviewer-fallback <name>` | string | `codex` | Fallback reviewer if primary fails |
| `--reviewer-retries <n>` | number | `1` | Max reviewer retry attempts |
| `--coder-fallback <name>` | string | — | Fallback coder if primary hits rate limit |

### Session limits

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--max-iterations <n>` | number | `5` | Max coder/reviewer loops |
| `--max-iteration-minutes <n>` | number | `15` | Timeout per iteration (minutes) |
| `--max-total-minutes <n>` | number | `120` | Total session timeout (minutes) |
| `--checkpoint-interval <n>` | number | `5` | Minutes between interactive checkpoints (0 to disable) |

### Git options

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--base-branch <name>` | string | `main` | Base branch for diff generation |
| `--base-ref <ref>` | string | — | Explicit git ref (e.g., HEAD~3) |
| `--auto-commit` | boolean | `false` | Auto-commit after approval |
| `--auto-push` | boolean | `false` | Auto-push after commit |
| `--auto-pr` | boolean | `false` | Create PR after push |
| `--no-auto-rebase` | boolean | `false` | Disable auto-rebase before push |
| `--branch-prefix <prefix>` | string | `feat/` | Branch naming prefix |

### SonarQube and integrations

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--no-sonar` | boolean | `false` | Skip SonarQube analysis |
| `--pg-task <cardId>` | string | — | Planning Game card ID |
| `--pg-project <projectId>` | string | — | Planning Game project ID |
| `--smart-models` | boolean | from config | Enable smart model selection based on triage complexity |
| `--no-smart-models` | boolean | — | Disable smart model selection |

### Output

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--dry-run` | boolean | `false` | Show what would execute without running |
| `--json` | boolean | `false` | Output JSON only (no styled display) |

### Examples

```bash
# Basic run with defaults
kj run "Add input validation to the signup form"

# Strict TDD with specific agents
kj run "Fix SQL injection in search endpoint" \
  --coder claude --reviewer codex --mode paranoid

# Multi-agent with all stages
kj run "Implement user authentication" \
  --enable-planner --enable-tester --enable-security \
  --coder claude --reviewer codex --max-iterations 3

# Planning Game integration
kj run "KJC-TSK-0042" --pg-project "Karajan Code"

# Dry run to preview pipeline
kj run "Refactor database layer" --dry-run

# Auto-commit and push after approval
kj run "Add loading spinner" --auto-commit --auto-push
```

---

## kj code

Run coder only — no review loop. Useful for quick changes you'll review yourself.

```bash
kj code "<task>" [options]
```

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--coder <name>` | string | from config | AI agent for coding |
| `--coder-model <model>` | string | — | Specific model for coder |

**Examples:**

```bash
kj code "Add a loading spinner to the dashboard"
kj code "Write unit tests for the auth service" --coder gemini
```

---

## kj review

Run reviewer only against the current git diff. Useful after manual changes.

```bash
kj review "<task>" [options]
```

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--reviewer <name>` | string | from config | AI agent for review |
| `--reviewer-model <model>` | string | — | Specific model for reviewer |
| `--base-ref <ref>` | string | `main` | Git ref to diff against |

**Examples:**

```bash
kj review "Review my auth refactor"
kj review "Check for security issues" --reviewer claude --base-ref HEAD~5
```

---

## kj plan

Generate an implementation plan without writing code.

```bash
kj plan "<task>" [options]
```

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--planner <name>` | string | coder role | AI agent for planning |
| `--planner-model <model>` | string | — | Specific model for planner |
| `--context <text>` | string | — | Additional context for planner |
| `--json` | boolean | `false` | Output raw JSON plan |

**Examples:**

```bash
kj plan "Migrate from REST to GraphQL"
kj plan "Add multi-tenancy support" --context "Using row-level security" --json
```

---

## kj scan

Run SonarQube static analysis on the current project.

```bash
kj scan
```

No additional options. Uses SonarQube settings from config.

**Prerequisites:** Docker running, SonarQube container started (`kj sonar start`).

---

## kj doctor

Check system environment for required tools and configuration.

```bash
kj doctor
```

**Checks performed:**

| Check | What it verifies |
|-------|-----------------|
| Karajan version | Shows installed Karajan Code version |
| Config file | `kj.config.yml` exists |
| Git repository | Inside a git repo |
| Docker | Docker is installed |
| SonarQube | Reachable at configured host |
| Agent CLIs | Claude, Codex, Gemini, Aider respond to `--version` |
| Core binaries | node, npm, git installed |
| Serena MCP | `serena --version` (when enabled) |
| Rule files | review-rules.md and coder-rules.md exist |

Each check shows `OK` or `MISS` with a suggested fix.

---

## kj config

Display or edit configuration.

```bash
kj config [options]
```

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--json` | boolean | `false` | Output as JSON |
| `--edit` | boolean | `false` | Open in `$EDITOR` for editing |

**Examples:**

```bash
kj config              # Pretty-print current config
kj config --json       # Output as JSON
kj config --edit       # Open in editor
```

---

## kj report

Display session reports with budget tracking and token usage.

```bash
kj report [options]
```

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--list` | boolean | `false` | List all session IDs |
| `--session-id <id>` | string | latest | Show report for specific session |
| `--format <type>` | string | `text` | Output format: `text` or `json` |
| `--trace` | boolean | `false` | Show chronological trace of all stages |
| `--currency <code>` | string | `usd` | Display costs in `usd` or `eur` |

**Report includes:**
- Session ID and status
- Task description
- Pipeline stages executed
- Iterations (coder runs, reviewer attempts, approval status)
- SonarQube issues (initial → final → delta)
- Estimated budget consumed
- Commits generated
- Trace mode: per-stage timing, tokens in/out, cost breakdown

**Examples:**

```bash
kj report                              # Latest session
kj report --trace                      # Detailed cost breakdown
kj report --list                       # List all sessions
kj report --session-id s_2026-02-28... # Specific session
kj report --trace --currency eur       # Costs in EUR
kj report --format json                # Machine-readable
```

---

## kj resume

Resume a paused, stopped, or failed session. Sessions pause on repeat detection, budget warnings, or when human guidance is needed.

```bash
kj resume <sessionId> [options]
```

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--answer <text>` | string | — | Answer to the question that caused the pause |
| `--json` | boolean | `false` | Output JSON only |

**Examples:**

```bash
# Resume with guidance
kj resume s_2026-02-28T20-47-24 --answer "Focus on the security issue first"

# Resume and check result as JSON
kj resume s_2026-02-28T20-47-24 --answer "Skip the style issues" --json
```

---

## kj roles

List pipeline roles or show role template instructions.

```bash
kj roles [subcommand] [role]
```

| Subcommand | Description |
|------------|-------------|
| `list` (default) | List all available roles |
| `show <role>` | Show the full template for a role |

**Available roles:**

| Role | Purpose |
|------|---------|
| `triage` | Task complexity classification |
| `researcher` | Codebase investigation |
| `planner` | Implementation planning |
| `coder` | Code and test generation |
| `refactorer` | Code quality improvement |
| `sonar` | Static analysis |
| `reviewer` | Code review |
| `tester` | Test quality gate |
| `security` | OWASP security audit |
| `solomon` | Conflict resolution |
| `commiter` | Git automation |

Review mode variants: `reviewer-strict`, `reviewer-relaxed`, `reviewer-paranoid`

**Examples:**

```bash
kj roles                    # List all roles
kj roles show coder         # Show coder template
kj roles show reviewer      # Show reviewer template
```

---

## kj agents

List or set the AI agent assigned to each pipeline role on the fly. Changes persist to `kj.config.yml` — no restart needed.

```bash
kj agents [subcommand] [role] [agent]
```

| Subcommand | Description |
|------------|-------------|
| `list` (default) | Show current agent assignment per role |
| `set <role> <agent>` | Assign an agent to a role and persist to config |

**Examples:**

```bash
kj agents                    # List current agent per role
kj agents list               # Same as above
kj agents set coder gemini   # Switch the coder role to Gemini
kj agents set reviewer claude # Switch the reviewer role to Claude
```

---

## kj sonar

Manage the SonarQube Docker container.

```bash
kj sonar <subcommand>
```

| Subcommand | Description |
|------------|-------------|
| `status` | Check container status |
| `start` | Start SonarQube container |
| `stop` | Stop SonarQube container |
| `logs` | View container logs |
| `open` | Open SonarQube dashboard in browser |

**Examples:**

```bash
kj sonar status     # Is SonarQube running?
kj sonar start      # Start it
kj sonar open       # Open dashboard at http://localhost:9000
kj sonar logs       # Check logs if something is wrong
kj sonar stop       # Stop when done
```

---

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `KJ_HOME` | Config and sessions directory | `~/.karajan` |
| `KJ_SONAR_TOKEN` | SonarQube authentication token | from config |
| `KJ_SONAR_PROJECT_KEY` | SonarQube project key | auto-detected |
| `KJ_SONAR_ADMIN_USER` | SonarQube admin username | `admin` |
| `KJ_SONAR_ADMIN_PASSWORD` | SonarQube admin password | from config |
| `SONAR_TOKEN` | Alternative SonarQube token | fallback |
| `PG_API_URL` | Planning Game API URL | `https://planning-game.geniova.com/api` |
| `VISUAL` | Text editor for `kj config --edit` | fallback to `EDITOR` |
| `EDITOR` | Text editor fallback | `vi` |

---

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | Error (command failed, validation error, config error, budget exceeded) |

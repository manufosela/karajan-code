<p align="center">
  <img src="docs/karajan-code-logo-small.png" alt="Karajan Code" width="200">
</p>

<h1 align="center">Karajan Code</h1>

<p align="center">
  Local multi-agent coding orchestrator with TDD, SonarQube, and automated code review.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/karajan-code"><img src="https://img.shields.io/npm/v/karajan-code.svg" alt="npm version"></a>
  <a href="https://github.com/manufosela/karajan-code/actions"><img src="https://github.com/manufosela/karajan-code/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://www.gnu.org/licenses/agpl-3.0"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue.svg" alt="License"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg" alt="Node.js"></a>
</p>

<p align="center">
  <a href="docs/README.es.md">Leer en Español</a>
</p>

---

## What is Karajan Code?

Karajan Code (`kj`) orchestrates multiple AI coding agents through an automated pipeline: code generation, static analysis, code review, testing, and security audits — all in a single command.

Instead of running one AI agent and manually reviewing its output, `kj` chains agents together with quality gates. The coder writes code, SonarQube scans it, the reviewer checks it, and if issues are found, the coder gets another attempt. This loop runs until the code is approved or the iteration limit is reached.

**Key features:**
- **Multi-agent pipeline** with 11 configurable roles
- **4 AI agents supported**: Claude, Codex, Gemini, Aider
- **MCP server** with 15 tools — use `kj` from Claude, Codex, or any MCP-compatible host without leaving your agent. [See MCP setup](#mcp-server)
- **TDD enforcement** — test changes required when source files change
- **SonarQube integration** — static analysis with quality gate enforcement (requires [Docker](#requirements))
- **Review profiles** — standard, strict, relaxed, paranoid
- **Budget tracking** — per-session token and cost monitoring with `--trace`
- **Git automation** — auto-commit, auto-push, auto-PR after approval
- **Session management** — pause/resume with fail-fast detection and automatic cleanup of expired sessions
- **Plugin system** — extend with custom agents via `.karajan/plugins/`
- **Smart model selection** — auto-selects optimal model per role based on triage complexity (lighter models for trivial tasks, powerful models for complex ones)
- **Interactive checkpoints** — instead of killing long-running tasks, pauses every 5 minutes with a progress report and lets you decide: continue, stop, or adjust the time
- **Task decomposition** — triage detects when tasks should be split and recommends subtasks; with Planning Game integration, creates linked cards with sequential blocking
- **Retry with backoff** — automatic recovery from transient API errors (429, 5xx) with exponential backoff and jitter
- **Pipeline stage tracker** — cumulative progress view during `kj_run` showing which stages are done, running, or pending — both in CLI and via MCP events for real-time host rendering
- **Planner observability guardrails** — continuous heartbeat/stall telemetry, configurable max-silence protection (`session.max_agent_silence_minutes`), and hard runtime cap (`session.max_planner_minutes`) to avoid long stuck planner runs
- **Rate-limit standby** — when agents hit rate limits, Karajan parses cooldown times, waits with exponential backoff, and auto-resumes instead of failing
- **Preflight handshake** — `kj_preflight` requires human confirmation of agent assignments before execution, preventing AI from silently overriding your config
- **3-tier config** — session > project > global config layering with `kj_agents` scoping
- **Intelligent reviewer mediation** — scope filter auto-defers out-of-scope reviewer issues (files not in the diff) as tracked tech debt instead of stalling; Solomon mediates stalled reviews; deferred context injected into coder prompt
- **Planning Game integration** — optionally pair with [Planning Game](https://github.com/AgenteIA-Geniova/planning-game) for agile project management (tasks, sprints, estimation) — like Jira, but open-source and XP-native

> **Best with MCP** — Karajan Code is designed to be used as an MCP server inside your AI agent (Claude, Codex, etc.). The agent sends tasks to `kj_run`, gets real-time progress notifications, and receives structured results — no copy-pasting needed.

## Requirements

- **Node.js** >= 18
- **Docker** — required for SonarQube static analysis. If you don't have Docker or don't need SonarQube, disable it with `--no-sonar` or set `sonarqube.enabled: false` in config
- At least one AI agent CLI installed: Claude, Codex, Gemini, or Aider

## Pipeline

```
triage? ─> researcher? ─> planner? ─> coder ─> refactorer? ─> sonar? ─> reviewer ─> tester? ─> security? ─> commiter?
```

| Role | Description | Default |
|------|-------------|---------|
| **triage** | Pipeline director — analyzes task complexity and activates roles dynamically | **On** |
| **researcher** | Investigates codebase context before planning | Off |
| **planner** | Generates structured implementation plans | Off |
| **coder** | Writes code and tests following TDD methodology | **Always on** |
| **refactorer** | Improves code clarity without changing behavior | Off |
| **sonar** | Runs SonarQube static analysis and quality gate checks | On (if configured) |
| **reviewer** | Code review with configurable strictness profiles | **Always on** |
| **tester** | Test quality gate and coverage verification | **On** |
| **security** | OWASP security audit | **On** |
| **solomon** | Session supervisor — monitors iteration health with 5 rules (incl. reviewer overreach), mediates stalled reviews, escalates on anomalies | **On** |
| **commiter** | Git commit, push, and PR automation after approval | Off |

Roles marked with `?` are optional and can be enabled per-run or via config.

## Installation

### From npm (recommended)

```bash
npm install -g karajan-code
kj init
```

### From source

```bash
git clone https://github.com/manufosela/karajan-code.git
cd karajan-code
./scripts/install.sh
```

### Non-interactive setup (CI/automation)

```bash
./scripts/install.sh \
  --non-interactive \
  --kj-home /path/to/.karajan \
  --sonar-host http://localhost:9000 \
  --sonar-token "$KJ_SONAR_TOKEN" \
  --coder claude \
  --reviewer codex \
  --run-doctor true
```

### Multi-instance setup

Full guides: [`docs/multi-instance.md`](docs/multi-instance.md) | [`docs/install-two-instances.md`](docs/install-two-instances.md)

```bash
./scripts/setup-multi-instance.sh
```

## Supported Agents

| Agent | CLI | Install |
|-------|-----|---------|
| **Claude** | `claude` | `npm install -g @anthropic-ai/claude-code` |
| **Codex** | `codex` | `npm install -g @openai/codex` |
| **Gemini** | `gemini` | See [Gemini CLI docs](https://github.com/google-gemini/gemini-cli) |
| **Aider** | `aider` | `pip install aider-chat` |

`kj init` auto-detects installed agents. If only one is available, it is assigned to all roles automatically.

## Quick Start

```bash
# Run a task with defaults (claude=coder, codex=reviewer, TDD)
kj run "Implement user authentication with JWT"

# Coder-only mode (skip review)
kj code "Add input validation to the signup form"

# Review-only mode (review current diff)
kj review "Check the authentication changes"

# Generate an implementation plan
kj plan "Refactor the database layer to use connection pooling"

# Full pipeline with all options
kj run "Fix critical SQL injection in search endpoint" \
  --coder claude \
  --reviewer codex \
  --reviewer-fallback claude \
  --methodology tdd \
  --enable-triage \
  --enable-tester \
  --enable-security \
  --auto-commit \
  --auto-push \
  --max-iterations 5
```

## CLI Commands

### `kj init`

Interactive setup wizard. Auto-detects installed agents and guides coder/reviewer selection, SonarQube configuration, and methodology choice.

```bash
kj init                  # Interactive wizard
kj init --no-interactive # Use defaults (for CI)
```

### `kj run <task>`

Run the full pipeline: coder → sonar → reviewer loop.

```bash
kj run "Fix the login bug" [options]
```

| Flag | Description |
|------|-------------|
| `--coder <name>` | AI agent for coding (claude, codex, gemini, aider) |
| `--reviewer <name>` | AI agent for review |
| `--reviewer-fallback <name>` | Fallback reviewer if primary fails |
| `--coder-model <name>` | Specific model for coder |
| `--reviewer-model <name>` | Specific model for reviewer |
| `--planner-model <name>` | Specific model for planner |
| `--methodology <name>` | `tdd` or `standard` |
| `--mode <name>` | Review mode: `standard`, `strict`, `paranoid`, `relaxed` |
| `--max-iterations <n>` | Max coder/reviewer loops |
| `--max-iteration-minutes <n>` | Timeout per iteration |
| `--max-total-minutes <n>` | Total session timeout |
| `--base-branch <name>` | Base branch for diff (default: `main`) |
| `--base-ref <ref>` | Explicit base ref for diff |
| `--enable-planner` | Enable planner role |
| `--enable-refactorer` | Enable refactorer role |
| `--enable-researcher` | Enable researcher role |
| `--enable-tester` | Enable tester role |
| `--enable-security` | Enable security audit role |
| `--enable-triage` | Enable dynamic triage |
| `--enable-serena` | Enable Serena MCP integration |
| `--auto-commit` | Git commit after approval |
| `--auto-push` | Git push after commit |
| `--auto-pr` | Create PR after push |
| `--no-auto-rebase` | Disable auto-rebase before push |
| `--branch-prefix <prefix>` | Branch naming prefix (default: `feat/`) |
| `--smart-models` | Enable smart model selection based on triage complexity |
| `--no-smart-models` | Disable smart model selection |
| `--no-sonar` | Skip SonarQube analysis |
| `--checkpoint-interval <n>` | Minutes between interactive checkpoints (default: 5) |
| `--pg-task <cardId>` | Planning Game card ID for task context |
| `--pg-project <projectId>` | Planning Game project ID |
| `--dry-run` | Show what would run without executing |
| `--json` | Output JSON only |

### `kj code <task>`

Run coder only (no review loop).

```bash
kj code "Add error handling to the API client" --coder claude --coder-model sonnet
```

### `kj review <task>`

Run reviewer only against current diff.

```bash
kj review "Check auth changes" --reviewer codex --base-ref HEAD~3
```

### `kj plan <task>`

Generate an implementation plan without writing code.

```bash
kj plan "Migrate from REST to GraphQL" --planner claude --context "We use Apollo Server"
```

### `kj scan`

Run SonarQube analysis on the current project.

### `kj doctor`

Check environment: git, Docker, SonarQube, agent CLIs, rule files.

### `kj config`

Show current configuration.

```bash
kj config          # Pretty print
kj config --json   # JSON output
kj config --edit   # Open in $EDITOR
```

### `kj report`

Show session reports with budget tracking.

```bash
kj report                          # Latest session report
kj report --list                   # List all session IDs
kj report --session-id <id>        # Specific session
kj report --trace                  # Chronological stage breakdown
kj report --trace --currency eur   # Costs in EUR
kj report --format json            # JSON output
```

### `kj resume <sessionId>`

Resume a paused session (e.g., after fail-fast).

```bash
kj resume s_2026-02-28T20-47-24-270Z --answer "yes, proceed with the fix"
```

### `kj agents`

List or change AI agent assignments per role.

```bash
kj agents                       # List current agents (with scope column)
kj agents set coder gemini      # Set coder to gemini (project scope)
kj agents set reviewer claude --global  # Set reviewer globally
```

### `kj roles`

Inspect pipeline roles and their template instructions.

```bash
kj roles              # List all roles with provider and status
kj roles show coder   # Show coder role template
kj roles show reviewer-paranoid  # Show paranoid review variant
```

### `kj sonar`

Manage the SonarQube Docker container.

```bash
kj sonar status   # Check container status
kj sonar start    # Start container
kj sonar stop     # Stop container
kj sonar logs     # View container logs
kj sonar open     # Open dashboard in browser
```

## Configuration

Configuration file: `~/.karajan/kj.config.yml` (or `$KJ_HOME/kj.config.yml`)

Generated by `kj init`. Full reference:

```yaml
# AI Agents
coder: claude
reviewer: codex

# Review settings
review_mode: standard          # standard | strict | paranoid | relaxed
max_iterations: 5
review_rules: ./review-rules.md
coder_rules: ./coder-rules.md
base_branch: main

# Coder settings
coder_options:
  model: null                  # Override model (e.g., sonnet, o4-mini)
  auto_approve: true

# Reviewer settings
reviewer_options:
  output_format: json
  require_schema: true
  model: null
  deterministic: true
  retries: 1
  fallback_reviewer: codex

# Development methodology
development:
  methodology: tdd             # tdd | standard
  require_test_changes: true

# SonarQube
sonarqube:
  enabled: true
  host: http://localhost:9000
  token: null                  # Set via KJ_SONAR_TOKEN env var
  quality_gate: true
  enforcement_profile: pragmatic
  fail_on: [BLOCKER, CRITICAL]
  ignore_on: [INFO]
  max_scan_retries: 3

# Git automation (post-approval)
git:
  auto_commit: false
  auto_push: false
  auto_pr: false
  auto_rebase: true
  branch_prefix: feat/

# Session limits
session:
  max_iteration_minutes: 15
  max_total_minutes: 120
  checkpoint_interval_minutes: 5  # Interactive checkpoint every N minutes
  max_budget_usd: null         # null = unlimited
  fail_fast_repeats: 2

# Budget tracking
budget:
  currency: usd                # usd | eur
  exchange_rate_eur: 0.92

# Smart model selection (requires --enable-triage)
model_selection:
  enabled: true                # Auto-select models based on triage complexity
  tiers:                       # Override default tier map per provider
    claude:
      simple: claude/sonnet    # Use sonnet even for simple tasks
  role_overrides:              # Override level mapping per role
    reviewer:
      trivial: medium          # Reviewer always at least medium tier

# Output
output:
  report_dir: ./.reviews
  log_level: info              # debug | info | warn | error
```

### Environment variables

| Variable | Description |
|----------|-------------|
| `KJ_HOME` | Override config/sessions directory |
| `KJ_SONAR_TOKEN` | SonarQube authentication token |

## MCP Server

Karajan Code exposes an MCP server for integration with any MCP-compatible host (Claude, Codex, custom agents).

### Setup

After `npm install -g karajan-code`, the MCP server is auto-registered in Claude and Codex configs. Manual config:

```json
{
  "mcpServers": {
    "karajan-mcp": {
      "command": "karajan-mcp"
    }
  }
}
```

### MCP Tools

| Tool | Description |
|------|-------------|
| `kj_init` | Initialize config and SonarQube |
| `kj_doctor` | Check system dependencies |
| `kj_config` | Show configuration |
| `kj_scan` | Run SonarQube scan |
| `kj_run` | Run full pipeline (with real-time progress notifications) |
| `kj_resume` | Resume a paused session |
| `kj_report` | Read session reports (supports `--trace`) |
| `kj_roles` | List roles or show role templates |
| `kj_agents` | List or change agent assignments (session/project/global scope) |
| `kj_preflight` | Human confirms agent config before kj_run/kj_code executes |
| `kj_code` | Run coder-only mode (with progress notifications) |
| `kj_review` | Run reviewer-only mode (with progress notifications) |
| `kj_plan` | Generate implementation plan (with progress notifications) |
| `kj_status` | Live parsed status of current run (stage, agent, iteration, errors) |

### MCP restart after version updates

If you update Karajan Code (for example `npm install -g karajan-code` to a new version) while your MCP host session is still open, the current `karajan-mcp` process may exit and the host can show `Transport closed`.

This is expected behavior: the MCP server detects a version mismatch and exits so the host can spawn a fresh process with the new code.

Quick recovery:

1. Restart your MCP host session (Claude/Codex/new terminal session).
2. Verify the server is listed (`codex mcp list` or your host equivalent).
3. Run a lightweight check (`kj_config`) before continuing with larger runs.

### Recommended Companion MCPs

Karajan Code works great on its own, but combining it with these MCP servers gives your AI agent a complete development environment:

| MCP | Why | Use case |
|-----|-----|----------|
| [**Planning Game MCP**](https://github.com/AgenteIA-Geniova/planning-game-mcp) | MCP bridge for [Planning Game](https://github.com/AgenteIA-Geniova/planning-game), an open-source agile project manager (tasks, sprints, estimation, XP). Only needed if you use Planning Game for task management | `kj_run` with `--pg-task` fetches full task context and updates card status on completion |
| [**GitHub MCP**](https://github.com/modelcontextprotocol/servers/tree/main/src/github) | Create PRs, manage issues, read repos directly from the agent | Combine with `--auto-push` for end-to-end: code → review → push → PR |
| [**Serena**](https://github.com/oramasearch/serena) | Symbol-level code navigation (find references, go-to-definition) for JS/TS projects | Enable with `--enable-serena` to inject symbol context into coder/reviewer prompts |
| [**Chrome DevTools MCP**](https://github.com/anthropics/anthropic-quickstarts/tree/main/chrome-devtools-mcp) | Browser automation, screenshots, console/network inspection | Verify UI changes visually after `kj` modifies frontend code |
| [**RTK**](https://github.com/rtk-ai/rtk) | Reduces LLM token consumption by 60-90% on Bash command outputs (git, test, build) | Install globally with `brew install rtk && rtk init --global` — all KJ agent commands automatically compressed |

## Role Templates

Each role has a `.md` template with instructions that the AI agent follows. Templates are resolved in priority order:

1. **Project override**: `.karajan/roles/<role>.md` (in project root)
2. **User override**: `$KJ_HOME/roles/<role>.md`
3. **Built-in**: `templates/roles/<role>.md` (shipped with the package)

Use `kj roles show <role>` to inspect any template. Create a project override to customize behavior per-project.

**Review variants**: `reviewer-strict`, `reviewer-relaxed`, `reviewer-paranoid` — selectable via `--mode` flag or `review_mode` config.

## Contributing

```bash
git clone https://github.com/manufosela/karajan-code.git
cd karajan-code
npm install
npm test              # Run 1190+ tests with Vitest
npm run test:watch    # Watch mode
npm run validate      # Lint + test
```

- Tests: [Vitest](https://vitest.dev/)
- Commits: [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `refactor:`, `test:`, `chore:`)
- PRs: one purpose per PR, < 300 lines changed

## Links

- [Website](https://karajancode.com) (also [kj-code.com](https://kj-code.com))
- [Changelog](CHANGELOG.md)
- [Security Policy](SECURITY.md)
- [License (AGPL-3.0)](LICENSE)
- [Issues](https://github.com/manufosela/karajan-code/issues)

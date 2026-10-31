---
title: CLI Commands
description: Complete reference of all kj CLI commands and flags.
---

:::caution[v3 docs (legacy)]
This is the v3 command reference. `kj run` and the rest of the pipeline commands were retired in 5.0: see [Migrating to 5.0](/docs/v4/migration/) and the current [Command reference](/docs/v4/commands/).
:::

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
| `kj status` | Terminal dashboard with HU states, stage, timing, progress |
| `kj undo` | Revert last pipeline run (soft reset or --hard) |
| `kj board <subcommand>` | Manage HU Board dashboard |
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
- Auto-appends `.kj/`, `.agent/`, `.scannerwork/` to the project `.gitignore` if missing (v1.57.2+)

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
| `--coder <name>` | string | from config | AI agent for coding (claude, codex, gemini, aider, opencode) |
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
| `--auto-pr` | boolean | `false` | Create PR after push; the PR gets the `Karajan` label (created if missing; a labelling failure is logged and the PR stays) |
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

### Proving the cross-AI review in CI (`--publish-pr`, `--verify-pr`)

`kj review --publish-pr <n>` publishes, as one GitHub review, the verdict kj holds for each commit of the PR, bound to the hash of the diff it brought. `kj review --verify-pr <n>` is its CI side: it exits 1 naming every commit that the review for the PR's current head does not list with a matching diff hash. Only a review written by an owner, member or collaborator of the repo counts, so skipping the pre-commit hook (`--no-verify`) no longer leaves a commit unreviewed.

### Reviewing someone else's PR (`--third-party`)

For reviewer agents and people who review other people's PRs. In a clone with the PR's head checked out:

```bash
kj review --range main...pr-branch --third-party --json --reviewer claude
```

- Runs only kj's reviewer, with the target repo's rules (`.karajan`) and the provider you pass, even if it is the one you are running in.
- Skips the own-work gates (card, tests next to code, policy, session RAG proof) and **stores no verdict**: it can never unlock a commit of your own. `kj review --range` without `--third-party` keeps every gate.
- Adds checks with no tokens, in two lists. `checks` holds security: `secrets`, `privacy`, `prompt-injection`, `dependency-cooldown`, `semgrep` (PR files only) and `sonar` (when SonarQube is reachable; otherwise "not available"). `policyChecks` holds the house requirements, which another repo may not share: `size` (the repo's budget), `conventional-commits`, `ai-attribution` and `tests`. kj does not impose its own conventions there: `conventional-commits` is only checked when the reviewed repo declares a commit convention (a commitlint config, or kj's `commit-msg` hook); otherwise it comes back with `ok: null` and `skipped: true`. Code changed with no test changed is not a failure either: `tests` comes back with `ok: null` and a `question` (does the change touch business logic?), since a plain index or a configuration change needs no test.
- The PR's title and description go in with `--task-file pr.md` (or as the task argument, not both). They reach the reviewer fenced and labelled as untrusted text from the PR author: context only, never instructions, so a description cannot ask the reviewer to approve.
- The reviewed repo's own docs reach the reviewer too, so it judges by the repo's conventions and not general ones: `CONTRIBUTING.md` (also under `.github/`), `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.github/copilot-instructions.md`, `.github/pull_request_template.md`, `README.md` and the Markdown under `docs/`, in that order and within a size budget. They are read at the **base** of the range, so a PR cannot rewrite the rules it is reviewed against (if it changes one of them, the reviewer sees that in the diff), and they are fenced as untrusted data like the PR text. `repoContext` in the JSON lists the files that were used, the ones left out by the budget (`omitted`) and, if the base could not be read, why (`error`).
- When the reviewed repo has no atril store, the reviewer still gets skills for its stack. kj reads the languages and frameworks at the base (file extensions and manifest dependencies), and atril resolves the reviewer's skill for them from your own store (`~/.atril`). When nothing installed fits, the best skill from a catalog is installed into a temporary folder outside the reviewed repo and removed after the review. The catalogs are atril's recommended set plus the ones listed, as absolute paths, under `review.third_party.catalogs` in your kj config; git sources are fetched for each review. `repoContext.skills` lists the detected `stack`, the skills `used`, the ones `installed` from a catalog and the ones `dropped` by the per-role limit; if gathering them failed, `error` says why and the review goes on without them. A repo with its own atril store keeps its own skills.
- Own-work flags this mode does not use (`--staged`, `--check`, `--base-ref`, `--walked`, `--no-sonar`, `--publish-pr`...) fail with a JSON error instead of being ignored.
- `--lens qa` reviews with a QA rubric: new behavior with no test, tests that cannot fail, flakiness by construction (sleeps, order, uncontrolled clock or network), fragile selectors, missing scenarios and test data that is not reserved for testing.
- `--verifier <provider> [--verifier-model <model>]` sends every finding, with only its hunk, to an AI of another provider family (kj refuses the reviewer's own family). It answers confirmed, downgraded or rejected per finding: rejected findings leave `findings` and are listed in `verification.rejected` with their reason, a downgrade can only lower the severity, and a security or critical finding is never rejected nor downgraded. The `verification` block counts what was confirmed, downgraded, rejected, left unverified and kept by rule; a verifier that fails leaves every finding as it was and says why in `verification.error`.
- `--reviewers <a,b> [--reviewer-models <a=model,b=model>]` (for complex PRs, it costs two reviews) has two reviewers of different families review the whole range on their own; each one's findings are verified by the other, as `--verifier` does. One result comes back: `reviewers` holds each one's verdict, every finding says who found it (`found_by`) and how the other family judged it (`verification`), the ones both found rank first, and `verification.rejected` lists the rejected with who found and who rejected them. The verdict is `rejected` while a confirmed blocker remains (security, or high/critical confirmed by the other family or found by both), `approved` only when both approve and every file was reviewed, `partial` when some file was not reviewed (named in `coverage.unreviewed`), and `disputed` when everything was reviewed but one reviewer rejected without a blocker the other family confirmed; `partial` and `disputed` carry their `reason`. Two reviewers of the same family are refused, and so is `--verifier` next to it.
- Known privacy false positives of the reviewed repo go in its own `.karajan/privacy.yml`, under `allow`. It is read at the **base** of the range, so a PR cannot add the exemption it needs; a `personal` list in that file is ignored (it only lives in `~/.karajan/privacy.yml`).
- Test data with ordinary-looking phones or emails: list the test folders under `test_paths` in the same file (for example `src/test/**`, `**/testdata/**`). Generic personal-data findings in those files are discarded and counted in the check's detail; the personal denylist and secret shapes still block there. A glob with no folder name (`**`, `**/*`) is refused.
- Reviews the whole diff of a large PR: whole files are grouped into batches that fit one reviewer prompt, up to 10 calls. A file too large for one prompt is split by hunks, and a hunk too large (a new file is one hunk) by lines, each piece with the file's header and its own line numbers; only files past the cap, or a single line larger than one prompt, are not reviewed, and they are named in `coverage.unreviewed`. `verdict.status` is `rejected` if any batch was, `approved` only when every file was reviewed, and `partial` otherwise (`approved: false`).
- Over the size budget (the repo's own, 200 lines by default; generated files and lockfiles do not count), adds `advice.split`: why a PR that large reviews worse, and a proposal of chunks, each with a name, purpose, files and approximate lines. Chunks follow the project's structure (the Java/Kotlin package under the root package, the folder under `src/` in JS/TS, tests and resources apart) and are ordered by layer (configuration, data types, helpers, services, pages, flows, tests) so each builds on the ones before it. It is advice: it never counts as a finding and never changes the verdict.
- Prints one JSON document on stdout (logs go to stderr) and exits 0 whatever the verdict; a non-zero code means kj itself failed.

```json
{
  "mode": "third-party",
  "range": "main...pr-branch",
  "reviewer": "claude",
  "verdict": { "status": "rejected", "approved": false, "summary": "..." },
  "coverage": { "files": { "reviewed": 52, "total": 52 }, "lines": { "reviewed": 1822, "total": 1822 }, "truncated": false, "unreviewed": [] },
  "findings": [{ "file": "src/add.js", "line": 2, "severity": "high", "description": "...", "suggested_fix": "..." }],
  "suggestions": ["..."],
  "checks": [{ "id": "secrets", "ok": true, "detail": "..." }],
  "policyChecks": [{ "id": "tests", "ok": null, "detail": "source changed with no test changed", "question": "No test changed: does the change touch business logic, ...?" }]
}
```

---

## kj spec refine

Turn a high-level spec into a detailed one you accept before planning. kj never plans here: it writes the detailed spec and stops.

```bash
kj spec refine --task-file spec.md [--e2e tests/e2e/reset.spec.js ...] [--out <file>] [--json]
```

- The spec reviewer looks for gaps first; the detailed spec addresses them.
- The result has these sections: Goal, Behaviour, Edge cases and errors, Out of scope, Acceptance criteria (Given/When/Then), Assumptions and Open questions. What the spec does not decide goes to Assumptions or Open questions; no scope is invented.
- With `--e2e`, each acceptance criterion names the e2e test that covers it, or says `(no e2e yet)`. Without e2e tests, each one ends with `(proposed e2e)` and names the scenario to write.
- It is written to `<spec>.detailed.md` next to the spec, or to `--out`. An existing file is never overwritten.
- Review it (Assumptions and Open questions first), edit what you need, then `kj plan generate --task-file spec.detailed.md`.

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
| `discover` | Pre-execution gap detection |
| `hu-reviewer` | User story certification |
| `architect` | Solution architecture design |
| `audit` | Read-only codebase health audit |

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

## kj status

Display a terminal dashboard showing HU states, current pipeline stage, timing, and overall progress.

```bash
kj status
```

When called via MCP (`kj_status`), returns structured JSON with the same information for programmatic access.

**Output includes:**
- Current pipeline stage and agent
- HU states (pending, coding, reviewing, done, failed, blocked)
- Iteration count and timing
- Progress percentage
- Error summary (if any)

---

## kj undo

Revert the last pipeline run. Performs a soft git reset by default, preserving changes in the working directory.

```bash
kj undo [options]
```

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--hard` | boolean | `false` | Hard reset: discard all changes from the last run |
| `--session-id <id>` | string | latest | Revert a specific session instead of the last one |

**Examples:**

```bash
# Soft reset (keep changes in working directory)
kj undo

# Hard reset (discard all changes)
kj undo --hard

# Revert a specific session
kj undo --session-id s_2026-03-28T14-30-00
```

---

## kj board

Manage the HU Board dashboard for visual task tracking.

```bash
kj board <subcommand>
```

| Subcommand | Description |
|------------|-------------|
| `start` | Start the HU Board dashboard |
| `stop` | Stop the HU Board dashboard |
| `status` | Check if the HU Board is running |
| `open` | Open the HU Board in the browser |

**Examples:**

```bash
kj board start      # Start the dashboard
kj board status     # Check if it's running
kj board open       # Open in browser
kj board stop       # Stop the dashboard
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
| `HU_BOARD_TOKEN` | Bearer token for HU Board authentication | — |
| `PG_API_URL` | Planning Game API URL; overrides `planning_game.api_url` in the config (default `http://localhost:3000/api`) | `https://pg.example.com/api` |
| `VISUAL` | Text editor for `kj config --edit` | fallback to `EDITOR` |
| `EDITOR` | Text editor fallback | `vi` |

---

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | Error (command failed, validation error, config error, budget exceeded) |

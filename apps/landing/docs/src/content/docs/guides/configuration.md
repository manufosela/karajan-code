---
title: Configuration
description: Configure Karajan Code for your project — from quick setup to advanced pipeline tuning.
---

## Quick Setup

Run `kj init` to generate your configuration file:

```bash
kj init
```

This creates `~/.karajan/kj.config.yml` with sensible defaults. You're ready to go — most users only need to set `coder` and `reviewer`.

## Config File Location

| File | Purpose |
|------|---------|
| `~/.karajan/kj.config.yml` | Main configuration |
| `<project>/.karajan/kj.config.yml` | Project-level overrides |
| `<project>/.karajan.yml` | Project pricing overrides only |

Override priority: **CLI flags > project config > global config > defaults**.

---

## Essential Configuration

The minimum config to start working:

```yaml
coder: claude
reviewer: codex
```

That's it. Everything else has defaults. Here's what you'll typically customize next:

```yaml
coder: claude
reviewer: codex
review_mode: standard        # paranoid | strict | standard | relaxed | custom
max_iterations: 5            # coder-reviewer loop limit
base_branch: main            # git branch for diffs

development:
  methodology: tdd           # tdd | standard
```

---

## Common Scenarios

### Enable Full Pipeline

Activate all pipeline stages — triage, planner, tester, security audit, and supervisor:

```yaml
pipeline:
  triage:
    enabled: true
  planner:
    enabled: true
  tester:
    enabled: true
  security:
    enabled: true
  solomon:
    enabled: true
```

Or via CLI:

```bash
kj run "my task" --enable-triage --enable-planner --enable-tester --enable-security --enable-solomon
```

### Use Different AI Agents Per Role

Assign specific providers and models to each role:

```yaml
roles:
  coder:
    provider: claude
    model: claude-opus-4-6
  reviewer:
    provider: codex
  planner:
    provider: claude
  security:
    provider: claude
  discover:
    provider: claude
  hu-reviewer:
    provider: claude
    # Auto-activated by triage for medium/complex tasks (v1.38.0+)
  audit:
    provider: claude
  impeccable:
    provider: claude
```

### Git Automation

Automate commit, push, and PR creation after the pipeline completes:

```yaml
git:
  auto_commit: true
  auto_push: true
  auto_pr: true
  auto_rebase: true
  branch_prefix: feat/
```

### BecarIA Gateway

Publish pipeline results as comments and reviews on GitHub PRs via a GitHub App bot identity:

```yaml
becaria:
  enabled: true
  review_event: becaria-review
  comment_event: becaria-comment
  comment_prefix: true
```

BecarIA automatically enables `git.auto_commit`, `git.auto_push`, and `git.auto_pr`. See [Pipeline Flows](/docs/guides/flows/) for the full architecture.

### SonarQube

SonarQube is enabled by default. To use an external server instead of the managed Docker container:

```yaml
sonarqube:
  enabled: true
  external: true
  host: https://sonar.mycompany.com
  token: null   # Use KJ_SONAR_TOKEN env var instead
```

To disable SonarQube:

```yaml
sonarqube:
  enabled: false
```

### Budget Tracking (Estimated)

Karajan adds **no extra cost** — it runs CLI agents (Claude Code, Codex, etc.) under your existing subscriptions. The budget system tracks tokens and estimates what the session *would cost* if you were using APIs directly, based on published pricing rates. This is useful for comparing approaches and setting guardrails, not for billing.

```yaml
max_budget_usd: 5.00

budget:
  warn_threshold_pct: 80
  currency: usd
```

### Planning Game Integration

Connect to [Planning Game](https://github.com/manufosela/planning-game-xp), an agile project management system (XP methodology) with MCP integration:

```yaml
planning_game:
  enabled: true
  project_id: "My Project"
  codeveloper: dev_001
```

Or via CLI:

```bash
kj run "implement KJC-TSK-0042" --pg-task KJC-TSK-0042 --pg-project "My Project"
```

### Smart Model Selection

Let Karajan automatically pick the best model tier based on task complexity:

```yaml
model_selection:
  enabled: true
  tiers:
    fast:
      model: claude-sonnet-4-6
    balanced:
      model: claude-opus-4-6
  role_overrides:
    reviewer:
      model: claude-opus-4-6
```

### Language (i18n)

Configure the language for pipeline messages and user stories:

```yaml
language: en             # Pipeline language (en | es). Auto-detected from OS locale by kj init
hu_language: en          # Language for user stories / HUs (en | es). Independent from pipeline language
```

Agents respond in the configured `language`. The `hu_language` controls the language used for generated user stories (HUs) and acceptance criteria. Both default to English and can be set independently.

### Fail-Fast on Repeated Errors

Stop the pipeline early when the same error keeps repeating:

```yaml
failFast:
  repeatThreshold: 2    # exit after 2 identical failures
```

---

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `KJ_HOME` | Override config/sessions directory (default: `~/.karajan`) |
| `KJ_SONAR_TOKEN` | SonarQube authentication token |
| `KJ_SONAR_ADMIN_USER` | SonarQube admin username |
| `KJ_SONAR_ADMIN_PASSWORD` | SonarQube admin password |
| `KJ_SONAR_PROJECT_KEY` | Override SonarQube project key |
| `VISUAL` / `EDITOR` | Editor for `kj config --edit` |

Environment variables take precedence over config file values.

---

## Custom Role Instructions

Override the built-in prompts for any role by placing Markdown files:

```
# Project-level (highest priority)
<project>/.karajan/roles/coder.md
<project>/.karajan/roles/reviewer.md

# Global
~/.karajan/roles/reviewer-paranoid.md
```

See [Configuration Reference](/docs/reference/configuration/) for the complete field reference.

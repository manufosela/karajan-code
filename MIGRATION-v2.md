# Migrating from v1.x to v2.0

Karajan Code 2.0 introduces the **Karajan Brain** architecture and removes the non-functional proxy subsystem. This guide covers all breaking changes.

## TL;DR

```bash
npm install -g karajan-code@2
```

If you never touched `config.proxy`, `config.becaria`, or the deprecated CLI flags, your existing setup probably just works. Otherwise, read on.

## Breaking Changes

### 1. Proxy subsystem removed

**What changed**: The HTTP proxy is gone. It never worked with Claude (SSE streaming) or Codex (WebSockets).

**Action**:
- Remove `proxy:` section from `.karajan/kj.config.yml`
- Remove `--proxy`, `--no-proxy`, `--proxy-port` flags from scripts
- RTK (auto-detected) provides token savings now

```yaml
# BEFORE (v1.x)
proxy:
  enabled: true
  compression:
    enabled: true

# AFTER (v2.0) — just delete the whole section
```

### 2. `becaria` renamed to `ci`

**What changed**: The CI/CD integration was called "BecarIA" but that name belongs to the Planning Game (as a developer ID). Renamed to `ci` to match Karajan's branding.

**Action**: update config + flags + GitHub secrets.

| v1.x | v2.0 |
|------|------|
| `config.becaria.enabled` | `config.ci.enabled` |
| `config.becaria.review_event: "becaria-review"` | `config.ci.review_event: "kj-review"` |
| `config.becaria.comment_event: "becaria-comment"` | `config.ci.comment_event: "kj-comment"` |
| `--enable-becaria` | `--enable-ci` |
| `--scaffold-becaria` | `--scaffold-ci` |
| `session.becaria_pr_number` | `session.ci_pr_number` |
| GitHub secret `BECARIA_APP_ID` | `KJ_CI_APP_ID` |
| GitHub secret `BECARIA_APP_PRIVATE_KEY` | `KJ_CI_PRIVATE_KEY` |
| Workflow `becaria-gateway.yml` | `kj-ci-gateway.yml` |

**If you have a deployed CI Gateway**: rename your GitHub App, update secrets, rename workflow file, update event types in your workflow.

### 3. Tester and Security are now blocking

**What changed**: Previously, Tester and Security ran after the reviewer approved and were "advisory" — their failures did not block. Now they're blocking: failures send feedback back to the coder for fixing.

**Action**: none in config. Expect longer sessions if your tests or security scans find issues — the pipeline will iterate until they pass.

### 4. Solomon cannot override security issues

**What changed**: Before, Solomon could override reviewer rejections including security issues. Now a deterministic guard ensures security-category issues always go back to the coder. Solomon is bypassed.

**Action**: none. This only makes security enforcement stricter.

### 5. `max_files_per_iteration` scope guard removed

**What changed**: The 10-file limit per iteration was removed. It triggered false positives on greenfield projects.

**Action**: if you relied on this for scope control, use the new coder rules that enforce atomic commits instead.

### 6. Dead config keys removed

Removed from `DEFAULTS`:
- `retry.*` (never read)
- `proxy.port`, `proxy.compression.ai_compression`, `proxy.compression.layers.*`, `proxy.compression.pressure_thresholds.*`, `proxy.cache.*`, `proxy.inject_prompts`, `proxy.monitor`

**Action**: if your config has any of these, remove them.

## New Features (opt-in)

### Karajan Brain architecture

v2 introduces the Karajan Brain layer. It's **opt-in** via config:

```yaml
# .karajan/kj.config.yml
brain:
  enabled: true
  provider: claude  # preferred provider for brain role
```

When enabled:
- Brain processes every role output
- Compresses outputs (40-70% token savings)
- Enriches vague feedback with file paths and action plans
- Detects 0-change coder iterations
- Executes direct actions (npm install, gitignore updates)

When disabled (default): v2 behaves like v1 with only the reliability fixes.

### Smart init

`kj run` now auto-detects installed AI CLIs and assigns them to roles by capability:
- Brain → claude (preferred) or highest-tier available
- Coder → claude or codex
- Reviewer → different agent than coder (diversity of opinion)
- Solomon → different agent than Brain

Set explicit providers in config to override.

### Session journal

Every `kj run` now writes to `.reviews/session_*/`:
- `triage.md`, `discovery.md`, `research.md`, `architecture.md`, `plan.md`
- `iterations.md`, `decisions.md`, `tree.txt`, `summary.md`

## Compatibility matrix

| v1.x feature | v2.0 status |
|--------------|-------------|
| Proxy | REMOVED |
| RTK auto-detection | KEPT |
| BecarIA | RENAMED to ci |
| SonarQube integration | KEPT |
| HU Board | KEPT |
| Planning Game integration | KEPT |
| TDD enforcement | KEPT |
| Solomon arbitration | REFINED (judge only) |
| 5 agents (Claude/Codex/Gemini/Aider/OpenCode) | KEPT |
| 40+ MCP tools | KEPT |
| 21 CLI commands | KEPT |

## Questions?

Open an issue: https://github.com/manufosela/karajan-code/issues

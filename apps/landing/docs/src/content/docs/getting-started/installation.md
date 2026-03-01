---
title: Installation
description: How to install Karajan Code.
---

## Requirements

- **Node.js** >= 18
- **Docker** — required for SonarQube static analysis. If you don't have Docker or don't need SonarQube, disable it with `--no-sonar` or set `sonarqube.enabled: false` in config
- At least one AI agent CLI installed: Claude, Codex, Gemini, or Aider

## From npm (recommended)

```bash
npm install -g karajan-code
kj init
```

`kj init` runs an interactive wizard that auto-detects installed agents and guides you through coder/reviewer selection, SonarQube configuration, and methodology choice.

## From source

```bash
git clone https://github.com/manufosela/karajan-code.git
cd karajan-code
./scripts/install.sh
```

## Non-interactive setup (CI/automation)

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

## Supported Agents

| Agent | CLI | Install |
|-------|-----|---------|
| **Claude** | `claude` | `npm install -g @anthropic-ai/claude-code` |
| **Codex** | `codex` | `npm install -g @openai/codex` |
| **Gemini** | `gemini` | See [Gemini CLI docs](https://github.com/google-gemini/gemini-cli) |
| **Aider** | `aider` | `pip install aider-chat` |

`kj init` auto-detects installed agents. If only one is available, it is assigned to all roles automatically.

## Verify Installation

```bash
kj doctor
```

This checks your environment: git, Docker, SonarQube, agent CLIs, and rule files.

## Next Steps

- [Quick Start](/docs/getting-started/quick-start/) — Run your first task

---
title: Installation
description: How to install Karajan Code.
---

## Requirements

- **Node.js** >= 18
- **Docker** — required for SonarQube static analysis. If you don't have Docker or don't need SonarQube, disable it with `--no-sonar` or set `sonarqube.enabled: false` in config
- At least one AI agent CLI installed: Claude, Codex, Gemini, Aider, or OpenCode

## Step 1: Install at least one AI agent

You need at least one agent installed before running `kj init`. Install one or more:

| Agent | CLI | Install |
|-------|-----|---------|
| **Claude** | `claude` | `npm install -g @anthropic-ai/claude-code` |
| **Codex** | `codex` | `npm install -g @openai/codex` |
| **Gemini** | `gemini` | See [Gemini CLI docs](https://github.com/google-gemini/gemini-cli) |
| **Aider** | `aider` | `pip install aider-chat` |
| **OpenCode** | `opencode` | See [opencode.ai](https://opencode.ai) |

## Step 2: Install Karajan Code

```bash
npm install -g karajan-code
```

## Step 3: Run the setup wizard

```bash
kj init
```

The wizard auto-detects your installed agents and walks you through configuration:

1. **Select default coder agent** — Which AI writes the code (e.g., Claude)
2. **Select default reviewer agent** — Which AI reviews the code (e.g., Codex)
3. **Enable triage?** — Auto-classify task complexity to activate only necessary roles (default: No)
4. **Enable SonarQube?** — Static analysis with quality gates via Docker (default: Yes)
5. **Development methodology** — TDD (test-driven, recommended) or Standard

:::tip[Single agent?]
If only one agent is installed, `kj init` automatically assigns it to both coder and reviewer roles. You can always change this later in the config.
:::

After the wizard completes, it creates:

- **`~/.karajan/kj.config.yml`** — Main configuration file (or `$KJ_HOME/kj.config.yml`)
- **`review-rules.md`** — Default review guidelines (in your project directory)
- **`coder-rules.md`** — Default coder guidelines (in your project directory)

If SonarQube is enabled, the wizard also starts a Docker container (`karajan-sonarqube`) and provides instructions to generate your SonarQube token.

## Step 4: Verify the installation

```bash
kj doctor
```

This checks your entire environment: git, Docker, SonarQube connectivity, agent CLIs, and rule files. Fix any issues it reports before running your first task.

## Alternative: Install from source

```bash
git clone https://github.com/manufosela/karajan-code.git
cd karajan-code
./scripts/install.sh
```

## Alternative: Non-interactive setup (CI/automation)

For CI pipelines or automated environments where you can't run the interactive wizard:

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

## SonarQube Token Setup

If you enabled SonarQube during `kj init`:

1. Open http://localhost:9000 in your browser
2. Log in with default credentials (`admin` / `admin`) — you'll be prompted to change the password
3. Go to **My Account → Security → Generate Tokens**
4. Create a **Global Analysis Token**
5. Add it to your config:

```yaml
# In ~/.karajan/kj.config.yml
sonarqube:
  token: "your-token-here"
```

Or set the environment variable:

```bash
export KJ_SONAR_TOKEN="your-token-here"
```

## Alternative: Docker

Run Karajan Code in a container (Alpine + Node 20) — no local Node.js installation required:

```bash
docker run --rm -it ghcr.io/manufosela/karajan-code kj doctor
```

Or use it as a base image for CI pipelines:

```dockerfile
FROM ghcr.io/manufosela/karajan-code
COPY . /workspace
WORKDIR /workspace
RUN kj init --non-interactive --coder claude --reviewer codex
```

## Alternative: Shell installer (curl | sh)

One-line installation without npm:

```bash
curl -fsSL https://raw.githubusercontent.com/manufosela/karajan-code/main/scripts/install.sh | sh
```

This downloads the latest release, installs it globally, and runs `kj init`.

## Alternative: Python wrapper (pip install)

If you prefer installing via pip:

```bash
cd wrappers/python && pip install .
```

This installs the `kj` command via a Python wrapper that delegates to the Node.js CLI.

## Alternative: Standalone binaries (SEA)

Download standalone binaries from [GitHub Releases](https://github.com/manufosela/karajan-code/releases) — no Node.js required. Available for Linux, macOS, and Windows.

## Optional: Install RTK for Token Savings

[RTK](https://github.com/rtk-ai/rtk) (Rust Token Killer) reduces token consumption by 60-90% on Bash command outputs. Install it globally and KJ benefits automatically:

```bash
brew install rtk
rtk init --global
```

See [RTK on GitHub](https://github.com/rtk-ai/rtk) for more details.

## Next Steps

- [Quick Start](/docs/getting-started/quick-start/) — Run your first task

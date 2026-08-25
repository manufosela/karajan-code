---
title: Installation
description: How to install Karajan Code.
---

:::caution[v3 docs (legacy)]
You are reading the docs for the v3 headless pipeline. Karajan v4 attaches to the AI agent you already work with — start at [Install (v4)](/docs/v4/install/).
:::

## Requirements

The `kj` binary bundles its own runtime, but it **orchestrates external tools** — it doesn't install them. After installing, run `kj doctor` to check your machine.

**Required** (kj can't run without these):

- **git** — Karajan works on git repositories
- **At least one AI agent CLI** — Claude, Codex, Gemini, Aider, or OpenCode (see Step 1)

**Optional** (each enables extra features):

- **Docker** — local models and SonarQube static analysis. Disable Sonar with `--no-sonar` or `sonarqube.enabled: false`
- **Node.js >= 22.12 / npm** — required by the npm install path (`engines.node`; with an older Node, npm silently installs an OLD karajan-code version that still supports it) and by the helper tools (Squeezr, qmd)

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

The recommended way is the **standalone binary** — a single self-contained executable. The installer downloads the binary for your platform, verifies its SHA256 checksum, and puts `kj` on your PATH.

### Linux (x64)

```bash
curl -fsSL https://karajancode.com/install.sh | sh
```

### Windows (x64, PowerShell)

```powershell
irm https://karajancode.com/install.ps1 | iex
```

### macOS (Apple Silicon)

```bash
curl -fsSL https://karajancode.com/install.sh | sh
```

### Via npm (any platform, Node.js 18+)

Install with npm on Intel macs or any platform where you'd rather run `kj` on Node:

```bash
npm install -g @karajan-family/code
```

> Published as `karajan-code` before joining the `@karajan-family` scope — the legacy name still installs the same versions. New installs should use the scoped name.

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

Run Karajan Code in a container (Alpine + Node 20) — everything ships inside the image:

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

## Alternative: Python wrapper (pip install)

If you prefer installing via pip:

```bash
cd wrappers/python && pip install .
```

This installs the `kj` command via a Python wrapper that delegates to the Node.js CLI.

## Alternative: Manual binary download (pin a version)

If you prefer to download a specific release manually instead of using the one-line installer, grab the binary for your platform from [GitHub Releases](https://github.com/manufosela/karajan-code/releases):

```bash
# Linux x64
curl -L https://github.com/manufosela/karajan-code/releases/latest/download/kj-linux-x64 -o kj && chmod +x kj

# macOS (Apple Silicon)
curl -L https://github.com/manufosela/karajan-code/releases/latest/download/kj-darwin-arm64 -o kj && chmod +x kj

# Windows (PowerShell)
curl -L https://github.com/manufosela/karajan-code/releases/latest/download/kj-win-x64.exe -o kj.exe
```

Move the binary to a directory in your PATH (e.g. `/usr/local/bin/kj`). SHA256 checksums are available alongside each binary. The macOS binary is `kj-darwin-arm64` (Apple Silicon); Intel macs install via npm.

## Alternative: Homebrew (macOS)

```bash
brew install manufosela/tap/karajan-code
```

## Optional: Install RTK for Token Savings

[RTK](https://github.com/rtk-ai/rtk) (Rust Token Killer) reduces token consumption by 60-90% on Bash command outputs. Install it globally and KJ benefits automatically:

```bash
brew install rtk
rtk init --global
```

See [RTK on GitHub](https://github.com/rtk-ai/rtk) for more details.

## Next Steps

- [Quick Start](/docs/getting-started/quick-start/) — Run your first task

/**
 * Provider CLI availability checks (preflight).
 *
 * IMPORTANT — Karajan does NOT call provider APIs directly. There is no
 * `@anthropic-ai/sdk`, no `openai`, no `@google/generative-ai` in
 * package.json. Every active role spawns its agent CLI as a subprocess
 * (`claude`, `codex`, `gemini`, `opencode`, `aider`). The CLI handles its
 * own auth, typically via OAuth + on-disk token (Claude Code, Codex CLI,
 * Gemini CLI). The user does NOT need to set ANTHROPIC_API_KEY etc. for
 * Karajan to work.
 *
 * Pre-v2.7.4 this module checked for ANTHROPIC_API_KEY / OPENAI_API_KEY /
 * GEMINI_API_KEY env vars and FAILed preflight when missing — a false
 * positive that blocked every user running Karajan as an MCP child of
 * Claude Code (where `apiKeySource: "none"` is the norm). Replaced with a
 * CLI-availability check that mirrors what the orchestrator actually does.
 *
 * GH_TOKEN is still checked when `git.auto_pr=true`, because that flow uses
 * `git push` directly with the env var.
 */

import { checkBinary } from "../utils/agent-detect.js";
import { getRequiredProviderEnvs, normalizeProvider } from "../utils/provider-env.js";
import { STRATEGY } from "./types.js";

/**
 * Map canonical provider name → the CLI binary Karajan actually spawns.
 * Keep in sync with src/agents/index.js.
 */
const PROVIDER_TO_CLI = Object.freeze({
  anthropic: "claude",
  openai: "codex",
  google: "gemini",
  opencode: "opencode",
  aider: "aider",
});

/**
 * Build a CLI-availability check for one provider.
 *
 * The check runs `<cli> --version`. If the binary is on PATH and exits 0,
 * preflight passes — Karajan can spawn it. If the CLI is missing, preflight
 * fails with the install URL we already track in PROVIDER_ENV.
 *
 * Note: we do NOT verify that the CLI is *authenticated*. Doing so would
 * require provider-specific introspection (`claude doctor`, `codex login
 * status`, ...), each with its own quirks and exit codes. If the CLI is
 * present but not logged in, the agent will fail at the first request with
 * a clear error — and the orchestrator surfaces that error already.
 */
function createProviderCliCheck(entry) {
  const cli = PROVIDER_TO_CLI[entry.provider];
  return {
    name: `cli:${entry.provider}`,
    label: `${entry.provider} CLI (${cli})`,
    strategy: STRATEGY.MANUAL,
    async detect() {
      if (!cli) {
        return {
          ok: false,
          severity: "warn",
          detail: `Unknown CLI for provider ${entry.provider}`,
          extra: { provider: entry.provider },
        };
      }
      const result = await checkBinary(cli);
      if (result.ok) {
        return {
          ok: true,
          severity: "info",
          detail: `${cli} on PATH (${result.version || "version unknown"})`,
          extra: { provider: entry.provider, cli, version: result.version, path: result.path },
        };
      }
      return {
        ok: false,
        severity: entry.optional ? "warn" : "fail",
        detail: `${cli} not found on PATH`,
        fix: `Install the ${cli} CLI: see ${entry.howToGetUrl}`,
        extra: { provider: entry.provider, cli, howToGetUrl: entry.howToGetUrl },
      };
    },
  };
}

/**
 * GH token check + auto-remediation via `gh auth login` when it's installed.
 * Kept from the previous version: this one IS legitimate because Karajan
 * uses `gh` (or raw `git push`) directly when auto_pr is on.
 */
function createGhTokenCheck() {
  return {
    name: "token:gh",
    label: "GitHub token (for auto_pr)",
    strategy: STRATEGY.PROMPT,
    applies: (config) => config?.git?.auto_pr === true,
    describe: "Run 'gh auth login' to authenticate with GitHub",
    async detect() {
      const envOk = !!process.env.GH_TOKEN || !!process.env.GITHUB_TOKEN;
      if (envOk) {
        return { ok: true, severity: "info", detail: "GH_TOKEN or GITHUB_TOKEN is set" };
      }
      // If `gh` is installed and authenticated, it manages its own token.
      const gh = await checkBinary("gh");
      if (!gh.ok) {
        return {
          ok: false,
          severity: "fail",
          detail: "No GH_TOKEN/GITHUB_TOKEN and `gh` CLI not installed",
          fix: "Install GitHub CLI (https://cli.github.com) or export GH_TOKEN=...",
          extra: { hasGh: false },
        };
      }
      return {
        ok: false,
        severity: "fail",
        detail: "No GH_TOKEN/GITHUB_TOKEN; `gh` is installed but auth status unknown",
        fix: "Run 'gh auth login' or export GH_TOKEN=...",
        extra: { hasGh: true },
      };
    },
    // remediate() intentionally omitted: launching `gh auth login` requires an
    // interactive terminal session. The runner's prompt strategy will point
    // the user to the command and exit with FAIL in non-TTY contexts.
  };
}

/**
 * Build the list of CLI/token checks for the active config.
 * - One CLI availability check per active provider (claude / codex / gemini / ...).
 * - One GH token check, conditional on git.auto_pr.
 *
 * Function name kept as `getTokenChecks` for backward compat with
 * preflight-checks.js, even though the bulk of the checks no longer touch
 * tokens at all. Tracked: rename to `getProviderChecks` in a follow-up
 * once consumers are updated.
 *
 * @param {Object} config
 * @returns {import("./types.js").Check[]}
 */
export function getTokenChecks(config) {
  const required = getRequiredProviderEnvs(config);
  const checks = required.map(createProviderCliCheck);
  checks.push(createGhTokenCheck());
  return checks;
}

// Re-export for tests that need to introspect the mapping.
export { normalizeProvider };

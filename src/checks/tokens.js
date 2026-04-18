/**
 * API token availability checks.
 *
 * Provider tokens (ANTHROPIC_API_KEY / OPENAI_API_KEY / ...) are LAZY:
 * we only check them for providers that are actually used by at least one
 * active role in the current config.
 *
 * Strategy:
 *   - Required providers with no key → FAIL, strategy manual (we can't
 *     fetch an API key for the user). Fix hint includes the how-to URL.
 *   - Optional providers (opencode, aider) without key → WARN.
 *   - GH_TOKEN is checked when git.auto_pr=true, strategy prompt (we can
 *     launch `gh auth login` with user approval).
 */

import { checkBinary } from "../utils/agent-detect.js";
import { getRequiredProviderEnvs, hasEnvVar } from "../utils/provider-env.js";
import { STRATEGY } from "./types.js";

/**
 * A single provider env check. One is created per active provider.
 */
function createProviderTokenCheck(entry) {
  return {
    name: `token:${entry.provider}`,
    label: `API token: ${entry.provider}`,
    strategy: STRATEGY.MANUAL,
    async detect() {
      const ok = hasEnvVar(entry);
      if (ok) {
        return { ok: true, severity: "info", detail: `${entry.envVars[0]} is set` };
      }
      return {
        ok: false,
        severity: entry.optional ? "warn" : "fail",
        detail: `${entry.envVars.join(" / ")} not set`,
        fix: `Get an API key at ${entry.howToGetUrl} and export ${entry.envVars[0]}=...`,
        extra: { provider: entry.provider, envVars: entry.envVars, howToGetUrl: entry.howToGetUrl },
      };
    },
  };
}

/**
 * GH token check + auto-remediation via `gh auth login` when it's installed.
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
 * Build the list of token checks for the active config. Each active provider
 * gets one, plus conditional GH token when auto_pr is on.
 *
 * @param {Object} config
 * @returns {import("./types.js").Check[]}
 */
export function getTokenChecks(config) {
  const required = getRequiredProviderEnvs(config);
  const checks = required.map(createProviderTokenCheck);
  checks.push(createGhTokenCheck());
  return checks;
}

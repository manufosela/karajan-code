/**
 * Binary / CLI availability checks.
 *
 * Covers:
 *   - Agent CLIs (claude, codex, gemini, aider, opencode)
 *   - Core binaries (node, npm, git)
 *   - Docker
 *   - Serena MCP (optional)
 *
 * All binary checks use `strategy: "manual"` because auto-installing binaries
 * is invasive and platform-specific. Exception: Serena is `"prompt"` (we know
 * the install command and can offer to run it).
 */

import { checkBinary, KNOWN_AGENTS, detectObservedAgents } from "../utils/agent-detect.js";
import { runCommand } from "../utils/process.js";
import { withDocLink } from "../utils/doc-links.js";
import { getInstallHint, appliesToStack } from "../utils/install-hints.js";
import { STRATEGY } from "./types.js";

/**
 * Check the presence of a named agent CLI (claude/codex/gemini/aider).
 */
function createAgentCheck(agent) {
  return {
    name: `agent:${agent.name}`,
    label: `Agent: ${agent.name}`,
    strategy: STRATEGY.MANUAL,
    async detect() {
      const result = await checkBinary(agent.name);
      return {
        ok: result.ok,
        severity: "warn", // missing one agent CLI shouldn't block — user may not use it
        detail: result.ok ? `${result.version} (${result.path})` : "Not found",
        fix: result.ok ? undefined : withDocLink(`Install: ${agent.install}`, "agent_not_found"),
      };
    },
  };
}

/**
 * KJC-TSK-0728 — ONE aggregate line for the observation census (agent CLIs
 * kj sees but does not drive). Only FOUND CLIs are listed; the missing ones
 * make no noise, and the check never fails. `detector` is injectable for
 * tests.
 */
export function createObservedAgentsCheck({ detector = detectObservedAgents } = {}) {
  return {
    name: "agents:observed",
    label: "Agent CLIs observed (not driven)",
    strategy: STRATEGY.MANUAL,
    async detect() {
      let found = [];
      try {
        found = (await detector()).filter((a) => a.available);
      } catch { /* census is best-effort */ }
      return {
        ok: true,
        severity: "info",
        detail: found.length
          ? found.map((a) => `${a.name} (${(a.version || "").split(" ").at(-1) || "?"})`).join(", ")
          : "none detected",
      };
    },
  };
}

/**
 * Check the presence of a core binary (node, npm, git).
 */
function createCoreBinaryCheck(bin) {
  return {
    name: bin,
    label: bin,
    strategy: STRATEGY.MANUAL,
    async detect() {
      const result = await checkBinary(bin);
      return {
        ok: result.ok,
        severity: "fail",
        detail: result.ok ? result.version : "Not found",
        fix: result.ok ? undefined : `Install ${bin} from its official website.`,
      };
    },
  };
}

/**
 * Docker check. Manual strategy (platform-dependent install).
 */
function createDockerCheck() {
  return {
    name: "docker",
    label: "Docker",
    strategy: STRATEGY.MANUAL,
    async detect() {
      const docker = await checkBinary("docker", "--version");
      return {
        ok: docker.ok,
        severity: "warn", // only required if Sonar enabled; soft-fail here
        detail: docker.ok ? docker.version : "Not found",
        fix: docker.ok ? undefined : withDocLink("Install Docker: https://docs.docker.com/get-docker/", "sonar_docker"),
      };
    },
  };
}

/**
 * Serena MCP (optional). Prompt strategy: we know how to install it.
 */
function createSerenaCheck() {
  return {
    name: "serena",
    label: "Serena MCP",
    strategy: STRATEGY.MANUAL,
    applies: (config) => config.serena?.enabled === true,
    describe: "Install Serena via: uvx --from git+https://github.com/oraios/serena serena",
    async detect() {
      let ok;
      try {
        const res = await runCommand("serena", ["--version"]);
        ok = res.exitCode === 0;
      } catch {
        ok = false;
      }
      return {
        ok,
        severity: "warn",
        detail: ok ? "Available" : "Not found (prompts will still include Serena instructions)",
        fix: ok ? undefined : "Install Serena: uvx --from git+https://github.com/oraios/serena serena --help",
      };
    },
  };
}

/**
 * Audit-side external tool (semgrep, osv-scanner, lighthouse) check.
 *
 * These are not blockers: `kj audit` and `kj webperf` degrade to
 * available:false when missing. We surface them in `kj doctor` so the
 * user can see at a glance which audit dimensions are active, and we
 * point to `kj install-tools` for one-line remediation.
 *
 * `lighthouse` is stack-gated: only flagged when the project is
 * frontend / fullstack. On backend-only projects the check is a no-op
 * (returns ok:true with detail "n/a") to keep doctor output focused.
 */
function createAuditToolCheck(tool, { gatedByStack = false, label }) {
  return {
    name: `audit-tool:${tool}`,
    label,
    strategy: STRATEGY.MANUAL,
    async detect({ config } = {}) {
      if (gatedByStack) {
        // Stack detection is best-effort — failing here just means we
        // treat the project as backend-only (skip the check). Keeps the
        // doctor pipeline resilient to weird repos.
        let stack = null;
        try {
          const { detectProjectStack } = await import("../utils/stack-detect.js");
          stack = await detectProjectStack(config?.projectDir || process.cwd());
        } catch { /* ignore */ }
        if (!appliesToStack(tool, stack)) {
          return { ok: true, severity: "info", detail: "n/a (no frontend stack detected)" };
        }
      }
      const result = await checkBinary(tool);
      if (result.ok) {
        return { ok: true, severity: "info", detail: result.version || "available" };
      }
      const hint = await getInstallHint(tool);
      const fixLine = hint.command
        ? `Run \`kj install-tools --only ${tool}\` or: ${hint.command}`
        : `Run \`kj install-tools --only ${tool}\` or see ${hint.manualUrl}`;
      return {
        ok: false,
        severity: "warn",
        detail: "Not found — `kj audit` dimension will degrade",
        fix: fixLine,
        extra: { tool, suggested: hint.command, manager: hint.manager, manualUrl: hint.manualUrl },
      };
    },
  };
}

/**
 * Aggregate: all binary-related checks for the current config.
 * @returns {import("./types.js").Check[]}
 */
export function getBinaryChecks() {
  const checks = [];
  for (const agent of KNOWN_AGENTS) {
    checks.push(createAgentCheck(agent));
  }
  checks.push(createObservedAgentsCheck());
  for (const bin of ["node", "npm", "git"]) {
    checks.push(createCoreBinaryCheck(bin));
  }
  checks.push(createDockerCheck());
  checks.push(createSerenaCheck());
  // KJC-TSK v2.18 — surface audit-side tools in doctor so the user knows
  // which dimensions will work. lighthouse is gated to frontend stacks.
  checks.push(createAuditToolCheck("semgrep", { label: "Semgrep (audit/security)" }));
  checks.push(createAuditToolCheck("osv-scanner", { label: "OSV-Scanner (audit/security)" }));
  checks.push(createAuditToolCheck("lighthouse", { label: "Lighthouse (webperf)", gatedByStack: true }));
  return checks;
}

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

import { checkBinary, KNOWN_AGENTS } from "../utils/agent-detect.js";
import { runCommand } from "../utils/process.js";
import { withDocLink } from "../utils/doc-links.js";
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
 * Aggregate: all binary-related checks for the current config.
 * @returns {import("./types.js").Check[]}
 */
export function getBinaryChecks() {
  const checks = [];
  for (const agent of KNOWN_AGENTS) {
    checks.push(createAgentCheck(agent));
  }
  for (const bin of ["node", "npm", "git"]) {
    checks.push(createCoreBinaryCheck(bin));
  }
  checks.push(createDockerCheck());
  checks.push(createSerenaCheck());
  return checks;
}

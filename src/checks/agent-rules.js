/**
 * KJC-TSK-1504: AGENTS.md is the one file of agent rules kj writes. The doctor
 * says when an agent in this project or on this machine would not read it: an
 * old CLAUDE.md or GEMINI.md still here (Claude Code and Gemini CLI read those
 * instead), a Claude Code older than the release that reads AGENTS.md, or a
 * Gemini CLI whose settings do not name it.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

import { LEGACY_AGENT_FILES } from "../environment/agents-md.js";
import { GEMINI_SETTINGS, geminiReadsAgentsFile } from "../harden/gemini-context.js";
import { runCommand } from "../utils/process.js";
import { detectRulesync } from "../utils/rulesync.js";
import { isNewerVersion } from "../utils/update-check.js";
import { STRATEGY } from "./types.js";

/** The first Claude Code release that loads AGENTS.md when the project has no CLAUDE.md. */
export const CLAUDE_READS_AGENTS_MD = "2.1.277";
const VERSION_RE = /\d+\.\d+\.\d+/;
const TIMEOUT_MS = 10_000;

/** The installed version of `bin`, or null when it is not installed or does not answer. */
async function versionOf(bin, run) {
  try {
    const res = await run(bin, ["--version"], { timeout: TIMEOUT_MS });
    return res.exitCode === 0 ? (VERSION_RE.exec(res.stdout)?.[0] ?? null) : null;
  } catch {
    return null;
  }
}

async function problemsIn(projectDir, run) {
  const problems = [];
  const left = LEGACY_AGENT_FILES.filter((f) => existsSync(join(projectDir, f)));
  if (left.length > 0) problems.push({ detail: `${left.join(" and ")} still here, read instead of AGENTS.md`, fix: "kj harden moves what was written by hand into AGENTS.md" });
  const claude = await versionOf("claude", run);
  if (claude && isNewerVersion(CLAUDE_READS_AGENTS_MD, claude)) {
    problems.push({ detail: `Claude Code ${claude} does not read AGENTS.md (it needs ${CLAUDE_READS_AGENTS_MD} or later)`, fix: "claude update" });
  }
  if ((await versionOf("gemini", run)) && !geminiReadsAgentsFile(projectDir)) {
    problems.push({ detail: `Gemini CLI reads GEMINI.md: ${GEMINI_SETTINGS} does not name AGENTS.md`, fix: "kj harden adds it" });
  }
  return problems;
}

export function getAgentRulesChecks({ projectDir = process.cwd(), run = runCommand, rulesync = detectRulesync(projectDir) } = {}) {
  return [{
    name: "agent-rules",
    label: "Agent rules (AGENTS.md)",
    strategy: STRATEGY.MANUAL,
    detectTimeoutMs: 2 * TIMEOUT_MS + 5_000,
    async detect() {
      if (rulesync) return { ok: true, severity: "info", detail: "Rulesync writes the agent files of this project" };
      const problems = await problemsIn(projectDir, run);
      if (problems.length === 0) return { ok: true, severity: "info", detail: "every agent here reads AGENTS.md" };
      return { ok: false, severity: "warn", detail: problems.map((p) => p.detail).join("; "), fix: problems.map((p) => p.fix).join("; ") };
    },
  }];
}

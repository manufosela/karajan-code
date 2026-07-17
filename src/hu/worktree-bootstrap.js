/**
 * PAR-G (KJC-TSK-0630): make a freshly created lane worktree operative.
 *
 * `git worktree add` produces a clean checkout: no node_modules, no
 * initialized submodules — and a container/bind-mounted process cannot
 * init them itself because the worktree's real .git lives in the parent
 * repo (gotcha reported by Jorge del Casar's worktree-docker-envs skill).
 * Without this step, --parallel lanes die on the first `npm test` in any
 * real project.
 *
 * Best-effort by contract: a failed or slow bootstrap warns and the lane
 * continues — the acceptance tests deliver the real verdict.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { runCommand } from "../utils/process.js";

const STEP_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * @param {object} params
 * @param {string} params.worktreePath  Absolute path of the lane worktree.
 * @param {string|null} [params.setupCommand]  session.worktree_setup — wins over auto-detect.
 * @param {object|null} [params.logger]
 * @param {number} [params.timeoutMs]
 * @param {Function} [params.run]  Injectable runner (tests).
 * @returns {Promise<{ok: boolean, steps: string[], warnings: string[]}>}
 */
export async function bootstrapWorktree({ worktreePath, setupCommand = null, logger = null, timeoutMs = STEP_TIMEOUT_MS, run = runCommand }) {
  const warnings = [];
  const steps = [];

  if (existsSync(join(worktreePath, ".gitmodules"))) {
    steps.push({ name: "submodules", cmd: "git", args: ["submodule", "update", "--init", "--recursive"] });
  }

  const explicit = typeof setupCommand === "string" && setupCommand.trim() ? setupCommand.trim() : null;
  if (explicit) {
    steps.push({ name: "setup", cmd: "sh", args: ["-c", explicit] });
  } else if (existsSync(join(worktreePath, "package-lock.json"))) {
    steps.push({ name: "deps", cmd: "npm", args: ["ci", "--no-audit", "--no-fund"] });
  }

  for (const step of steps) {
    try {
      const res = await run(step.cmd, step.args, { cwd: worktreePath, timeout: timeoutMs });
      if (res.exitCode !== 0) {
        warnings.push(`${step.name} failed (exit ${res.exitCode}): ${String(res.stderr || res.stdout || "").slice(0, 200)}`);
      } else {
        logger?.info?.(`worktree bootstrap: ${step.name} ok`);
      }
    } catch (err) {
      warnings.push(`${step.name} threw: ${err.message}`);
    }
  }

  for (const w of warnings) logger?.warn?.(`worktree bootstrap: ${w} — lane continues`);
  return { ok: warnings.length === 0, steps: steps.map((s) => s.name), warnings };
}

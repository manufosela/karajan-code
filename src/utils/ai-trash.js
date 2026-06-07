// ai-trash detection + Claude Code hook install (KJC-TSK-0391).
// `kj-trash` is the binary shipped by the @karajan/ai-trash workspace.
// detectAiTrash() probes the binary; installAiTrashHook() invokes
// `kj-trash install --claude-code`, which idempotently patches
// ~/.claude/settings.json to register the PreToolUse hook.

import { runCommand } from "./process.js";

/**
 * @returns {Promise<{ available: boolean, version: string|null }>}
 */
export async function detectAiTrash() {
  try {
    const res = await runCommand("kj-trash", ["--help"]);
    if (res.exitCode === 0 || res.exitCode === 2) {
      return { available: true, version: "0.0.0" };
    }
    return { available: false, version: null };
  } catch {
    return { available: false, version: null };
  }
}

/**
 * Register the kj-trash PreToolUse hook in ~/.claude/settings.json.
 * Idempotent: second run reports "already installed" without rewriting.
 *
 * @param {object} logger - logger with info/warn methods
 * @returns {Promise<{ ok: boolean, mutated: boolean, error: string|null }>}
 */
export async function installAiTrashHook(logger) {
  logger.info("Registering ai-trash Claude Code hook...");
  try {
    const res = await runCommand("kj-trash", ["install", "--claude-code"], { timeout: 30_000 });
    if (res.exitCode !== 0) {
      const error = (res.stderr || "").trim() || `exit code ${res.exitCode}`;
      logger.warn(`ai-trash hook install failed: ${error}`);
      return { ok: false, mutated: false, error };
    }
    const mutated = !(res.stdout || "").includes("already installed");
    logger.info(mutated ? "ai-trash hook installed." : "ai-trash hook already installed.");
    return { ok: true, mutated, error: null };
  } catch (err) {
    const error = err.message || String(err);
    logger.warn(`ai-trash hook install failed: ${error}`);
    return { ok: false, mutated: false, error };
  }
}

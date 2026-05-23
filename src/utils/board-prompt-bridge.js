/**
 * File-based RPC between a non-interactive Karajan run and the HU
 * Board. When the runner needs an answer to a question (Solomon
 * escalation, max-iterations resolution, anything wired to
 * askQuestion) and stdin is unavailable (the board's ▶ Run plan
 * spawns with stdio=ignore), it writes a prompt JSON to a known
 * directory and polls for an "answer" sibling file. The board's
 * chokidar watcher sees the prompt and surfaces it as a modal; the
 * user's answer is POSTed back, written as the answer file, and the
 * runner picks it up and resolves.
 *
 * Why files instead of a socket / SSE-back-channel:
 *   - Zero new server in the runner. A detached child has no listening
 *     port; opening one would mean discovery + auth + cleanup.
 *   - Survives a runner restart: if the user kills + resumes, the
 *     pending prompt is still on disk and the board can re-show it.
 *   - The board already watches `~/.karajan/`; one more glob is cheap.
 *
 * Layout:
 *   $KJ_HOME/prompts/<promptId>.json         - { sessionId, question, context, createdAt }
 *   $KJ_HOME/prompts/<promptId>.answer.json  - { answer, answeredAt }    (written by board)
 *
 * The bridge owns the lifecycle: write the prompt, poll until the
 * answer arrives, delete BOTH files, return the answer string (or
 * null when the user picked "stop"). Aborts cleanly on signal or on
 * a configurable timeout (default 30 min — long enough for a coffee).
 */

import { mkdir, writeFile, readFile, unlink, stat } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const POLL_INTERVAL_MS = 500;
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;          // 30 min

// Delegated to src/utils/paths.js so KARAJAN_HOME, KJ_HOME (with
// deprecation warning), VITEST tmp and the default all share one
// precedence chain — KJC-TSK-0420.
import { getPromptsDir } from "./paths.js";

function exists(path) {
  return stat(path).then(() => true, () => false);
}

/**
 * Publish a prompt + wait for the answer. Returns the answer string,
 * `null` when the user explicitly picked "stop", or rejects on
 * timeout / abort.
 *
 * @param {object} args
 * @param {string} args.sessionId
 * @param {string} args.question
 * @param {object} [args.context]   - serialised verbatim into the prompt JSON
 * @param {number} [args.timeoutMs]
 * @param {AbortSignal} [args.signal]
 * @param {object} [args.logger]    - { info, warn } — optional, for breadcrumbs
 * @returns {Promise<string|null>}
 */
export async function askThroughBoard({ sessionId, question, context = null, timeoutMs = DEFAULT_TIMEOUT_MS, signal = null, logger = null } = {}) {
  if (!question) throw new Error("askThroughBoard: question is required");

  const dir = getPromptsDir();
  await mkdir(dir, { recursive: true });

  const promptId = `prompt-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const promptPath = join(dir, `${promptId}.json`);
  const answerPath = join(dir, `${promptId}.answer.json`);

  const payload = {
    promptId,
    sessionId: sessionId || null,
    question,
    context: context || null,
    createdAt: new Date().toISOString(),
  };
  await writeFile(promptPath, JSON.stringify(payload, null, 2), "utf-8");
  logger?.info?.(`[prompt-bridge] published ${promptId} — waiting for answer via the board`);

  const startedAt = Date.now();
  try {
    while (true) {
      if (signal?.aborted) throw new Error("askThroughBoard: aborted");
      if (Date.now() - startedAt > timeoutMs) {
        throw new Error(`askThroughBoard: timed out after ${Math.round(timeoutMs / 1000)}s waiting for answer to ${promptId}`);
      }
      if (await exists(answerPath)) {
        const raw = await readFile(answerPath, "utf-8");
        let answer;
        try { ({ answer } = JSON.parse(raw)); } catch { answer = null; }
        await unlink(answerPath).catch(() => {});
        await unlink(promptPath).catch(() => {});
        if (typeof answer === "string" && answer.trim().toLowerCase() === "stop") return null;
        return typeof answer === "string" ? answer.trim() : null;
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
  } catch (err) {
    // Best-effort cleanup of the prompt file on error so it doesn't
    // get stuck pending on the board forever.
    await unlink(promptPath).catch(() => {});
    throw err;
  }
}

/** Test seam — exposes the resolved prompts dir for assertions. */
export function _getPromptsDirForTests() {
  return getPromptsDir();
}

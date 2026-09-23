/**
 * BOOT-C (KJC-TSK-0862) — the project's start script.
 *
 * From the Anthropic write-up on harnesses for long-running agents, and from
 * the cold-start map: a session burns tokens working out how the project is
 * launched, and worse, starts building on a tree that was already broken
 * without knowing it. kj verifies the method; nobody verified that the
 * application runs.
 *
 * kj declares the CONTRACT and checks it. The project writes the script,
 * because kj cannot know how a project it has never seen is launched, and
 * generating one from stack detection would produce the decorative artefact
 * this codebase already rejects elsewhere (a config without its tool).
 *
 * It reports, it does not block: a badly written script must not stop work
 * over something unrelated to the card. It earns the right to block when it
 * proves reliable, the same path Sonar and the RAG took.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

export const DEFAULT_START_SCRIPT = ".karajan/start.sh";
export const DEFAULT_TIMEOUT_MS = 120_000;
export const MAX_OUTPUT_BYTES = 64 * 1024;

export const START_SCRIPT_CONTRACT = [
  "El guion de arranque levanta lo que haya que levantar y corre un humo de referencia.",
  "Sale con 0 si el proyecto arranca y el humo pasa; con otro código si no.",
  "No modifica el árbol ni depende de credenciales: solo responde si esto funciona ahora mismo.",
].join(" ");

/** Where the start script lives: the project's config decides, with a default. */
export function startScriptPath(projectDir, config = {}) {
  return join(projectDir, config.start_script || DEFAULT_START_SCRIPT);
}

/**
 * @returns {Promise<{status: "absent"|"ok"|"broken"|"timeout", exitCode?: number, output?: string, contract?: string, path: string}>}
 */
export function runStartScript({ projectDir, config = {}, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const script = startScriptPath(projectDir, config);
  if (!existsSync(script)) {
    return Promise.resolve({ status: "absent", path: script, contract: START_SCRIPT_CONTRACT });
  }
  return new Promise((resolve) => {
    const ownGroup = process.platform !== "win32";
    const child = spawn("sh", [script], { cwd: projectDir, detached: ownGroup });
    let output = "";
    let truncated = false;
    let timedOut = false;
    // Bounded on purpose (catch de codex): a verbose or runaway script would
    // otherwise eat the CLI's memory for the whole timeout. The LAST bytes are
    // the ones worth keeping — that is where a failure explains itself.
    const collect = (buf) => {
      output += String(buf);
      if (output.length > MAX_OUTPUT_BYTES) {
        output = output.slice(-MAX_OUTPUT_BYTES);
        truncated = true;
      }
    };
    child.stdout?.on("data", collect);
    child.stderr?.on("data", collect);
    // Kill the GROUP, not just the shell (catch de codex): this script's whole
    // job is to START things, so the dev server it launched would keep its port
    // long after we reported a timeout.
    const killTree = () => {
      try {
        if (ownGroup && child.pid) process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch { /* ya no está */ }
    };
    // A script that hangs is not a verdict: it is a script that hangs.
    const timer = setTimeout(() => { timedOut = true; killTree(); }, timeoutMs);
    child.on("error", (err) => { clearTimeout(timer); resolve({ status: "broken", path: script, exitCode: null, output: `${output}${err.message}`, truncated }); });
    // Resolve on CLOSE, never before: the answer comes once the tree is down.
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) resolve({ status: "timeout", path: script, output, truncated });
      else resolve({ status: code === 0 ? "ok" : "broken", exitCode: code, path: script, output, truncated });
    });
  });
}

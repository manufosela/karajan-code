/**
 * PR-F: ask the user "Run on $(pwd)?" before launching `kj run` from
 * a terminal. Same defensive UX as `git push --force-with-lease`
 * surfacing the branch — the user wants to know what they're aiming
 * at before the rocket fires.
 *
 * The prompt is plain readline (no extra deps) and accepts any of:
 *   y, yes, s, sí, ENTER  → true
 *   n, no, ENTER+Esc      → false
 *
 * Skipped automatically by the caller when stdin/stdout are not a
 * TTY, when --yes is set, or when --json is set. So this module is
 * never called in CI / non-interactive contexts.
 */

import readline from "node:readline";

/**
 * @param {string} projectDir absolute path of the cwd / projectDir
 * @returns {Promise<boolean>} true to continue, false to abort
 */
export async function confirmCwd(projectDir) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  // No emoji — keep terminal-safe even on basic Windows shells.
  const question = `Karajan va a ejecutarse sobre:\n  ${projectDir}\n\n¿Continuar? [Y/n] `;
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      const trimmed = String(answer || "").trim().toLowerCase();
      // Empty answer = ENTER = accept the default = yes.
      if (trimmed === "" || trimmed === "y" || trimmed === "yes" || trimmed === "s" || trimmed === "si" || trimmed === "sí") {
        resolve(true);
      } else {
        resolve(false);
      }
    });
    rl.on("SIGINT", () => { rl.close(); resolve(false); });
  });
}

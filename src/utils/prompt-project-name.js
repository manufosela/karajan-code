/**
 * PR-H: ask the user "Nombre del proyecto?" before saving a plan.
 *
 * The user's words: "El nombre del board debería de deducirse del
 * cwd o del nombre del plan, pero no darlo por hecho, preguntar al
 * usuario siempre, por si quiere cambiarlo."
 *
 * Pre-fills the prompt with the suggested name (derived from the
 * task / cwd) so accepting the default is one ENTER away. Returns
 * the trimmed answer; falls back to the default when the user just
 * hits ENTER (empty input).
 *
 * Caller is responsible for skipping this when stdin/stdout are not
 * a TTY, when --yes is set, or when --json is set.
 */

import readline from "node:readline";

/**
 * @param {string} defaultName — pre-filled suggestion shown in [brackets]
 * @returns {Promise<string>} the user's answer (defaults to defaultName)
 */
export async function promptProjectName(defaultName) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const fallback = String(defaultName || "").trim();
  const hint = fallback ? ` [${fallback}]` : "";
  return new Promise((resolve) => {
    rl.question(`Nombre del proyecto${hint}: `, (answer) => {
      rl.close();
      const trimmed = String(answer || "").trim();
      resolve(trimmed || fallback);
    });
    rl.on("SIGINT", () => { rl.close(); resolve(fallback); });
  });
}

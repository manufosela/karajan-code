/**
 * `atril init` (ADR 0021, decision 13; plan step 12c): the answers for the recommended set's
 * available entries, decided by the flags or asked one by one. It decides nothing else:
 * applyRecommended applies them. An installed or changed entry is never offered again.
 */
import { keyOf } from "./scan.js";

const RECOMMENDED = new Map([["on-demand", "on-demand"], ["persistent", "persistent"], ["none", "skip"]]);
const REPLIES = new Map([["", "on-demand"], ["o", "on-demand"], ["p", "persistent"], ["s", "skip"]]);

export const offered = (entries) => entries.filter(({ state }) => state === "available");

/**
 * `--recommended` wins over `--yes` (it is more specific); neither returns null: init asks.
 * @param {ReturnType<typeof import("./recommended.js").recommended>} entries
 * @param {{ yes?: boolean, recommended?: string }} flags
 * @returns {Record<string, string> | null}
 */
export function answersFor(entries, { yes, recommended } = {}) {
  if (recommended === undefined && !yes) return null;
  const answer = RECOMMENDED.get(recommended ?? "on-demand");
  if (!answer) throw new Error(`--recommended must be one of ${[...RECOMMENDED.keys()].join(", ")}, not ${JSON.stringify(recommended)}`);
  return Object.fromEntries(offered(entries).map((entry) => [keyOf(entry), answer]));
}

/**
 * @param {ReturnType<typeof import("./recommended.js").recommended>} entries
 * @param {(question: string) => Promise<string>} ask asks again until the reply is one it knows
 */
export async function askAnswers(entries, ask) {
  const answers = {};
  for (const entry of offered(entries)) {
    const key = keyOf(entry);
    const question = `${key} — ${entry.description} [o]n demand (default) / [p]ersistent / [s]kip?`;
    while (!answers[key]) answers[key] = REPLIES.get((await ask(question)).trim().toLowerCase());
  }
  return answers;
}

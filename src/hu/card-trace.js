// KJC-TSK-1457 (ADR 0050, point 5): kj hu add and kj hu move leave one line in
// .karajan/harness/cards.jsonl of the lane where they run, whatever board holds
// the cards, so kj stage draws each factory's task board from real events only.
// Only the card's id, a short title and where it went: never its criteria.
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export const CARDS_FILE = ".karajan/harness/cards.jsonl";
const TITLE_MAX = 80;

/**
 * Appends `{ at, action, id, title?, status, queued? }` to the lane's card trace; losing it never stops
 * the card, and `warn` (the command's console) says it was lost.
 */
export function traceCard(projectDir, { action, id, title, status, queued }, warn) {
  // A move queued without network is said as such: the card is not there yet (KJC-TSK-1457).
  const line = { at: new Date().toISOString(), action, id, ...(title ? { title: String(title).slice(0, TITLE_MAX) } : {}), status, ...(queued ? { queued: true } : {}) };
  try {
    mkdirSync(join(projectDir, ".karajan", "harness"), { recursive: true });
    appendFileSync(join(projectDir, CARDS_FILE), `${JSON.stringify(line)}\n`);
  } catch (err) {
    // The trace is for the stage only: the card is already where it should be.
    warn(`⚠ card trace not written in ${projectDir} (kj stage will not show ${id} until its next move): ${err.message}`);
  }
}

// KJC-TSK-1457 (ADR 0050, point 5): kj hu add and kj hu move leave one line in
// .karajan/traces/cards.jsonl (KJC-BUG-0527: writable under the sandbox) of the lane where they run, whatever board holds
// the cards, so kj stage draws each factory's task board from real events only.
// Only the card's id, a short title and where it went: never its criteria.
import { appendFileSync, mkdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { mainCheckout } from "../utils/main-checkout.js";

export const CARDS_FILE = ".karajan/traces/cards.jsonl";
const TITLE_MAX = 80;

/**
 * Appends `{ at, action, id, title?, status, queued? }` to the lane's card trace; losing it never stops
 * the card, and `warn` (the command's console) says it was lost.
 */
export function traceCard(projectDir, { action, id, title, status, queued }, warn) {
  // A move queued without network is said as such: the card is not there yet (KJC-TSK-1457).
  const line = { at: new Date().toISOString(), action, id, ...(title ? { title: String(title).slice(0, TITLE_MAX) } : {}), status, ...(queued ? { queued: true } : {}) };
  try {
    // KJC-BUG-0546: a lane is swept after its merge, its trace with it. The line goes to the
    // main checkout, naming the lane, so a card closed in a lane is not left running.
    const main = mainCheckout(projectDir);
    if (resolve(main) !== resolve(projectDir)) line.lane = basename(projectDir);
    mkdirSync(join(main, ".karajan", "traces"), { recursive: true });
    appendFileSync(join(main, CARDS_FILE), `${JSON.stringify(line)}\n`);
  } catch (err) {
    // The trace is for the stage only: the card is already where it should be.
    warn(`⚠ card trace not written in ${projectDir} (kj stage will not show ${id} until its next move): ${err.message}`);
  }
}

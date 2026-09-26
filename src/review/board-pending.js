/**
 * Which pending board moves actually block (KJC-BUG-0198).
 *
 * board-sync records one pending move per merged PR and blocks every advance
 * until the card reaches a closing state, which assumes one PR per card. The
 * project's rule says the opposite: a card that does not fit in ~150 lines is
 * SPLIT. With KJC-BUG-0197 (#1802 and #1803), merging the first demanded a move
 * that would have been a lie, and the only way out was `KJ_ALLOW_BOARD=1`, which
 * switches the whole gate off. A card still being delivered is not a lying
 * board; a TURN ending with work nobody recorded is, and that stays the Stop
 * gate's job.
 *
 * One verifiable fact carries a pending, never a promise in prose: the same card
 * has another OPEN pull request. A branch named after the card is not enough,
 * because the merged branch carries that name too, so accepting it would forgive
 * every merge made from its own lane.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { CARD_REF_RE } from "./card-first.js";

const cardOf = (text) => {
  const m = CARD_REF_RE.exec(String(text || ""));
  return m ? m[0].toUpperCase() : null;
};

/**
 * `openPrHeads` null means the list could not be read, and then nothing is
 * forgiven. `openPrNumbers` pairs with it so a pending never forgives itself.
 *
 * @returns {{blocking: Array<object>, carried: Array<{card: string, why: string}>, reason?: string}}
 */
export function blockingMoves({ pendings = [], openPrHeads = null, openPrNumbers = [] }) {
  if (pendings.length === 0) return { blocking: [], carried: [] };
  if (openPrHeads === null) {
    return { blocking: [...pendings], carried: [], reason: "no se pudo comprobar si la card sigue viva en otra PR abierta (gh no respondió) — se bloquea" };
  }
  const openCards = new Set();
  for (const [i, head] of openPrHeads.entries()) {
    // A pending must never forgive itself: the PR it came from is merged, and if
    // a stale listing still shows it, it does not count as "still open".
    if (openPrNumbers[i] !== undefined && pendings.some((p) => Number(p.pr) === Number(openPrNumbers[i]))) continue;
    const card = cardOf(head);
    if (card) openCards.add(card);
  }
  const blocking = [];
  const carried = [];
  for (const p of pendings) {
    const card = p.card ? String(p.card).toUpperCase() : null;
    if (!card) { blocking.push(p); continue; } // nothing to check against
    if (openCards.has(card)) carried.push({ card, why: "sigue entregándose en una PR abierta" });
    else blocking.push(p);
  }
  return { blocking, carried };
}

const readJson = (path) => { try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; } };

/** The decision the guard asks for, gathering the facts here so the rule ships
 * with npm instead of waiting for the human to reseal the harness. */
export function boardGate({ projectDir = process.cwd(), sessionId = "default", deps = {} } = {}) {
  const state = deps.readState?.() ?? readJson(join(projectDir, ".karajan", "harness", "sentinel-state.json"));
  const pendings = state?.sessions?.[sessionId]?.pending_moves;
  if (!Array.isArray(pendings) || pendings.length === 0) return { blocking: [], carried: [] };
  const run = deps.run ?? ((cmd, args) => execFileSync(cmd, args, { cwd: projectDir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000 }));
  let open = null;
  try { open = JSON.parse(run("gh", ["pr", "list", "--state", "open", "--limit", "100", "--json", "number,headRefName"])); } catch { /* fail closed */ }
  const listed = Array.isArray(open) ? open : null;
  return blockingMoves({ pendings, openPrHeads: listed?.map((p) => p.headRefName) ?? null, openPrNumbers: listed?.map((p) => Number(p.number)) ?? [] });
}

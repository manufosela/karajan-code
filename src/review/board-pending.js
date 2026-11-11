/**
 * Which pending board moves actually block (KJC-BUG-0198).
 *
 * board-sync blocked every advance until a merged PR's card reached a closing
 * state, which assumes one PR per card while the project's rule splits any card
 * over ~150 lines. With KJC-BUG-0197 (#1802 and #1803) that demanded a move that
 * would have been a lie, and the way out was `KJ_ALLOW_BOARD=1`, which switches
 * the whole gate off. A card still being delivered is not a lying board; a TURN
 * ending with work nobody recorded is, and that stays the Stop gate's job.
 *
 * One verifiable fact carries a pending, never a promise in prose: the same card
 * has another OPEN pull request. A branch named after the card is not enough,
 * because the merged branch carries that name too, so accepting it would forgive
 * every merge made from its own lane. KJC-BUG-0362 narrows that, never widens
 * it: the current branch carries only with unmerged commits and when it is not
 * the merged PR's head.
 */

import { execFileSync } from "node:child_process";

import { prunePendingMoves, readLaneSentinelState } from "../harden/sentinel-lane-state.js";
import { readIdentity } from "../identity/store.js";
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
/**
 * KJC-BUG-0362 (#2199): the next PR of a split card may not exist yet (committed,
 * not pushed). The branch the session stands on carries the card when it names
 * that card, holds commits the base does not have, and is NOT the merged PR's
 * head: the merged lane stays unforgiven, as above.
 */
function carriedByLocalBranch(pending, card, localBranch, mergedHeads) {
  if (!localBranch?.name || !(localBranch.unique > 0)) return null;
  const mergedHead = mergedHeads[Number(pending.pr)];
  if (!mergedHead || mergedHead === localBranch.name || cardOf(localBranch.name) !== card) return null;
  return { card, why: `sigue entregándose en la rama ${localBranch.name}, con ${localBranch.unique} commit(s) sin mergear` };
}

export function blockingMoves({ pendings = [], openPrHeads = null, openPrNumbers = [], localBranch = null, mergedHeads = {} }) {
  if (pendings.length === 0) return { blocking: [], carried: [] };
  // KJC-BUG-0363 (#2201): the guard runs BEFORE the command, so a gh auth switch
  // inside it has not happened yet, and other sessions move the active account.
  if (openPrHeads === null) return { blocking: [...pendings], carried: [], reason: "no se pudo comprobar si la card sigue viva en otra PR abierta: gh no pudo listar las PR con la cuenta activa. Si el repo es de otra cuenta, cambiala en un comando aparte (gh auth switch --user <cuenta>) y repite: el guard corre antes que el comando" };
  const openCards = new Set();
  for (const [i, head] of openPrHeads.entries()) {
    // A pending must never forgive itself: the PR it came from is merged, and if
    // a stale listing still shows it, it does not count as "still open".
    if (openPrNumbers[i] !== undefined && pendings.some((p) => Number(p.pr) === Number(openPrNumbers[i]))) continue;
    const card = cardOf(head);
    if (card) openCards.add(card);
  }
  const blocking = [], carried = [];
  for (const p of pendings) {
    const card = p.card ? String(p.card).toUpperCase() : null;
    if (!card) { blocking.push(p); continue; } // nothing to check against
    if (openCards.has(card)) { carried.push({ card, why: "sigue entregándose en una PR abierta" }); continue; }
    const byBranch = carriedByLocalBranch(p, card, localBranch, mergedHeads);
    if (byBranch) carried.push(byBranch);
    else blocking.push(p);
  }
  return { blocking, carried };
}


/**
 * KJC-BUG-0548 (#3880): a shared-board HU whose issue GitHub shows CLOSED with `kj:done` was
 * moved by someone (often its owner, from another session): the board is already true. Any
 * doubt (open, closed without the label, unreadable) keeps it pending.
 */
const isDone = (issue) => issue.state === "CLOSED" && (issue.labels ?? []).some((l) => l.name === "kj:done");

/**
 * KJC-BUG-0554 (HU-3937): a closed issue held only by people other than this clone's declared
 * gh user is the holder's to move (`kj hu move` refuses without release). Any doubt: null.
 */
function heldByAnother(issue, me) {
  const logins = (issue.assignees ?? []).map((a) => a?.login).filter(Boolean);
  if (issue.state !== "CLOSED" || !me || logins.length === 0 || logins.includes(me)) return null;
  return logins.join(", ");
}

/** @returns {{kind: "done"} | {kind: "held", holder: string} | null} one `gh issue view` per card. */
function sharedBoardFact(run, card, me) {
  const m = /^HU-(\d+)$/.exec(card ?? "");
  if (!m) return null;
  try {
    const issue = JSON.parse(run("gh", ["issue", "view", m[1], "--json", "state,labels,assignees"]));
    if (isDone(issue)) return { kind: "done" };
    const holder = heldByAnother(issue, me);
    return holder ? { kind: "held", holder } : null;
  } catch { return null; }
}

function declaredGhUser(projectDir, deps) {
  try { return (deps.readIdentity ?? readIdentity)(projectDir)?.gh_user ?? null; } catch { return null; }
}

/** The decision the guard asks for, gathering the facts here so the rule ships
 * with npm instead of waiting for the human to reseal the harness. */
export function boardGate({ projectDir = process.cwd(), sessionId = "default", deps = {} } = {}) {
  const state = deps.readState?.() ?? readLaneSentinelState(projectDir);
  const all = state?.sessions?.[sessionId]?.pending_moves;
  if (!Array.isArray(all) || all.length === 0) return { blocking: [], carried: [] };
  // KJC-BUG-0364: gh can take several seconds; a timeout reads as "could not check" and blocks.
  const run = deps.run ?? ((cmd, args) => execFileSync(cmd, args, { cwd: projectDir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 15000 }));
  const me = declaredGhUser(projectDir, deps);
  const facts = all.map((p) => { const card = String(p.card ?? "").toUpperCase(); return { card, fact: sharedBoardFact(run, card, me) }; });
  const resolved = facts.filter((f) => f.fact?.kind === "done").map(({ card }) => ({ card, why: "ya está en done en el board compartido" }));
  const heldElsewhere = facts.filter((f) => f.fact?.kind === "held").map(({ card, fact }) => ({ card, holder: fact.holder, why: `la mueve su titular (${fact.holder})` }));
  const settled = [...resolved, ...heldElsewhere].map((r) => r.card);
  // Pruned where the hooks keep it, so the Stop gate (which reads the state) stops holding the turn.
  if (settled.length > 0) (deps.prune ?? ((sid, cards) => prunePendingMoves(projectDir, sid, cards)))(sessionId, settled);
  const pendings = all.filter((p) => !settled.includes(String(p.card ?? "").toUpperCase()));
  const withResolved = (res) => ({ ...res, ...(resolved.length > 0 && { resolved }), ...(heldElsewhere.length > 0 && { heldElsewhere }) });
  if (pendings.length === 0) return withResolved({ blocking: [], carried: [] });
  let open = null;
  try { open = JSON.parse(run("gh", ["pr", "list", "--state", "open", "--limit", "100", "--json", "number,headRefName"])); } catch { /* fail closed */ }
  const listed = Array.isArray(open) ? open : null;
  return withResolved(blockingMoves({ pendings, openPrHeads: listed?.map((p) => p.headRefName) ?? null, openPrNumbers: listed?.map((p) => Number(p.number)) ?? [], ...localFacts(run, pendings) }));
}

/** The current branch, its commits outside the base, and each merged PR's head; unreadable facts forgive nothing. */
function localFacts(run, pendings) {
  const facts = { localBranch: null, mergedHeads: {} };
  try {
    const name = run("git", ["rev-parse", "--abbrev-ref", "HEAD"]).trim();
    let base = "origin/main"; // a clone without origin/HEAD measures against origin/main
    try { base = run("git", ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]).trim() || base; } catch { /* keep origin/main */ }
    const unique = Number(run("git", ["rev-list", "--count", `${base}..HEAD`]).trim());
    if (name && name !== "HEAD" && Number.isInteger(unique)) facts.localBranch = { name, unique };
  } catch { return facts; }
  for (const p of pendings) {
    try { facts.mergedHeads[Number(p.pr)] = JSON.parse(run("gh", ["pr", "view", String(p.pr), "--json", "headRefName"])).headRefName; } catch { /* unknown head: not forgiven */ }
  }
  return facts;
}

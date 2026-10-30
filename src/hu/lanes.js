/**
 * KJC-TSK-1313: which card each worktree lane works on. Read from git every time, never stored on
 * the card, so a lane removed by hand never lingers on the board.
 */
import path from "node:path";

/**
 * The worktrees with a branch in `git worktree list --porcelain`. The first entry is the main
 * checkout and is left out, as are detached worktrees. With `root`, only the lanes under it.
 * @returns {{slug: string, branch: string, path: string}[]}
 */
export function parseLanes(porcelain, { root = null } = {}) {
  const lanes = [];
  let current = null;
  let seen = 0;
  for (const line of porcelain.split("\n")) {
    if (line.startsWith("worktree ")) {
      current = seen++ === 0 ? null : { path: line.slice(9).trim() };
    } else if (line.startsWith("branch ") && current) {
      lanes.push({ slug: path.basename(current.path), branch: line.slice(7).trim().replace(/^refs\/heads\//, ""), path: current.path });
    }
  }
  return root ? lanes.filter((l) => l.path.startsWith(root + path.sep)) : lanes;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);

/**
 * The lanes of each card: those whose branch carries the card id as a whole token (so HU-2 never
 * claims HU-27). Cards without a lane have no entry.
 * @returns {Map<string, {slug: string, branch: string, path: string}[]>}
 */
export function lanesByCard(lanes, cardIds) {
  const byCard = new Map();
  for (const id of new Set(cardIds)) {
    const token = new RegExp(`(^|[^a-z0-9])${escapeRe(id)}($|[^a-z0-9])`, "i");
    const hits = lanes.filter((l) => token.test(l.branch));
    if (hits.length > 0) byCard.set(id, hits);
  }
  return byCard;
}

/**
 * The cards a lane works on: those whose id or any of whose references (a tracker card, an
 * issue) its branch names. `cards` are `{id, refs}`.
 * @returns {string[]}
 */
/**
 * KJC-TSK-1316: one PR per branch from `gh pr list --json number,url,state,headRefName`: an open
 * one wins, else the newest (a merged lane is what KJC-TSK-1314 warns about).
 * @returns {Map<string, {number: number, url: string, state: string}>}
 */
export function prsByBranch(prs) {
  const byBranch = new Map();
  const open = (p) => (p.state === "OPEN" ? 1 : 0);
  for (const p of prs) {
    const cur = byBranch.get(p.headRefName);
    if (!cur || open(p) > open(cur) || (open(p) === open(cur) && p.number > cur.number)) {
      byBranch.set(p.headRefName, { number: p.number, url: p.url, state: p.state });
    }
  }
  return byBranch;
}

export const cardsOfLane = (lane, cards) =>
  cards.filter((c) => lanesByCard([lane], [c.id, ...c.refs]).size > 0).map((c) => c.id);

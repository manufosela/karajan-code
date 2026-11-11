// KJC-TSK-1539 (issue 3853): what a lane is doing, from facts only: its agents at work, its
// pending handoffs, its cards and its branch against its upstream. A pushed branch stands for
// its open pull request, which the board does not read. Pure, so the board (to open on it) and
// the scene (live) decide it the same way.

/** The main checkout, as src/lanes.js names it: it has no branch of its own to wait on. */
const MAIN_LANE = 'main';
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * @param {{ lane: string, working?: object[], mail?: number, branch?: {upstream: string|null, gone: boolean, ahead: number}|null }} lane
 * @param {Array<{id: string, status: string, lane: string}>} cards the factory's cards; those of other lanes are skipped
 * @returns {{ state: 'working'|'waiting-person'|'finished'|'waiting-merge'|'idle'|'unknown', why: string|null }}
 */
export function laneStatus({ lane, working = [], mail = 0, branch }, cards = []) {
  if (working.length) return { state: 'working', why: null };
  if (mail > 0) return { state: 'waiting-person', why: `waits for you: ${plural(mail, 'handoff')}` };
  if (branch?.gone) return { state: 'finished', why: 'branch merged' };
  const mine = cards.filter((c) => c.lane === lane);
  if (mine.length && mine.every((c) => c.status === 'done')) return { state: 'finished', why: `${mine.map((c) => c.id).join(', ')} done` };
  const isMain = lane === MAIN_LANE;
  if (!isMain && !branch) return { state: 'unknown', why: 'branch unreadable' };
  if (!isMain && branch.upstream && branch.ahead === 0) return { state: 'waiting-merge', why: 'pushed, waits for merge' };
  const running = mine.filter((c) => c.status === 'running');
  if (running.length) return { state: 'idle', why: `${running.map((c) => c.id).join(', ')} running, no activity` };
  return { state: 'idle', why: 'no activity' };
}

/**
 * KJC-TSK-1540: the status of each lane of the hall, live: `state` is the scene's last state
 * (its lanes with their branch, everyone at work, the cards) and `box` the mailbox by lane.
 * A lane born after the stage opened has no branch read yet.
 */
export function laneStatuses(names, { lanes = [], working = [], cards = [] }, box) {
  const branchOf = new Map(lanes.map((l) => [l.lane, l.branch]));
  return new Map(names.map((lane) => [lane, laneStatus({
    lane,
    branch: branchOf.get(lane),
    working: working.filter((w) => (w.lane ?? MAIN_LANE) === lane),
    mail: box.get(lane) ?? 0,
  }, cards)]));
}

/** The line under a lane's name: nothing while it works, what it waits for, else its state and why. */
export function statusLine({ state, why }) {
  if (state === 'working') return '';
  return state.startsWith('waiting-') ? why : `${state}: ${why}`;
}

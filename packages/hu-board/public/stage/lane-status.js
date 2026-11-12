// KJC-TSK-1539 (issue 3853): what a lane is doing, from facts only: its agents at work, its
// pending handoffs, its cards and its branch against its upstream. A pushed branch stands for
// its open pull request, whose pipeline the board reads (HU-4029). Pure, so the board (to open on it) and
// the scene (live) decide it the same way.

/** The main checkout, as src/lanes.js names it: it has no branch of its own to wait on. */
const MAIN_LANE = 'main';
const PIPELINE = {
  running: { state: 'waiting-merge', why: 'pipeline running' },
  failed: { state: 'failed', why: 'pipeline failed' },
  passed: { state: 'waiting-merge', why: 'pipeline passed, waits for merge' },
};
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** HU-4101: a lane resting detached is done with its work, not broken (running cards keep their wording). */
function detachedStatus({ clean, atBase, base = 'main', oid }, running) {
  if (!clean) return { state: 'idle', why: 'detached with uncommitted changes' };
  if (running.length) return { state: 'idle', why: `${running.map((c) => c.id).join(', ')} running, no activity` };
  if (atBase) return { state: 'idle', why: `resting at origin/${base}, no open card` };
  return { state: 'idle', why: `resting, detached at ${String(oid).slice(0, 7)}` };
}

/**
 * @param {{ lane: string, working?: object[], mail?: number, branch?: {upstream: string|null, gone: boolean, ahead: number}|null, pipeline?: 'running'|'failed'|'passed'|null }} lane
 * @param {Array<{id: string, status: string, lane: string}>} cards the factory's cards; those of other lanes are skipped
 * @returns {{ state: 'working'|'waiting-person'|'finished'|'waiting-merge'|'failed'|'idle'|'unknown', why: string|null }}
 */
export function laneStatus({ lane, working = [], mail = 0, branch, pipeline = null, remote, owner, title, remoteWorking }, cards = []) {
  // KJC-TSK-1564 (ADR 0056): a teammate's card has no branch here; its owner's status tells.
  if (remote) return { state: working.length || remoteWorking ? 'working' : 'idle', why: `@${owner}: ${title}`, owner };
  if (working.length) return { state: 'working', why: null };
  if (mail > 0) return { state: 'waiting-person', why: `waits for you: ${plural(mail, 'handoff')}` };
  if (branch?.gone) return { state: 'finished', why: 'branch merged' };
  // HU-4029: an open pull request says how its pipeline stands (null: no open pull request).
  if (pipeline && PIPELINE[pipeline]) return PIPELINE[pipeline];
  const mine = cards.filter((c) => c.lane === lane);
  if (mine.length && mine.every((c) => c.status === 'done')) return { state: 'finished', why: `${mine.map((c) => c.id).join(', ')} done` };
  const isMain = lane === MAIN_LANE;
  if (!isMain && !branch) return { state: 'unknown', why: 'branch unreadable' };
  if (!isMain && branch.upstream && branch.ahead === 0) return { state: 'waiting-merge', why: 'pushed, waits for merge' };
  const running = mine.filter((c) => c.status === 'running');
  if (!isMain && branch.detached) return detachedStatus(branch, running);
  if (running.length) return { state: 'idle', why: `${running.map((c) => c.id).join(', ')} running, no activity` };
  return { state: 'idle', why: 'no activity' };
}

/** KJC-TSK-1564: what a lane's plate says: a teammate's card without its owner, who goes under it. */
export const plateName = (lane) => lane.split('@')[0];

/**
 * KJC-TSK-1540: the status of each lane of the hall, live: `state` is the scene's last state
 * (its lanes with their branch, everyone at work, the cards) and `box` the mailbox by lane.
 * A lane born after the stage opened has no branch read yet.
 */
export function laneStatuses(names, { lanes = [], working = [], cards = [] }, box) {
  const byLane = new Map(lanes.map((l) => [l.lane, l]));
  return new Map(names.map((lane) => {
    // KJC-TSK-1577: a teammate's lane that came live, before the board lists it, is theirs too.
    const { remote, owner, title, remoteWorking } = byLane.get(lane) ?? (lane.includes('@') ? { remote: true, owner: lane.split('@')[1], title: plateName(lane) } : {});
    const status = laneStatus({
      lane,
      remote, owner, title, remoteWorking,
      branch: byLane.get(lane)?.branch,
      pipeline: byLane.get(lane)?.pipeline,
      working: working.filter((w) => (w.lane ?? MAIN_LANE) === lane),
      mail: box.get(lane) ?? 0,
    }, cards);
    // KJC-TSK-1546: what someone wrote it waits for (kj worktree note), kept as text.
    const note = byLane.get(lane)?.note;
    return [lane, note ? { ...status, note } : status];
  }));
}

/**
 * The line under a lane's name: nothing while it works; its note, quoted, when it has one;
 * what it waits for; else its state and why.
 */
export function statusLine({ state, why, note, owner }) {
  if (state === 'working') return owner ? `@${owner}` : '';
  if (note) return `“${note}”`;
  return state.startsWith('waiting-') ? why : `${state}: ${why}`;
}

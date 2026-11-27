// KJC-TSK-1805 and KJC-TSK-1811 (the maintainer, 2026-11-26 and 27): an open session that waits for
// nothing is not a wait: it rests (it asked for nothing) or it is done (it said no work is left).
// Pure: the panel, the lanes and the coffee cart ask here.

/** The `waiting` of a host at its desk that waits for nothing. */
export const IDLE = new Set(['rest', 'done']);

/** Whether a host of a lane's `working` sits at its desk waiting for nothing. */
export const isIdle = (worker) => IDLE.has(worker?.waiting);

/** What a host's `waiting` says on its label and in the list. */
export const WAITS = { person: 'waits for you', process: 'waits for a process', rest: 'resting', done: 'done' };

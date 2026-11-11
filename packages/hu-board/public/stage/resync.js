// KJC-BUG-0557: the scene against the board's state. A robot only left when its end event came,
// and a session that dies sends none, so the scene kept piling robots; the hall only ever added
// workshops. Pure: live.js plays what it finds as ordinary events and removes the workshops.

const MAIN = 'main';
/** One agent at work: its lane and its id, or its agent and role when it has no id. */
const keyOf = (w) => [w.lane ?? MAIN, w.id ?? [w.agent, w.role].join(':')].join('|');

/** An end event, at `at`, for everyone at work in `local` that `server` no longer lists. */
export function staleEnds(local, server, at) {
  const seen = new Set(server.map(keyOf));
  return local.filter((w) => !seen.has(keyOf(w))).map((w) => ({
    type: 'agent-activity', phase: 'end', agent: w.agent, role: w.role, lane: w.lane ?? MAIN, id: w.id ?? null, at,
  }));
}

/** The lanes of the hall the board no longer lists; never the main checkout, nor one with a robot at work. */
export function goneLanes(names, serverLanes, working) {
  const listed = new Set(serverLanes.map((l) => l.lane));
  const busy = new Set(working.map((w) => w.lane ?? MAIN));
  return names.filter((lane) => lane !== MAIN && !listed.has(lane) && !busy.has(lane));
}

// KJC-TSK-1430 (decided by the maintainer on 2026-11-05): each agent kj launches
// is a robot of its own. It walks in from the back door when its work starts,
// works at the bench of the workshop of its lane (ADR 0048) and walks out when
// it ends. KJC-TSK-1435: so does the host agent, and each subagent it opens walks
// out of it and back. Pure: the scene reads the poses.
import { DOOR, WORKSHOP } from './layout.js';

export { DOOR } from './layout.js';
export const WALK_MS = 2500;
const BENCH_Z = WORKSHOP.z - 0.4;
// Side by side at the bench: the host (KJC-TSK-1435), the coder kj launches, the
// reviewer beside it, Solomon beside the reviewer it arbitrates.
const ROLE_SHIFT = { host: -1.3, coder: -0.5, reviewer: 0.4, solomon: 1.3 };
// KJC-TSK-1435 (ADR 0048): the host's subagents work in rows of five in front of the bench.
const SUBAGENT = { z: WORKSHOP.z + 0.9, from: -1.5, step: 0.75, slots: 5, row: 0.6 };
// Each agent wears its own colour; one kj does not know yet wears a neutral grey.
const ACCENTS = { claude: 0xd97757, codex: 0x9aa4ff, agy: 0x7ee0b5 };
export const accentOf = (agent) => ACCENTS[agent] ?? 0xc0c8d0;
/** How long atril takes to turn one page, in ms (KJC-TSK-1428). */
export const TURN_MS = 1200;

/**
 * Which page atril is turning for the skills an agent started with, and how far
 * (0..1), with the skill's name; null once every page is turned. Page 0 is the
 * cover, so the first skill turns page 1.
 */
export function turnAt(turn, now) {
  if (!turn) return null;
  const k = (now - turn.at) / TURN_MS;
  if (k < 0 || k >= turn.skills.length) return null;
  const i = Math.floor(k);
  return { page: i + 1, fraction: k - i, skill: turn.skills[i] };
}

/** The key of one robot's whole visit, from walking in to walking out. */
export const visitKey = (w) => `${w.agent}:${w.role}:${w.id ?? ''}:${w.since}`;

/** Where an agent in `role` works in the workshop centred at `laneX`; a subagent, in its `slot` before the bench. */
export function spotOf(role, laneX = 0, slot = 0) {
  if (role === 'subagent') {
    const row = Math.floor(slot / SUBAGENT.slots);
    return { x: laneX + SUBAGENT.from + (slot % SUBAGENT.slots) * SUBAGENT.step, z: SUBAGENT.z + row * SUBAGENT.row };
  }
  return { x: laneX + (ROLE_SHIFT[role] ?? 0), z: BENCH_Z };
}

const laneOf = (ev) => ev.lane ?? 'main';
/**
 * The worker this event is about that has not left yet (a leftAt of 0 is a real
 * departure): by its id when the trace names one (the host's session, a subagent),
 * else by agent, role and lane.
 */
const inside = (w, ev) => w.leftAt === undefined && w.lane === laneOf(ev)
  && (ev.id ? w.id === ev.id : w.agent === ev.agent && w.role === ev.role);

/** The first slot no subagent of `lane` holds. */
const freeSlot = (workers, lane) => {
  const held = new Set(workers.filter((w) => w.role === 'subagent' && w.lane === lane && w.leftAt === undefined).map((w) => w.slot));
  let slot = 0;
  while (held.has(slot)) slot += 1;
  return slot;
};

/** A new worker from a start event (or a still-open start of the last state). */
const newWorker = (workers, ev, since) => {
  const lane = laneOf(ev);
  const worker = { agent: ev.agent, role: ev.role, lane, id: ev.id ?? null, tool: ev.tool ?? null, kind: ev.kind ?? null, since };
  return ev.role === 'subagent' ? { ...worker, slot: freeSlot(workers, lane) } : worker;
};

/** The workers after an agent-activity event at `now` (ms); other events change nothing. */
export function withActivity(workers, event, now) {
  if (event?.type !== 'agent-activity') return workers;
  if (event.phase === 'start') {
    // A start of someone already at work is its beat: it only says which tool it uses now.
    if (workers.some((w) => inside(w, event))) return workers.map((w) => (inside(w, event) && event.tool ? { ...w, tool: event.tool } : w));
    return [...workers, newWorker(workers, event, now)];
  }
  return workers.map((w) => (inside(w, event) ? { ...w, leftAt: now } : w));
}

/** The agents already at work in `lane` when the stage opens, standing at their spot. */
export const workersFrom = (working, now, lane = 'main') =>
  working.reduce((all, w) => [...all, newWorker(all, { ...w, lane }, now - WALK_MS)], []);

const lerp = (from, to, k) => ({ x: from.x + (to.x - from.x) * k, z: from.z + (to.z - from.z) * k });
const facing = (from, to) => Math.atan2(to.x - from.x, to.z - from.z);

/**
 * Where a worker is at `now` and whether it walks, or null once it has left;
 * `xOf` gives a lane's x. A subagent walks out of its host and back to it;
 * everyone else comes in by the door and leaves by it.
 */
export function workerAt(worker, now, xOf = () => 0) {
  const laneX = xOf(worker.lane);
  const spot = spotOf(worker.role, laneX, worker.slot);
  const gate = worker.role === 'subagent' ? spotOf('host', laneX) : DOOR;
  if (worker.leftAt !== undefined && now >= worker.leftAt) {
    const k = (now - worker.leftAt) / WALK_MS;
    return k >= 1 ? null : { ...lerp(spot, gate, k), yaw: facing(spot, gate), walking: true };
  }
  const k = Math.min(1, Math.max(0, (now - worker.since) / WALK_MS));
  return k < 1 ? { ...lerp(gate, spot, k), yaw: facing(gate, spot), walking: true } : { ...spot, yaw: 0, walking: false };
}

/** What the label over a worker says: the host and the tool it uses, a subagent its type, others their name. */
export function labelOf(worker) {
  if (worker.role === 'subagent') return worker.kind ?? 'subagent';
  if (worker.role === 'host' && worker.tool) return `${worker.agent} · ${worker.tool}`;
  return worker.agent;
}

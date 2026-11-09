// KJC-TSK-1430 (decided by the maintainer on 2026-11-05): each agent kj launches
// is a robot of its own. It walks in from the back door when its work starts,
// works at the bench of the workshop of its lane (ADR 0048) and walks out when
// it ends. KJC-TSK-1435: so does the host agent, and each subagent it opens walks
// out of it and back. Pure: the scene reads the poses.
import { DOOR, WORKSHOP } from './layout.js';

export { DOOR } from './layout.js';
export const WALK_MS = 2500;
// How far in front of (+) or behind (-) its workshop's centre each one works.
const BENCH_DZ = -0.4;
// Side by side at the bench: the host (KJC-TSK-1435), the coder kj launches, the
// reviewer beside it, Solomon beside the reviewer it arbitrates.
const ROLE_SHIFT = { host: -1.3, coder: -0.5, reviewer: 0.4, solomon: 1.3 };
// KJC-TSK-1435 (ADR 0048): the host's subagents work in rows of five in front of the bench.
const SUBAGENT = { dz: 0.9, from: -1.5, step: 0.75, slots: 5, row: 0.6 };
// Each agent wears its own colour; one kj does not know yet wears a neutral grey.
const ACCENTS = { claude: 0xd97757, codex: 0x9aa4ff, agy: 0x7ee0b5 };
export const accentOf = (agent) => ACCENTS[agent] ?? 0xc0c8d0;
/** How long the laptop's code takes to scroll up one screen, in ms (KJC-TSK-1493). */
export const SCROLL_MS = 6000;

/**
 * KJC-TSK-1493: where the laptop's screen looks at `now` on its code, drawn twice one
 * over the other: the vertical texture offset, from 0.5 (the top copy) down towards 0,
 * so the lines rise and the second copy takes over where the first began.
 */
export const codeScrollAt = (now) => 0.5 - ((now % SCROLL_MS) / SCROLL_MS) * 0.5;

/** How long one hand takes to strike a key, in ms (KJC-TSK-1486). */
export const KEY_MS = 140;

/**
 * KJC-TSK-1486: how far forward each arm swings while the agent types, its hands
 * taking turns over the laptop's keyboard (1 rests on it, 1.25 is the top of a stroke).
 */
export function typingAt(now) {
  const stroke = Math.sin((Math.PI * now) / KEY_MS);
  return { L: 1 + 0.25 * Math.max(0, stroke), R: 1 + 0.25 * Math.max(0, -stroke) };
}

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

/** Where an agent in `role` works in the workshop centred at (`laneX`, `laneZ`); a subagent, in its `slot` before the bench. */
export function spotOf(role, laneX = 0, slot = 0, laneZ = WORKSHOP.z) {
  if (role === 'subagent') {
    const row = Math.floor(slot / SUBAGENT.slots);
    return { x: laneX + SUBAGENT.from + (slot % SUBAGENT.slots) * SUBAGENT.step, z: laneZ + SUBAGENT.dz + row * SUBAGENT.row };
  }
  return { x: laneX + (ROLE_SHIFT[role] ?? 0), z: laneZ + BENCH_DZ };
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
  const worker = { agent: ev.agent, role: ev.role, lane, id: ev.id ?? null, tool: ev.tool ?? null, kind: ev.kind ?? null, name: ev.name ?? null, since };
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
 * `xOf`/`zOf` give a lane's workshop. A subagent walks out of its host and back to it;
 * everyone else comes in by the door and leaves by it.
 */
export function workerAt(worker, now, xOf = () => 0, zOf = () => WORKSHOP.z) {
  const laneX = xOf(worker.lane);
  const laneZ = zOf(worker.lane);
  const spot = spotOf(worker.role, laneX, worker.slot, laneZ);
  const gate = worker.role === 'subagent' ? spotOf('host', laneX, 0, laneZ) : DOOR;
  if (worker.leftAt !== undefined && now >= worker.leftAt) {
    const k = (now - worker.leftAt) / WALK_MS;
    return k >= 1 ? null : { ...lerp(spot, gate, k), yaw: facing(spot, gate), walking: true };
  }
  const k = Math.min(1, Math.max(0, (now - worker.since) / WALK_MS));
  return k < 1 ? { ...lerp(gate, spot, k), yaw: facing(gate, spot), walking: true } : { ...spot, yaw: 0, walking: false };
}

/**
 * What the label over a worker says: the host its session's name (KJC-TSK-1483; its
 * agent when the session has none) and the tool it uses, a subagent its type, others their name.
 */
export function labelOf(worker) {
  if (worker.role === 'subagent') return worker.kind ?? 'subagent';
  const who = (worker.role === 'host' && worker.name) || worker.agent;
  return worker.role === 'host' && worker.tool ? `${who} · ${worker.tool}` : who;
}

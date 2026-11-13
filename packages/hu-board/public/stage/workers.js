// KJC-TSK-1430 (decided by the maintainer on 2026-11-05): each agent kj launches
// is a robot of its own. It walks in from the back door when its work starts,
// works at the bench of the workshop of its lane (ADR 0048) and walks out when
// it ends. KJC-TSK-1435: so does the host agent, and each subagent it opens walks
// out of it and back. Pure: the scene reads the poses.
import { DOOR, STAND, WORKSHOP } from './layout.js';

export { DOOR } from './layout.js';
export const WALK_MS = 2500;
// How far in front of (+) or behind (-) its workshop's centre each one works. KJC-TSK-1609 (the
// maintainer, 2026-11-13): in the middle, so no empty floor is left in front of the desks.
const BENCH_DZ = 0;
// Side by side at the bench: the host (KJC-TSK-1435), the coder kj launches, the
// reviewer beside it, Solomon beside the reviewer it arbitrates. KJC-TSK-1609: 1.2 m apart, so
// an agent fits between one desk and the next.
export const SEATS = [-1.8, -0.6, 0.6, 1.8];
// KJC-TSK-1486: typing, an agent turns side on to the camera, which sees its hands and its screen.
// KJC-TSK-1591: its desk turns with it.
export const TYPING_YAW = 1.85;
const ROLE_SEAT = { host: 0, coder: 1, reviewer: 2, solomon: 3 };
// KJC-BUG-0555: once the four seats are taken, the next ones stand in rows behind the bench.
const SEAT_ROW = 0.9;
// KJC-TSK-1435 (ADR 0048): the host's subagents work in rows of five in front of the bench.
const SUBAGENT = { dz: 1.2, from: -1.8, step: 0.9, slots: 5, row: 0.6 };
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
/** KJC-TSK-1596: where an agent stands to take its skills, a metre in front of atril, facing it. */
export const READER = { x: STAND.x + Math.sin(STAND.yaw), z: STAND.z + Math.cos(STAND.yaw) };

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

/**
 * Where an agent in `role` works in the workshop centred at (`laneX`, `laneZ`): a subagent in
 * its `slot` before the bench; anyone else in its seat at the bench (KJC-BUG-0555), its role's
 * own when no seat is given, and the middle of the bench for a role without one.
 */
export function spotOf(role, laneX = 0, slot = undefined, laneZ = WORKSHOP.z) {
  if (role === 'subagent') {
    const at = slot ?? 0;
    const row = Math.floor(at / SUBAGENT.slots);
    return { x: laneX + SUBAGENT.from + (at % SUBAGENT.slots) * SUBAGENT.step, z: laneZ + SUBAGENT.dz + row * SUBAGENT.row };
  }
  const seat = slot ?? ROLE_SEAT[role];
  if (seat === undefined) return { x: laneX, z: laneZ + BENCH_DZ };
  const row = Math.floor(seat / SEATS.length);
  return { x: laneX + SEATS[seat % SEATS.length], z: laneZ + BENCH_DZ - row * SEAT_ROW };
}

const laneOf = (ev) => ev.lane ?? 'main';
/** KJC-TSK-1528 (decided by the maintainer on 2026-11-11): the AI review piece does the reviewing, so no robot. */
const PIECE_ROLE = 'reviewer';
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

/**
 * KJC-BUG-0555: the seat at the bench of `lane` for a new robot in `role`: its role's own
 * while free, else the first free one; none for a role without a seat of its own when its
 * usual spot (the middle) is free, as before.
 */
const freeSeat = (workers, lane, role) => {
  const held = new Set(workers.filter((w) => w.role !== 'subagent' && w.lane === lane && w.leftAt === undefined).map((w) => w.slot ?? ROLE_SEAT[w.role]));
  const own = ROLE_SEAT[role];
  if (own !== undefined && !held.has(own)) return own;
  if (own === undefined && !workers.some((w) => w.lane === lane && w.leftAt === undefined && w.role === role)) return undefined;
  let seat = 0;
  while (held.has(seat)) seat += 1;
  return seat;
};

/** A new worker from a start event (or a still-open start of the last state). */
const newWorker = (workers, ev, since) => {
  const lane = laneOf(ev);
  // KJC-TSK-1538: the model and effort it runs with dress its robot.
  const worker = { agent: ev.agent, role: ev.role, lane, id: ev.id ?? null, tool: ev.tool ?? null, kind: ev.kind ?? null, name: ev.name ?? null, model: ev.model ?? null, effort: ev.effort ?? null, since };
  // KJC-BUG-0577: a teammate's agent keeps whose it is and the avatar it wears.
  // One with no avatar of its own looks plain, never like the own one.
  if (ev.owner) Object.assign(worker, { owner: ev.owner, avatar: ev.avatar ?? { emblem: null, color: null } });
  // KJC-TSK-1596: how many of atril's skills it takes on its way in (a subagent comes out of its host).
  if (ev.role !== 'subagent' && ev.skills?.length) worker.reads = ev.skills.length;
  // KJC-TSK-1607: a host already waiting when the stage opens.
  if (ev.waiting) worker.waiting = ev.waiting;
  return { ...worker, slot: ev.role === 'subagent' ? freeSlot(workers, lane) : freeSeat(workers, lane, ev.role) };
};

/** The workers after an agent-activity event at `now` (ms); other events change nothing. */
export function withActivity(workers, event, now) {
  if (event?.type !== 'agent-activity' || event.role === PIECE_ROLE) return workers;
  if (event.phase === 'start') {
    // A start of someone already at work is its beat: it says which tool it uses now, and
    // KJC-TSK-1538: the model it answers with, which the host may switch mid-session.
    // KJC-TSK-1607: and a host that was waiting is at work again.
    // KJC-TSK-1610: kj hu start gives the host atril's skills without its id: the host goes to read them.
    const detour = !event.id && event.role === 'host' && event.skills?.length ? { detour: { at: now, reads: event.skills.length } } : {};
    const beat = ({ waiting: _was, ...w }) => ({ ...w, ...(event.tool ? { tool: event.tool } : {}), ...(event.model ? { model: event.model } : {}), ...detour });
    if (workers.some((w) => inside(w, event))) return workers.map((w) => (inside(w, event) ? beat(w) : w));
    // KJC-TSK-1610: the Sentinel's start, with the id, of a host that came in without one is that host.
    const unnamed = (w) => event.role === 'host' && event.id && w.role === 'host' && !w.id && w.leftAt === undefined && w.lane === laneOf(event);
    if (workers.some(unnamed)) return workers.map((w) => (unnamed(w) ? beat({ ...w, id: event.id }) : w));
    // KJC-BUG-0581: a session works in one lane; its start in another walks it out of the first.
    const elsewhere = (w) => event.id && w.id === event.id && w.leftAt === undefined && w.lane !== laneOf(event);
    const moved = workers.map((w) => (elsewhere(w) ? { ...w, leftAt: now } : w));
    return [...moved, newWorker(moved, event, now)];
  }
  // KJC-TSK-1607: a host whose turn ends waiting (KJC-TSK-1606) stays at its desk; anyone else leaves.
  const ends = (w) => (event.waits && w.role === 'host' ? { ...w, waiting: event.waits } : { ...w, leftAt: now });
  return workers.map((w) => (inside(w, event) ? ends(w) : w));
}

/** The agents already at work in `lane` when the stage opens, standing at their spot. */
export const workersFrom = (working, now, lane = 'main') =>
  // KJC-TSK-1596: already at its desk, it took its skills before the stage opened.
  working.filter((w) => w.role !== PIECE_ROLE).reduce((all, w) => [...all, newWorker(all, { ...w, lane, skills: [] }, now - WALK_MS)], []);

const lerp = (from, to, k) => ({ x: from.x + (to.x - from.x) * k, z: from.z + (to.z - from.z) * k });
const facing = (from, to) => Math.atan2(to.x - from.x, to.z - from.z);

/** KJC-TSK-1610: where a host on its way from its desk (`spot`) to atril and back is, or null outside it. */
function detourAt(detour, now, spot) {
  const t = detour ? now - detour.at : -1;
  const read = detour ? detour.reads * TURN_MS : 0;
  if (t < 0 || t >= 2 * WALK_MS + read) return null;
  if (t < WALK_MS) return { ...lerp(spot, READER, t / WALK_MS), yaw: facing(spot, READER), walking: true, reading: false };
  if (t < WALK_MS + read) return { ...READER, yaw: facing(READER, STAND), walking: false, reading: true };
  const k = (t - WALK_MS - read) / WALK_MS;
  return { ...lerp(READER, spot, k), yaw: facing(READER, spot), walking: true, reading: false };
}

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
  // KJC-TSK-1610: a host already at its desk goes to atril and back when kj gives it skills.
  const away = detourAt(worker.detour, now, spot);
  if (away) return away;
  // KJC-TSK-1596: with skills it stops before atril on its way in, one page per skill.
  const via = worker.reads ? READER : null;
  const t = Math.max(0, now - worker.since);
  if (via && t < WALK_MS) return { ...lerp(gate, via, t / WALK_MS), yaw: facing(gate, via), walking: true, reading: false };
  const read = via ? worker.reads * TURN_MS : 0;
  if (via && t < WALK_MS + read) return { ...via, yaw: facing(via, STAND), walking: false, reading: true };
  const from = via ?? gate;
  const k = Math.min(1, (t - (via ? WALK_MS + read : 0)) / WALK_MS);
  // KJC-TSK-1607: a waiting host sits at its desk without typing.
  return k < 1 ? { ...lerp(from, spot, k), yaw: facing(from, spot), walking: true, reading: false } : { ...spot, yaw: 0, walking: false, reading: false, waiting: Boolean(worker.waiting) };
}

/**
 * KJC-TSK-1596: when atril starts turning the pages of a start at `now`: once its robot stands
 * before it; at once for the reviewer, which has no robot, and for a subagent.
 */
export const turnFrom = (event, now) => (event.role === PIECE_ROLE || event.role === 'subagent' ? now : now + WALK_MS);

/**
 * What the label over a worker says: the host its session's name (KJC-TSK-1483; its
 * agent when the session has none) and the tool it uses, a subagent its type, others their name.
 */
export function labelOf(worker) {
  if (worker.role === 'subagent') return worker.kind ?? 'subagent';
  const who = (worker.role === 'host' && worker.name) || worker.agent;
  return worker.role === 'host' && worker.tool ? `${who} · ${worker.tool}` : who;
}

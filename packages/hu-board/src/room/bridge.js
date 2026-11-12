/**
 * KJC-TSK-1572 (ADR 0056, point 3): what crosses the room. Out goes only an agent's activity with
 * the fields the ADR names (role, lane, card, model, effort) and the own avatar, never free text,
 * paths or secrets. In comes a teammate's, checked against the same contract, in its lane@login.
 * The team floor keeps who of each teammate is at work, as lanes of the repository's factory.
 */
import { cleanAvatar } from '../../public/stage/avatars.js';

const FIELDS = ['type', 'phase', 'agent', 'role', 'lane', 'id', 'model', 'effort', 'at', 'tool'];
const SLUG = /^[\w.-]{1,64}$/;
const PHASES = new Set(['start', 'end']);

const pick = (event) => Object.fromEntries(FIELDS.filter((k) => event[k] !== undefined && event[k] !== null).map((k) => [k, event[k]]));

/** The message the room gets for `event` of this board, or nothing. */
export function outgoing(event, avatar) {
  if (event?.type !== 'agent-activity') return null;
  const message = { ...pick(event), lane: event.lane ?? 'main' };
  if (!SLUG.test(message.lane)) return null;
  const clean = cleanAvatar(avatar);
  return clean.emblem || Object.keys(clean.colors).length ? { ...message, avatar: clean } : message;
}

/** A teammate's message as a scene event in its lane@login, or nothing when it is off the contract. */
export function incoming(from, message) {
  if (message?.type !== 'agent-activity' || !PHASES.has(message.phase) || !SLUG.test(from)) return null;
  const fields = pick(message);
  if (!SLUG.test(fields.lane ?? '')) return null;
  if (Object.values(fields).some((v) => typeof v !== 'string' || v.length > 64)) return null;
  return { ...fields, lane: `${fields.lane}@${from}`, owner: from, avatar: cleanAvatar(message.avatar) };
}

/** Who of each teammate is at work, by lane@login, as lanes of the factory. */
export function createTeamFloor() {
  const workers = new Map(); // `${lane}|${id or agent:role}` -> event
  const keyOf = (e) => [e.lane, e.id ?? [e.agent, e.role].join(':')].join('|');
  return {
    apply(event) {
      if (!event) return;
      if (event.phase === 'start') workers.set(keyOf(event), event);
      else workers.delete(keyOf(event));
    },
    leave(login) {
      for (const [key, e] of workers) if (e.owner === login) workers.delete(key);
    },
    lanes() {
      const byLane = Map.groupBy(workers.values(), (e) => e.lane);
      return [...byLane].map(([lane, working]) => ({
        lane, owner: working[0].owner, title: lane.split('@')[0], remote: true, remoteWorking: true, working,
      }));
    },
  };
}

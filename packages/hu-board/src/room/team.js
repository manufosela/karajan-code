/**
 * KJC-TSK-1577 (ADR 0056, point 3): what the board does in a room once it is in. Its mesh carries
 * the own agents' activity out, with the own avatar, and the teammates' in; every 30 s it says
 * again who works here, for a teammate who came in later. The teammates' agents become lanes of
 * the factory (lane@login) and live events, found by the folder of the repository.
 */
import { getKjHome } from '../db-paths.js';
import { readAvatar } from '../stage-avatar.js';
import { watchLanes } from '../stage-feed.js';
import { laneStates } from '../stage-state.js';
import { createTeamFloor, incoming, outgoing } from './bridge.js';
import { createMesh } from './mesh.js';
import { nodeRtc } from './rtc-node.js';

const REPEAT_MS = 30 * 1000;
const byDir = new Map(); // folder of a repository -> its team

/** The team of the room of the repository at `dir`, or none. */
export const teamOfDir = (dir) => byDir.get(dir) ?? null;

/** Calls `send(event, dir)` for every teammate's event of every room, until the returned stop. */
export function listenEveryTeam(send) {
  const stops = [...byDir].map(([dir, team]) => team.listen((event) => send(event, dir)));
  return () => stops.forEach((stop) => stop());
}

export function runTeam(room, {
  meshOf = (deps) => createMesh({ ...deps, rtc: nodeRtc }),
  watch = watchLanes, lanesOf = laneStates, avatar = () => readAvatar(getKjHome()), repeatMs = REPEAT_MS, log = console,
} = {}) {
  const floor = createTeamFloor();
  const listeners = new Set();
  const mesh = meshOf({
    session: room.session, rtdb: room.rtdb, log,
    onMessage: (from, message) => {
      const event = incoming(from, message);
      if (!event) return;
      floor.apply(event);
      for (const fn of listeners) fn(event);
    },
  });
  const send = (event) => {
    const message = outgoing(event, avatar());
    if (message) mesh.send(message);
  };
  const stops = room.dirs.map((dir) => watch(dir, send));
  const repeat = () => {
    for (const dir of room.dirs) {
      for (const { lane, working = [] } of lanesOf(dir)) for (const w of working) send({ ...w, type: 'agent-activity', phase: 'start', lane });
    }
  };
  const timer = repeatMs ? setInterval(repeat, repeatMs) : null;
  timer?.unref?.();
  let known = [];
  const team = {
    repeat,
    /** Links to the live peers and forgets the agents of those who left. */
    setPeers(peers) {
      mesh.setPeers(peers);
      for (const login of known) if (!peers.includes(login)) floor.leave(login);
      known = peers;
    },
    lanes: () => floor.lanes(),
    listen(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    stop() {
      clearInterval(timer);
      stops.forEach((stop) => stop?.());
      mesh.close();
      for (const dir of room.dirs) byDir.delete(dir);
    },
  };
  for (const dir of room.dirs) byDir.set(dir, team);
  return team;
}

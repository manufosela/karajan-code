// KJC-TSK-1420 (ADR 0047): the crew is always busy. Each robot loops a route of
// waypoints, pausing at each to work, and now and then one says a workshop line.
// Ambient only: it never claims anything about the project; real work arrives as
// boxes on the line (KJC-TSK-1399). Pure: the same t always gives the same pose.

/** Walking speed in metres per second. */
const SPEED = 1.2;
/** Routes on the floor, clear of the line. pause: seconds working at the waypoint. */
export const ROUTES = {
  conductor: [{ x: -9.4, z: 2.6, pause: 3 }, { x: -6, z: 3.2, pause: 1.5 }, { x: -3, z: 3.2, pause: 2 }],
  rag: [{ x: -9, z: -2.2, pause: 3 }, { x: -8.9, z: 0.4, pause: 2 }],
  watch: [{ x: 9.4, z: 2.6, pause: 2 }, { x: 2, z: 3.6, pause: 1.5 }, { x: -6, z: 3.6, pause: 2 }],
};
/** What the crew says to each other: workshop talk, never a fact about the project. */
export const LINES = [
  'Anything new on the line?', 'On my way.', 'Checking the stations.',
  'Reading the score.', 'Small diffs, please.', 'Tests first.',
];
const BUBBLE = { every: 7, for: 3 };

const legs = (route) => route.map((from, i) => {
  const to = route[(i + 1) % route.length];
  return { from, to, walk: Math.hypot(to.x - from.x, to.z - from.z) / SPEED };
});

/** Seconds it takes a robot to walk its whole route once, pauses included. */
export const periodOf = (route) => legs(route).reduce((sum, leg) => sum + leg.from.pause + leg.walk, 0);

/** Where a robot on `route` stands at time t, which way it faces, and whether it walks. */
export function poseAt(route, t) {
  let left = t % periodOf(route);
  for (const { from, to, walk } of legs(route)) {
    const yaw = Math.atan2(to.x - from.x, to.z - from.z);
    if (left < from.pause) return { x: from.x, z: from.z, yaw, walking: false };
    left -= from.pause;
    if (left < walk) {
      const k = left / walk;
      return { x: from.x + (to.x - from.x) * k, z: from.z + (to.z - from.z) * k, yaw, walking: true };
    }
    left -= walk;
  }
  return { x: route[0].x, z: route[0].z, yaw: 0, walking: false };
}

/** The line someone is saying at time t, or null between bubbles. */
export function bubbleAt(t) {
  const turn = Math.floor(t / BUBBLE.every);
  if (t - turn * BUBBLE.every >= BUBBLE.for) return null;
  const crew = Object.keys(ROUTES);
  return { who: crew[turn % crew.length], text: LINES[turn % LINES.length] };
}

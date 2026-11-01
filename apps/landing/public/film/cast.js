// The cast and how each robot moves: the conductor on the podium, kaRAGan and
// kaWATCHan pushing the tool crates onto the staff and gathering at the end.
import { createRobot } from './robot.js';
import { createCrate, createDiff, createVerdict, createShock, CRATE, DIFF_SIZE } from './props.js';
import { STAFF, PODIUM } from './stage.js';
import { T, SLOTS, REFUSING_CRATE, VERDICT_X, span, easeInOut, easeOut, lerp, pulse, blinkAt } from './timeline.js';

const Z = STAFF.z;
const TOP = CRATE.h + DIFF_SIZE / 2;

/**
 * Builds the cast; `tools` are the crate labels, in the page's language, and
 * `fresh` names the tool that is new in this release and the badge it wears.
 */
export function createCast(scene, tools, fresh) {
  const conductor = createRobot({ accent: 0x34e07f, bow: 0xeef1f6, name: 'Karajan Code' });
  conductor.root.position.set(PODIUM.x, PODIUM.h, PODIUM.z);
  conductor.root.scale.setScalar(1.25);
  const rag = createRobot({ accent: 0xf0b429, name: 'kaRAGan' });
  const watch = createRobot({ accent: 0x4fb3e8, name: 'kaWATCHan' });
  const crates = tools.map((name, i) => createCrate(i, name, name === fresh.tool ? fresh.badge : ''));
  const rogue = createDiff('rogue');
  const honest = createDiff('honest');
  const verdict = createVerdict();
  verdict.group.position.set(VERDICT_X, 0, Z);
  const shock = createShock();
  shock.position.set(SLOTS[REFUSING_CRATE] - CRATE.w / 2, TOP, Z);
  shock.rotation.y = Math.PI / 2;
  scene.add(conductor.root, rag.root, watch.root, rogue.group, honest.group, verdict.group, shock);
  crates.forEach((c) => scene.add(c.group));
  return { conductor, rag, watch, crates, rogue, honest, verdict, shock };
}

const headToward = (robot, x, z) => {
  const p = robot.root.position;
  const yaw = Math.atan2(x - p.x, z - p.z) - robot.root.rotation.y;
  return Math.max(-0.9, Math.min(0.9, yaw));
};

export function conductorAt(t, { conductor: k, honest }, beat) {
  const wake = easeInOut(span(t, 1.2, 2));
  k.head.rotation.x = 0.42 * (1 - wake);
  const flick = span(t, 1, 1.5);
  const flicker = flick < 1 ? 0.7 + 0.3 * Math.sin(t * 70) : 1;
  k.setGlow(t < 1 ? 0 : easeOut(flick) * flicker);
  k.setBlink(pulse(t, 2.1, 0.16) + (t > T.end ? blinkAt(t, 1.1) : 0));
  const ready = easeInOut(span(t, 1.8, 2.6));
  let spreadL = lerp(0.25, 2.3, ready);
  let spreadR = lerp(0.25, 2.45, ready);
  if (t > 2.6 && t < T.verdict) {
    spreadR -= 0.12 * Math.sin(t * 4.4) * span(t, 2.6, 3.2);
    spreadR -= 0.5 * beat;
    spreadL -= 0.18 * beat;
  }
  const halt = pulse(t, T.refuse - 0.1, 1.15);
  spreadL = lerp(spreadL, 1.25, halt);
  const forwardL = 1.35 * halt;
  const shake = t > T.refuse ? 0.24 * Math.sin((t - T.refuse) * 17) * Math.exp(-(t - T.refuse) * 3.2) : 0;
  const cheer = pulse(t, T.verdict, 1.1);
  spreadL = lerp(spreadL, 2.85, cheer);
  spreadR = lerp(spreadR, 2.85, cheer);
  k.hover.position.y = 0.1 + 0.16 * cheer + (t > T.end ? 0.03 * Math.sin(t * 1.6) : 0);
  if (t > T.end) {
    spreadR += 0.08 * Math.sin(t * 1.3);
    spreadL -= 0.05 * Math.sin(t * 1.1);
  }
  k.pose('L', spreadL, forwardL);
  k.pose('R', spreadR);
  const follow = t > T.honestDrop && t < T.verdict + 0.6 ? 0.55 * headToward(k, honest.group.position.x, Z) : 0;
  k.head.rotation.y = shake + follow;
}

export function walkerAt(t, robot, side, crates, cube) {
  const enter = side < 0 ? [2.7, 5.1] : [2.9, 5.3];
  const travel = easeInOut(span(t, enter[0], enter[1]));
  const endX = side * 7;
  const x = lerp(side * 16, endX, travel);
  const walking = t > enter[0] && t < enter[1] + 0.25 ? 1 : 0;
  const settle = easeInOut(span(t, enter[1] + 0.2, enter[1] + 1));
  // In the outro the two walk to the podium for the family portrait.
  const gather = easeInOut(span(t, T.outro + 0.2, T.outro + 1.9));
  const settledX = x + side * 0.4 * settle;
  robot.root.position.set(lerp(settledX, side * 2.75, gather), 0, lerp(lerp(Z, 0.2, settle), -0.9, gather));
  robot.root.rotation.y = lerp(lerp(-side * Math.PI / 2, -side * 0.55, settle), -side * 0.22, gather);
  const strolling = gather > 0 && gather < 1 ? 1 : 0;
  robot.hover.rotation.x = 0.14 * (1 - settle) * (t > enter[0] ? 1 : 0);
  robot.hover.position.y = 0.1 + 0.07 * Math.abs(Math.sin(t * 8.5)) * Math.max(walking, strolling) + (t > T.end ? 0.03 * Math.sin(t * 1.5 + side) : 0);
  robot.setGlow(1);
  const idleBlink = blinkAt(t, side > 0 ? 2.3 : 0.4);
  const entryBlink = pulse(t, side < 0 ? 5.9 : 6.2, 0.15);
  robot.setBlink(t > T.end ? idleBlink : entryBlink);
  const cheer = pulse(t, T.verdict + 0.15, 1);
  const push = 1 - settle;
  robot.pose('L', lerp(lerp(0.45, 0.12, push), 2.2, cheer), 1.45 * push);
  robot.pose('R', lerp(lerp(0.55, 0.12, push), 2.6, cheer), 1.45 * push);
  const watching = t > T.rogueDrop - 0.3 ? 1 : 0;
  robot.head.rotation.y = watching * headToward(robot, cube.x, Z) * 0.8 + (t > T.end ? 0.15 * Math.sin(t * 0.7 + side) : 0);

  crates.forEach(({ crate, slot, order }) => {
    const front = x + side * -1 * (1.35 + order * 1.2);
    const stopped = endX + side * -1 * (1.35 + order * 1.2);
    const glide = easeOut(span(t, enter[1], enter[1] + 0.9 + order * 0.12));
    const cx = t <= enter[1] ? front : lerp(stopped, slot, glide);
    crate.group.position.set(cx, 0, Z);
    crate.group.rotation.y = 0.05 * Math.sin(t * 7 + order) * (t < enter[1] + 0.6 ? 1 : 0) * (1 - glide);
  });
}

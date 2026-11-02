// The score: poses the whole cast, the props and the lights at film time t.
import { DIFF_SIZE } from './props.js';
import { PIECE } from './piece.js';
import { STAFF } from './stage.js';
import { conductorAt, walkerAt } from './cast.js';
import { T, SLOTS, REFUSING_PIECE, VERDICT_X, SPAWN_X, span, easeInOut, easeOut, easeIn, lerp, pulse, hops, blinkAt } from './timeline.js';

const Z = STAFF.z;
const REST = DIFF_SIZE / 2;
// The diff travels between the pieces' raised hands.
const HANDS = PIECE.catchY;
const PEDESTAL_TOP = 0.6 + REST;

// The unreviewed diff: dropped in, passed along, caught by AI review and thrown away.
function rogueAt(t, rogue, shock) {
  rogue.group.visible = t >= T.rogueDrop && t < T.rogueGone;
  if (t < T.rogueHops) {
    rogue.group.position.set(SPAWN_X, lerp(7, REST, easeIn(span(t, T.rogueDrop, T.rogueHops))), Z);
    rogue.mesh.rotation.set(0, 0, 0);
  } else if (t < T.refuse) {
    const points = [[SPAWN_X, REST], ...SLOTS.slice(0, REFUSING_PIECE + 1).map((x) => [x, HANDS])];
    const h = hops(points, T.rogueHops, T.rogueHop, t);
    rogue.group.position.set(h.x, h.y, Z);
    rogue.mesh.rotation.z = h.spin;
  } else if (t < T.throw) {
    // AI review holds it up and looks: no verdict.
    rogue.group.position.set(SLOTS[REFUSING_PIECE], HANDS + 0.05 * pulse(t, T.refuse, 0.2), Z);
    rogue.mesh.rotation.set(0, 0, 0);
  } else {
    const u = span(t, T.throw, T.rogueGone);
    rogue.group.position.set(lerp(SLOTS[REFUSING_PIECE], -3.4, u), lerp(HANDS, -1, u) + 1.4 * 4 * u * (1 - u), lerp(Z, 3.6, u));
    rogue.mesh.rotation.set(u * 7, u * 3, -u * 9);
  }
  rogue.setFade(1 - span(t, T.throw + 0.25, T.rogueGone));
  shock.material.opacity = 0.9 * (1 - span(t, T.throw, T.throw + 0.6)) * (t >= T.throw ? 1 : 0);
  shock.scale.setScalar(1 + 2.4 * easeOut(span(t, T.throw, T.throw + 0.6)));
}

function cubesAt(t, cast) {
  const { rogue, honest, pieces, verdict, shock } = cast;
  rogueAt(t, rogue, shock);

  // The reviewed diff.
  honest.group.visible = t >= T.honestDrop;
  const path = [[SPAWN_X, REST], ...SLOTS.map((x) => [x, HANDS]), [VERDICT_X, PEDESTAL_TOP]];
  let cubeX = SPAWN_X;
  if (t < T.honestHops) {
    honest.group.position.set(SPAWN_X, lerp(7, REST, easeIn(span(t, T.honestDrop, T.honestHops))), Z);
    honest.mesh.rotation.set(0, 0, 0);
    honest.mesh.scale.set(1, 1, 1);
  } else {
    const h = hops(path, T.honestHops, T.honestHop, t);
    honest.group.position.set(h.x, h.y - 0.08 * h.squash * REST, Z);
    honest.mesh.rotation.set(0, 0, h.spin);
    honest.mesh.scale.set(1 + 0.12 * h.squash, 1 - 0.18 * h.squash, 1 + 0.12 * h.squash);
    cubeX = h.x;
  }
  honest.setGreen(easeOut(span(t, T.verdict, T.verdict + 0.4)));

  // Lights: the rogue lights the first two, then they reset; the honest run lights all seven.
  // Each piece raises its hands as a diff comes near, and AI review holds the rogue until the throw.
  const near = (x, slot) => easeInOut(Math.max(0, 1 - Math.abs(x - slot) / 1.05));
  const rogueX = rogue.group.visible && t < T.throw ? rogue.group.position.x : Infinity;
  const honestX = honest.group.visible && t > T.honestHops && t < T.verdict ? honest.group.position.x : Infinity;
  pieces.forEach((piece, i) => {
    const rogueLand = T.rogueHops + (i + 1) * T.rogueHop;
    const byRogue = i < REFUSING_PIECE ? easeOut(span(t, rogueLand, rogueLand + 0.2)) * (1 - span(t, T.refuse + 0.3, T.refuse + 0.8)) : 0;
    const land = T.honestHops + (i + 1) * T.honestHop;
    const byHonest = easeOut(span(t, land, land + 0.25));
    const red = i === REFUSING_PIECE ? pulse(t, T.refuse, 0.95) : 0;
    piece.setLight(Math.max(byRogue, byHonest), red);
    if (t > T.end) piece.setLight(0.85 + 0.15 * Math.sin(t * 1.4 + i * 0.7));
    piece.catch(Math.max(near(rogueX, SLOTS[i]), near(honestX, SLOTS[i])));
  });

  // The verdict.
  verdict.group.visible = t > T.verdict - 1.15;
  verdict.group.position.y = lerp(-0.62, 0, easeOut(span(t, T.verdict - 0.95, T.verdict - 0.35)));
  const won = span(t, T.verdict, T.verdict + 0.5);
  verdict.glow.emissiveIntensity = 3.2 * easeOut(won) + (t > T.end ? 0.4 * Math.sin(t * 2) : 0);
  verdict.check.scale.setScalar(Math.max(0.0001, easeOut(won)));
  verdict.check.position.y = lerp(1.2, 1.75, easeOut(won)) + (t > T.end ? 0.06 * Math.sin(t * 1.8) : 0);
  verdict.check.rotation.y = t > T.verdict ? Math.sin((t - T.verdict) * 0.9) * 0.5 : 0;
  verdict.light.intensity = t < T.verdict ? 0 : 14 * Math.exp(-(t - T.verdict) * 2.2) + 4 * won;
  const waveU = span(t, T.verdict, T.verdict + 1.1);
  verdict.wave.scale.setScalar(1 + 3.5 * easeOut(waveU));
  verdict.wave.material.opacity = t >= T.verdict ? 0.9 * (1 - waveU) : 0;
  return cubeX;
}

/** Pose the whole cast at film time t. */
export function perform(t, cast, stage) {
  const cubeX = cubesAt(t, cast);
  // The baton beats on every landing: 0 right on a landing, rising to 1 before the next.
  const phase = (start, hop) => ((t - start) % hop) / hop;
  let beatSource = 1;
  if (t < T.refuse && t > T.rogueHops) beatSource = phase(T.rogueHops, T.rogueHop);
  else if (t >= T.refuse && t > T.honestHops && t < T.verdict) beatSource = phase(T.honestHops, T.honestHop);
  const beat = Math.exp(-beatSource * 5) * (t > T.rogueHops ? 1 : 0);
  conductorAt(t, cast, beat);
  const cube = { x: t > T.honestDrop ? cubeX : cast.rogue.group.position.x };
  // kaRAGan brings the left half of the pieces in from the left, kaWATCHan the right half from the right.
  const half = Math.ceil(SLOTS.length / 2);
  const pushed = (indices) => indices.map((i, order) => ({ piece: cast.pieces[i], slot: SLOTS[i], order }));
  const indices = [...SLOTS.keys()];
  walkerAt(t, cast.rag, -1, pushed(indices.slice(0, half)), cube);
  walkerAt(t, cast.watch, 1, pushed(indices.slice(half).toReversed()), cube);
  // atril turns to the next skill each time the reviewed diff reaches a piece.
  const landed = SLOTS.filter((_, i) => t >= T.honestHops + (i + 1) * T.honestHop).length;
  const lastLanding = T.honestHops + landed * T.honestHop;
  cast.stand.turnTo(landed, landed ? easeInOut(span(t, lastLanding, lastLanding + 0.3)) : 1);
  const look = Math.max(-1, Math.min(1, (cube.x - cast.stand.group.position.x) / 3));
  cast.stand.live(blinkAt(t, 1.7), look, pulse(t, T.verdict + 0.1, 1));
  // AI review shakes its head no while it holds the rogue.
  cast.pieces[REFUSING_PIECE].shake(pulse(t, T.refuse + 0.05, T.throw - T.refuse), t);
  stage.staff.group.children.forEach((line, i) => { line.scale.x = Math.max(0.0001, easeOut(span(t, 2.5 + i * 0.07, 3.9 + i * 0.07))); });
  const wingsUp = easeOut(span(t, 2.5, 3.2));
  stage.lightsAt({
    keyLevel: easeInOut(span(t, 0.15, 1.5)),
    washLevel: easeInOut(span(t, 2.4, 3.8)),
    wingLevel: wingsUp * lerp(1, 0.45, span(t, 6, 7)),
    ambient: lerp(0.25, 1, span(t, 2.4, 3.8)),
    time: t,
  });
  return cubeX;
}

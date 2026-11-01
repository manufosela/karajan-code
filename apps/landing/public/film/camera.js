// The camera: six shots cut together with eased blends. The shot that tracks
// the travelling diff follows its x; `wide` pulls every shot back on narrow screens.
// 'three' is the landing's trimmed bundle (public/lib/three.min.js): the core
// classes and the addons the film uses, all under one name (tests/landing/three-bundle.test.js).
import * as THREE from 'three';
import { STAFF } from './stage.js';
import { T, SLOTS, REFUSING_CRATE, span, easeInOut } from './timeline.js';

const Z = STAFF.z;
const v = (a) => new THREE.Vector3(...a);
const shotA = (t) => ({ pos: v([1.6, 3.5, 8.5]).lerp(v([0.6, 3.6, 6]), easeInOut(span(t, 0, 2.6))), look: v([0, 3.5, -2.2]) });
const shotB = (t) => ({ pos: v([0, 5.8, 22]).lerp(v([0, 6.2, 20.5]), easeInOut(span(t, 2.4, 5.8))), look: v([0, 1.4, 0]) });
const shotC = (t) => ({ pos: v([-8.8, 2.1, 6.6]).lerp(v([-7.8, 1.8, 5.8]), easeInOut(span(t, 5.6, T.refuse + 0.4))), look: v([(SLOTS[0] + SLOTS[REFUSING_CRATE]) / 2, 0.9, Z]) });
const shotD = (t, cubeX) => {
  const x = Math.max(-5.2, Math.min(4.4, cubeX));
  return { pos: v([x - 0.6, 2.8, 8.4]), look: v([x + 1.2, 0.9, Z]) };
};
const shotE = (t) => ({ pos: v([4, 2, 10.5]).lerp(v([3.7, 2.2, 11.2]), easeInOut(span(t, T.verdict - 0.8, T.verdict + 0.6))), look: v([3.6, 1.6, -0.5]) });
const shotF = () => ({ pos: v([2.2, 5, 19.5]), look: v([1.5, 1.7, -0.8]) });
const CUTS = [[0, shotA], [2.4, shotB, 1.4], [5.6, shotC, 0.9], [T.refuse + 0.4, shotD, 0.7], [T.verdict - 0.8, shotE, 0.7], [T.outro, shotF, 2]];

/** Camera position and target at film time t; `wide` widens every shot for narrow screens. */
export function cameraAt(t, cubeX, wide = 1) {
  let i = CUTS.findLastIndex(([t0]) => t >= t0);
  if (i < 0) i = 0;
  const [t0, shot, blend] = CUTS[i];
  const shotAt = (f) => {
    const s = f(t, cubeX);
    s.pos.sub(s.look).multiplyScalar(f === shotA || f === shotE ? Math.sqrt(wide) : wide).add(s.look);
    return s;
  };
  const current = shotAt(shot);
  if (i === 0 || t >= t0 + blend) return current;
  const previous = shotAt(CUTS[i - 1][1]);
  const k = easeInOut((t - t0) / blend);
  return { pos: previous.pos.lerp(current.pos, k), look: previous.look.lerp(current.look, k) };
}

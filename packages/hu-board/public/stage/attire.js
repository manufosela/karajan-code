// KJC-TSK-1538 (decided by the maintainer on 2026-11-11): a robot shows the model it runs on by
// what it wears on its head (Fable a mortarboard, Opus round glasses, Sonnet headphones, Haiku a
// cap) and its effort by its build (high strong, medium as it is, low slim). The film's robot is
// never changed (cast/ is a checked copy): the attire hangs from its head and scales its hover.
import * as THREE from 'three';
import { buildOf, familyOf } from './models.js';

const dark = () => new THREE.MeshStandardMaterial({ color: 0x1b1f27, roughness: 0.5 });
const mesh = (geometry, material, [x, y, z] = [0, 0, 0]) => {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(x, y, z);
  return m;
};

// The head is a sphere of 0.98 around its centre, its visor facing +z.
const ATTIRE = {
  fable: () => {
    const m = dark();
    const tassel = mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.45), new THREE.MeshStandardMaterial({ color: 0xf0b429 }), [0.5, 0.82, 0.5]);
    return [mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.3, 24), m, [0, 0.86, 0]), mesh(new THREE.BoxGeometry(1.2, 0.06, 1.2), m, [0, 1.04, 0]), tassel];
  },
  opus: () => {
    const m = dark();
    const lens = (x) => mesh(new THREE.TorusGeometry(0.24, 0.045, 10, 28), m, [x, 0.1, 0.97]);
    return [lens(-0.32), lens(0.32), mesh(new THREE.BoxGeometry(0.18, 0.05, 0.05), m, [0, 0.12, 0.99])];
  },
  sonnet: () => {
    const m = dark();
    const band = mesh(new THREE.TorusGeometry(1.03, 0.07, 10, 32, Math.PI), m, [0, 0, 0]);
    const cup = (x) => mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.22, 20), m, [x, 0, 0]);
    const [left, right] = [cup(-1.02), cup(1.02)];
    left.rotation.z = right.rotation.z = Math.PI / 2;
    return [band, left, right];
  },
  haiku: () => {
    const m = new THREE.MeshStandardMaterial({ color: 0x3a7bd5, roughness: 0.6 });
    const crown = mesh(new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2.6), m, [0, 0.12, 0]);
    const peak = mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.05, 24, 1, false, -Math.PI / 2, Math.PI), m, [0, 0.55, 0.62]);
    return [crown, peak];
  },
};

/** Dresses `robot` for `{ model, effort }`; dressing it again for the same ones changes nothing. */
export function dress(robot, { model, effort } = {}) {
  const family = familyOf(model);
  const key = `${family}:${buildOf(effort)}`;
  if (robot.attire?.key === key) return;
  if (robot.attire) robot.head.remove(robot.attire.group);
  const group = new THREE.Group();
  if (family) group.add(...ATTIRE[family]());
  robot.head.add(group);
  const build = buildOf(effort);
  robot.hover.scale.set(build, 1, build);
  robot.attire = { key, group };
}

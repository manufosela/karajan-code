// KJC-TSK-1604 (decided by the maintainer on 2026-11-13): the costumes costume.js names, as meshes.
// The film's robot is never changed (cast/ is a checked copy): the robe hangs from its hover and the
// crown sits on its head, as attire.js does for the models.
import * as THREE from 'three';
import { COSTUMES, costumeOf } from './costume.js';

const ROYAL = 0x5b2a86;
const GOLD = 0xd4af37;

/** A long robe, open at the top, from the floor to the chest, with a golden hem and collar. */
function robe() {
  const cloth = new THREE.MeshStandardMaterial({ color: ROYAL, roughness: 0.7, side: THREE.DoubleSide });
  const gold = new THREE.MeshStandardMaterial({ color: GOLD, metalness: 0.6, roughness: 0.3 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 1, 1.25, 28, 1, true), cloth);
  body.position.y = 0.62;
  const hem = new THREE.Mesh(new THREE.TorusGeometry(1, 0.05, 8, 40), gold);
  hem.rotation.x = Math.PI / 2;
  hem.position.y = 0.03;
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.06, 8, 40), gold);
  collar.rotation.x = Math.PI / 2;
  collar.position.y = 1.25;
  return [body, hem, collar];
}

/** A golden crown on the head (a sphere of 0.98 around its centre): a band and five points. */
function crown() {
  const gold = new THREE.MeshStandardMaterial({ color: GOLD, metalness: 0.7, roughness: 0.25, emissive: GOLD, emissiveIntensity: 0.15, side: THREE.DoubleSide });
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.58, 0.28, 28, 1, true), gold);
  band.position.y = 0.9;
  const points = Array.from({ length: 5 }, (_, i) => {
    const angle = (i / 5) * Math.PI * 2;
    const point = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.3, 10), gold);
    point.position.set(Math.sin(angle) * 0.6, 1.17, Math.cos(angle) * 0.6);
    return point;
  });
  return [band, ...points];
}

/** Dresses `robot` as `role` wears; nothing for a role without a costume. */
export function wear(robot, role) {
  const costume = costumeOf(role);
  if (!costume) return;
  const parts = COSTUMES[costume];
  if (parts.includes('robe')) robot.hover.add(...robe());
  if (parts.includes('crown')) robot.head.add(...crown());
}

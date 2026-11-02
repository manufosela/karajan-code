// The git gates as a stage gate with a padlock: it only opens for a verdict.
import * as THREE from 'three';
import { metalIn } from '../parts.js';

export function gatesBody() {
  const group = new THREE.Group();
  const iron = metalIn(0x3a4556);
  for (const x of [-0.36, 0.36]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.72, 0.07), iron);
    post.position.set(x, 0.36, 0);
    group.add(post);
  }
  for (const y of [0.08, 0.64]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.04, 0.04), iron);
    rail.position.y = y;
    group.add(rail);
  }
  for (let i = 0; i < 5; i++) {
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.56, 8), iron);
    bar.position.set(-0.24 + i * 0.12, 0.36, 0);
    group.add(bar);
  }
  const gold = metalIn(0xd4a24a);
  const lock = new THREE.Mesh(new THREE.RoundedBoxGeometry(0.15, 0.13, 0.06, 2, 0.02), gold);
  lock.position.set(0, 0.32, 0.05);
  const shackle = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.012, 8, 20, Math.PI), gold);
  shackle.position.set(0, 0.385, 0.05);
  group.add(lock, shackle);
  return { group, face: { y: 0.84, z: 0, width: 0.46 }, shoulders: { x: 0.4, y: 0.6, z: 0 } };
}

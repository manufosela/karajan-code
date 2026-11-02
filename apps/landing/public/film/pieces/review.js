// AI review as opera glasses on a handle: a different pair of eyes on every diff.
import * as THREE from 'three';
import { metalIn } from '../parts.js';

export function reviewBody() {
  const group = new THREE.Group();
  const gold = metalIn(0xd4a24a);
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.44, 10), gold);
  handle.position.y = 0.22;
  const lens = new THREE.MeshPhysicalMaterial({ color: 0x1d3b57, roughness: 0.05, metalness: 0.2, clearcoat: 1 });
  const body = metalIn(0x2a2233);
  for (const x of [-0.13, 0.13]) {
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.26, 28), body);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(x, 0.58, 0.04);
    const glass = new THREE.Mesh(new THREE.CircleGeometry(0.095, 28), lens);
    glass.position.set(x, 0.58, 0.172);
    group.add(barrel, glass);
  }
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.06, 0.14), gold);
  bridge.position.set(0, 0.58, 0.02);
  group.add(handle, bridge);
  return { group, face: { y: 0.86, z: 0, width: 0.42 }, shoulders: { x: 0.27, y: 0.6, z: 0 } };
}

// The Sentinel as a cymbal held up like a shield: it stops the blow as it lands.
import * as THREE from 'three';
import { metalIn } from '../parts.js';

export function sentinelBody() {
  const group = new THREE.Group();
  const brass = metalIn(0xd4a24a);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.36, 10), metalIn(0x3a4556));
  pole.position.y = 0.18;
  const cymbal = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.02, 48), brass);
  cymbal.rotation.x = Math.PI / 2;
  cymbal.position.y = 0.6;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.014, 8, 48), brass);
  rim.position.y = 0.6;
  group.add(pole, cymbal, rim);
  return { group, face: { y: 0.6, z: 0.05, width: 0.42 }, shoulders: { x: 0.36, y: 0.62, z: 0 } };
}

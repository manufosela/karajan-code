// SonarQube as a studio microphone with sound waves: it listens to the code.
import * as THREE from 'three';
import { metalIn } from '../parts.js';

export function sonarBody(look) {
  const group = new THREE.Group();
  const stand = metalIn(0x3a4556);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.36, 10), stand);
  pole.position.y = 0.18;
  const capsule = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 0.2, 6, 20), metalIn(0x9aa5b1));
  capsule.position.y = 0.6;
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.152, 0.018, 8, 32), stand);
  band.rotation.x = Math.PI / 2;
  band.position.y = 0.48;
  const wave = new THREE.MeshStandardMaterial({ color: look.glow, emissive: look.glow, emissiveIntensity: 0.8 });
  for (const [r, side] of [[0.27, 1], [0.36, 1], [0.27, -1], [0.36, -1]]) {
    const arc = new THREE.Mesh(new THREE.TorusGeometry(r, 0.012, 6, 24, 1.3), wave);
    arc.rotation.z = side > 0 ? -0.65 : Math.PI - 0.65;
    arc.position.set(0, 0.62, 0);
    group.add(arc);
  }
  group.add(pole, capsule, band);
  return { group, face: { y: 0.66, z: 0.15, width: 0.34 }, shoulders: { x: 0.16, y: 0.5, z: 0 } };
}

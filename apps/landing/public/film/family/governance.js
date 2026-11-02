// Governance, the kernel: a metronome, the beat everyone keeps, with the
// family's face on its front and its pendulum mid-swing. Rendered for the family page.
import * as THREE from 'three';
import { createArm, createFace, handWhite, metalIn } from '../parts.js';

const GOLD = 0xe8b04b;

export function createGovernance() {
  const group = new THREE.Group();
  const wood = metalIn(0x3b2a1c);
  const brass = metalIn(0xd4a24a);
  const white = handWhite();
  // A four-sided frustum turned to face the viewer with one flat side.
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.36, 0.95, 4, 1), wood);
  body.rotation.y = Math.PI / 4;
  body.position.y = 0.5;
  const base = new THREE.Mesh(new THREE.RoundedBoxGeometry(0.56, 0.08, 0.56, 2, 0.02), wood);
  base.position.y = 0.04;
  const pendulum = new THREE.Group();
  pendulum.position.set(0, 0.56, 0.18);
  pendulum.rotation.z = 0.38;
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.6, 8), brass);
  rod.position.y = 0.3;
  const weight = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.08, 6), brass);
  weight.position.y = 0.42;
  pendulum.add(rod, weight);
  const { face } = createFace(GOLD, 0.4);
  face.position.set(0, 0.34, 0.27);
  face.rotation.x = -0.23;
  const left = createArm(wood, white, 0.3);
  left.position.set(-0.2, 0.56, 0.08);
  left.rotation.z = -0.6;
  const right = createArm(wood, white, 0.3);
  right.position.set(0.2, 0.56, 0.08);
  right.rotation.z = 0.6;
  group.add(body, base, pendulum, face, left, right);
  return group;
}

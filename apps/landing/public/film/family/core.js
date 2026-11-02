// Core, the shared ground: a resonance box with a tuning fork on top, the note
// everyone tunes to, with the family's face on the box. Rendered for the family page.
import * as THREE from 'three';
import { createArm, createFace, createFeet, handWhite, metalIn } from '../parts.js';

const STEEL = 0x8cb4c9;

export function createCore() {
  const group = new THREE.Group();
  const wood = metalIn(0x55606e);
  const fork = metalIn(0xc8d0da);
  const white = handWhite();
  const box = new THREE.Mesh(new THREE.RoundedBoxGeometry(0.7, 0.42, 0.42, 3, 0.04), wood);
  box.position.y = 0.25;
  const hole = new THREE.Mesh(new THREE.CircleGeometry(0.05, 20), new THREE.MeshStandardMaterial({ color: 0x05080d }));
  hole.position.set(0.25, 0.25, 0.212);
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.22, 10), fork);
  stem.position.y = 0.57;
  // Half a torus bends the two tines into one fork.
  const bend = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.022, 10, 24, Math.PI), fork);
  bend.rotation.z = Math.PI;
  bend.position.y = 0.72;
  group.add(box, hole, stem, bend);
  for (const x of [-0.08, 0.08]) {
    const tine = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.42, 10), fork);
    tine.position.set(x, 0.93, 0);
    group.add(tine);
  }
  const { face } = createFace(STEEL, 0.42);
  face.position.set(-0.06, 0.27, 0.22);
  const left = createArm(wood, white, 0.28);
  left.position.set(-0.36, 0.36, 0.05);
  left.rotation.z = -0.4;
  const right = createArm(wood, white, 0.28);
  right.position.set(0.36, 0.36, 0.05);
  right.rotation.z = 2.6;
  group.add(face, left, right, ...createFeet(wood, 0.2));
  return group;
}

// Console, the admin: a small mixing desk on four legs, one fader lit, whose
// screen is the family's face. Rendered for the family page.
import * as THREE from 'three';
import { createArm, createFace, handWhite, metalIn } from '../parts.js';

const TEAL = 0x2dd4bf;
const FADERS = 5;

export function createConsole() {
  const group = new THREE.Group();
  const body = metalIn(0x24324a);
  const white = handWhite();
  const desk = new THREE.Mesh(new THREE.RoundedBoxGeometry(0.86, 0.12, 0.5, 3, 0.03), body);
  desk.position.y = 0.42;
  desk.rotation.x = 0.35;
  const cap = new THREE.MeshStandardMaterial({ color: 0xe6eaf0, roughness: 0.4 });
  const lit = new THREE.MeshStandardMaterial({ color: TEAL, emissive: TEAL, emissiveIntensity: 2.4 });
  const slot = new THREE.MeshStandardMaterial({ color: 0x0b1118, roughness: 0.5 });
  for (let i = 0; i < FADERS; i++) {
    const x = -0.3 + i * 0.15;
    const track = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.01, 0.26), slot);
    track.position.set(x, 0.065, 0.02);
    // The middle fader is the one in use: lit, like the glow of the eyes.
    const fader = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.04, 0.04), i === 2 ? lit : cap);
    fader.position.set(x, 0.085, -0.08 + ((i * 37) % 5) * 0.04);
    const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.03, 16), cap);
    knob.position.set(x, 0.075, 0.19);
    desk.add(track, fader, knob);
  }
  const { face } = createFace(TEAL, 0.52);
  face.position.set(0, 0.78, -0.18);
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.26, 10), body);
  stem.position.set(0, 0.6, -0.2);
  group.add(desk, face, stem);
  for (const [x, z] of [[-0.36, -0.16], [0.36, -0.16], [-0.36, 0.18], [0.36, 0.18]]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.38, 8), body);
    leg.position.set(x, 0.19, z);
    group.add(leg);
  }
  const left = createArm(body, white, 0.3);
  left.position.set(-0.45, 0.55, 0);
  left.rotation.z = -0.7;
  const right = createArm(body, white, 0.3);
  right.position.set(0.45, 0.55, 0);
  right.rotation.z = 0.9;
  group.add(left, right);
  return group;
}

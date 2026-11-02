// Radar, in the works: a dish on its mount, still under scaffolding with
// caution tape, with the family's face on the mount. Rendered for the family page.
import * as THREE from 'three';
import { createArm, createFace, createFeet, handWhite, metalIn } from '../parts.js';

const CORAL = 0xf87171;

// Yellow and black caution stripes.
function tapeTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 32;
  const g = c.getContext('2d');
  for (let i = 0; i < 16; i++) {
    g.fillStyle = i % 2 ? '#111111' : '#f5c518';
    g.beginPath();
    g.moveTo(i * 20, 32);
    g.lineTo(i * 20 + 16, 0);
    g.lineTo(i * 20 + 36, 0);
    g.lineTo(i * 20 + 20, 32);
    g.fill();
  }
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// Scaffolding beside the dish: four posts and three levels of rails.
function scaffold() {
  const group = new THREE.Group();
  const pipe = new THREE.MeshStandardMaterial({ color: 0xc9a227, roughness: 0.5 });
  const post = new THREE.CylinderGeometry(0.012, 0.012, 1, 6);
  const rail = new THREE.CylinderGeometry(0.012, 0.012, 0.26, 6);
  for (const z of [-0.18, 0.18]) {
    for (const x of [0.38, 0.62]) {
      const p = new THREE.Mesh(post, pipe);
      p.position.set(x, 0.5, z);
      group.add(p);
    }
    for (const y of [0.3, 0.65, 0.98]) {
      const r = new THREE.Mesh(rail, pipe);
      r.rotation.z = Math.PI / 2;
      r.position.set(0.5, y, z);
      group.add(r);
    }
  }
  const tape = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.04), new THREE.MeshStandardMaterial({ map: tapeTexture(), side: THREE.DoubleSide }));
  tape.position.set(0.5, 0.48, 0.19);
  group.add(tape);
  return group;
}

export function createRadar() {
  const group = new THREE.Group();
  const body = metalIn(0x3a4556);
  const white = handWhite();
  const base = new THREE.Mesh(new THREE.RoundedBoxGeometry(0.5, 0.36, 0.4, 3, 0.04), body);
  base.position.y = 0.2;
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.32, 10), body);
  mast.position.y = 0.52;
  // The dish is a shallow cap of a sphere, its back on the mast and its hollow
  // turned up toward the sky (AXIS); the feed and its lit tip sit on the axis.
  const AXIS = new THREE.Vector3(0, 0.5, 0.87);
  const back = new THREE.Vector3(0, 0.7, 0);
  const dish = new THREE.Mesh(
    new THREE.SphereGeometry(0.42, 32, 12, 0, Math.PI * 2, Math.PI - 0.75, 0.75),
    new THREE.MeshPhysicalMaterial({ color: 0xdfe5ec, roughness: 0.4, metalness: 0.3, side: THREE.DoubleSide }),
  );
  dish.rotation.x = Math.atan2(AXIS.z, AXIS.y);
  dish.position.copy(back).addScaledVector(AXIS, 0.42);
  const feed = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.3, 6), body);
  feed.rotation.x = dish.rotation.x;
  feed.position.copy(back).addScaledVector(AXIS, 0.15);
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 8), new THREE.MeshStandardMaterial({ color: CORAL, emissive: CORAL, emissiveIntensity: 2.4 }));
  tip.position.copy(back).addScaledVector(AXIS, 0.3);
  const { face } = createFace(CORAL, 0.38);
  face.position.set(0, 0.22, 0.21);
  const arm = createArm(body, white, 0.26);
  arm.position.set(-0.27, 0.3, 0.05);
  arm.rotation.z = -0.5;
  group.add(base, mast, dish, feed, tip, face, arm, scaffold(), ...createFeet(body, 0.14));
  return group;
}

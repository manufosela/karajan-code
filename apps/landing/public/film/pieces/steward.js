// The Steward as an hourglass: trust runs out, and it turns the glass to check again.
import * as THREE from 'three';
import { metalIn } from '../parts.js';

export function stewardBody() {
  const group = new THREE.Group();
  const wood = metalIn(0x3b2a1c);
  for (const y of [0.03, 0.75]) {
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.05, 32), wood);
    disc.position.y = y;
    group.add(disc);
  }
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + Math.PI / 6;
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.72, 8), wood);
    post.position.set(Math.sin(a) * 0.22, 0.39, Math.cos(a) * 0.22);
    group.add(post);
  }
  const glass = new THREE.MeshPhysicalMaterial({ color: 0xcfe8f5, roughness: 0.05, transparent: true, opacity: 0.35 });
  const top = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.34, 28, 1, true), glass);
  top.rotation.x = Math.PI;
  top.position.y = 0.56;
  const bottom = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.34, 28, 1, true), glass);
  bottom.position.y = 0.22;
  const sand = new THREE.MeshStandardMaterial({ color: 0xe8b04b, roughness: 0.8 });
  const pile = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.12, 24), sand);
  pile.position.y = 0.12;
  const left = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.1, 24), sand);
  left.rotation.x = Math.PI;
  left.position.y = 0.45;
  group.add(top, bottom, pile, left);
  return { group, face: { y: 0.92, z: 0, width: 0.42 }, shoulders: { x: 0.27, y: 0.5, z: 0 } };
}

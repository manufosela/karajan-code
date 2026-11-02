// The Ledger as a piano roll sealed with a chain: every note punched, none rewritten.
import * as THREE from 'three';
import { metalIn } from '../parts.js';

function rollTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 224;
  const g = c.getContext('2d');
  g.fillStyle = '#ece4cf';
  g.fillRect(0, 0, 256, 224);
  g.fillStyle = '#3b2f24';
  for (let row = 0; row < 9; row++) {
    for (let col = 0; col < 14; col++) {
      if ((row * 7 + col * 3) % 5 < 2) g.fillRect(14 + col * 17, 12 + row * 23, 9, 14);
    }
  }
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function ledgerBody() {
  const group = new THREE.Group();
  const wood = metalIn(0x3b2a1c);
  for (const x of [-0.38, 0.38]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.72, 8), wood);
    post.position.set(x, 0.36, -0.06);
    group.add(post);
  }
  const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.7, 24), new THREE.MeshStandardMaterial({ color: 0xe6dcc3, roughness: 0.8 }));
  roll.rotation.z = Math.PI / 2;
  roll.position.set(0, 0.66, -0.06);
  const paper = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.52), new THREE.MeshStandardMaterial({ map: rollTexture(), roughness: 0.9, side: THREE.DoubleSide }));
  paper.position.set(0, 0.36, 0.035);
  const gold = metalIn(0xd4a24a);
  for (let i = 0; i < 4; i++) {
    const link = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.009, 6, 14), gold);
    link.position.set(0.42, 0.6 - i * 0.065, 0.04);
    link.rotation.y = i % 2 ? Math.PI / 2 : 0;
    group.add(link);
  }
  const seal = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.02, 20), new THREE.MeshStandardMaterial({ color: 0xb91c1c, roughness: 0.5 }));
  seal.rotation.x = Math.PI / 2;
  seal.position.set(0.42, 0.33, 0.05);
  group.add(roll, paper, seal);
  return { group, face: { y: 0.88, z: -0.04, width: 0.42 }, shoulders: { x: 0.4, y: 0.62, z: -0.04 } };
}

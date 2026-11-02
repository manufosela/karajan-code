// Libretto, the stories (the HU Board): an open booklet on two feet that holds
// up one story card, with the family's face. Rendered for the family page.
import * as THREE from 'three';
import { createArm, createFace, createFeet, handWhite, metalIn } from '../parts.js';

const LILAC = 0xb69cf2;

// A page of lines, the stories, drawn on a canvas.
function linesTexture(aspect, paper, ink, rows) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = Math.round(256 / aspect);
  const g = c.getContext('2d');
  g.fillStyle = paper;
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = ink;
  for (let i = 0; i < rows; i++) g.fillRect(24, 30 + (i * (c.height - 50)) / rows, 160 + ((i * 53) % 50), 7);
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function createLibretto() {
  const group = new THREE.Group();
  const cover = metalIn(0x4c3a78);
  const white = handWhite();
  const page = new THREE.MeshStandardMaterial({ map: linesTexture(1 / 1.3, '#efe9da', '#7a6aa8', 7), roughness: 0.9 });
  for (const side of [-1, 1]) {
    const half = new THREE.Group();
    half.position.y = 0.36;
    half.rotation.y = side * 0.35;
    const board = new THREE.Mesh(new THREE.RoundedBoxGeometry(0.42, 0.56, 0.03, 2, 0.012), cover);
    board.position.x = side * 0.21;
    const sheet = new THREE.Mesh(new THREE.PlaneGeometry(0.38, 0.52), page);
    sheet.position.set(side * 0.21, 0, 0.018);
    half.add(board, sheet);
    group.add(half);
  }
  const { face } = createFace(LILAC, 0.44);
  face.position.set(0, 0.77, 0.06);
  const left = createArm(cover, white, 0.3);
  left.position.set(-0.33, 0.52, 0);
  left.rotation.z = -0.5;
  const right = createArm(cover, white, 0.3);
  right.position.set(0.33, 0.52, 0);
  right.rotation.z = 2.4;
  const card = new THREE.Mesh(
    new THREE.PlaneGeometry(0.22, 0.15),
    new THREE.MeshStandardMaterial({ map: linesTexture(1.4, '#ffffff', '#b69cf2', 3), roughness: 0.8 }),
  );
  card.position.set(0.58, 0.84, 0.06);
  card.rotation.z = -0.2;
  group.add(face, left, right, card, ...createFeet(cover, 0.12));
  return group;
}

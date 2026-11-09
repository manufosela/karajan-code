// KJC-TSK-1486: the laptop an agent opens at its bench, its screen lit in the
// agent's colour with lines of code, so a working robot is seen programming.
import * as THREE from 'three';

// One screen of code; the canvas holds it twice, one copy over the other (KJC-TSK-1493).
const SCREEN = { width: 256, height: 160 };

function screenTexture(accent) {
  const canvas = Object.assign(document.createElement('canvas'), { width: SCREEN.width, height: 2 * SCREEN.height });
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#0d1218';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = `#${accent.toString(16).padStart(6, '0')}`;
  // Indented lines of code of varied length, the same on every laptop.
  const lines = [[0, 150], [1, 120], [1, 170], [2, 90], [1, 60], [0, 40], [0, 130], [1, 100], [2, 70]];
  for (const top of [0, SCREEN.height]) {
    lines.forEach(([indent, width], i) => ctx.fillRect(18 + indent * 22, top + 9 + i * 17, width, 8));
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  // The screen shows one copy at a time; moving the offset scrolls the code (workers.codeScrollAt).
  texture.repeat.set(1, 0.5);
  texture.offset.set(0, 0.5);
  return texture;
}

/** A laptop in front of a robot (robot units, before scaling), keyboard at its hands. */
export function createLaptop(accent) {
  const laptop = new THREE.Group();
  const shellMat = new THREE.MeshStandardMaterial({ color: 0x2a3038, roughness: 0.5 });
  const base = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.05, 0.6), shellMat);
  const keys = new THREE.Mesh(new THREE.PlaneGeometry(1.15, 0.38), new THREE.MeshStandardMaterial({ color: 0x151a20, roughness: 0.8 }));
  keys.rotation.x = -Math.PI / 2;
  keys.position.set(0, 0.027, -0.05);
  const lid = new THREE.Group();
  lid.position.z = -0.3;
  lid.rotation.x = -0.25;
  const back = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.8, 0.04), shellMat);
  back.position.y = 0.4;
  const code = screenTexture(accent);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.18, 0.7), new THREE.MeshBasicMaterial({ map: code }));
  // The screen faces the robot, its back the camera; seen from behind, the lit
  // screen glows on the robot's visor and the lid shows which way it works.
  screen.position.set(0, 0.4, 0.021);
  lid.add(back, screen);
  laptop.add(base, keys, lid);
  // Floating at the height of the typing hands, just in front of the body.
  laptop.position.set(0, 0.62, 1.05);
  laptop.rotation.y = Math.PI;
  /** KJC-TSK-1493: scrolls the code to `offset` (workers.codeScrollAt). */
  laptop.userData.scroll = (offset) => { code.offset.y = offset; };
  return laptop;
}

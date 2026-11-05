// ADR 0047: kj stage is a factory hall in real 3D, seen from a high camera at
// three quarters: the floor, the conveyor line and the light. Where everything
// stands is in layout.js.
import * as THREE from 'three';
import { LINE } from './layout.js';

const matte = (color, roughness = 0.85) => new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.1 });

const FLOOR = { width: 64, depth: 40, px: 32 };

/** The floor tiles and their seams, one per metre (the trimmed bundle has no GridHelper nor RepeatWrapping). */
function tileTexture() {
  const canvas = Object.assign(document.createElement('canvas'), { width: FLOOR.width * FLOOR.px, height: FLOOR.depth * FLOOR.px });
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#1b2430';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#2a3a4e';
  ctx.lineWidth = 2;
  for (let x = 0; x <= canvas.width; x += FLOOR.px) ctx.strokeRect(x, 0, 0, canvas.height);
  for (let y = 0; y <= canvas.height; y += FLOOR.px) ctx.strokeRect(0, y, canvas.width, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createFloor() {
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(FLOOR.width, FLOOR.depth), new THREE.MeshStandardMaterial({ map: tileTexture(), roughness: 0.85 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  return floor;
}

function createLine() {
  const line = new THREE.Group();
  const length = LINE.to - LINE.from;
  const frame = new THREE.Mesh(new THREE.BoxGeometry(length, LINE.height, LINE.width), matte(0x3a4656, 0.6));
  frame.position.y = LINE.height / 2;
  const belt = new THREE.Mesh(new THREE.BoxGeometry(length, 0.04, LINE.width * 0.86), matte(0x0d1117, 0.95));
  belt.position.y = LINE.height + 0.02;
  line.add(frame, belt);
  for (let x = LINE.from + 0.4; x < LINE.to; x += 0.8) {
    const roller = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, LINE.width * 1.04, 10), matte(0x8a96a3, 0.4));
    roller.rotation.x = Math.PI / 2;
    roller.position.set(x, LINE.height - 0.06, 0);
    line.add(roller);
  }
  line.position.set((LINE.from + LINE.to) / 2, 0, LINE.z);
  line.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return line;
}

function createLights() {
  const sky = new THREE.HemisphereLight(0xcfe3f0, 0x10161f, 0.9);
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(-6, 14, 9);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 9, bottom: -9 });
  return [sky, sun];
}

/** Builds the hall in a new scene and returns it with its camera. */
export function createFactory(renderer) {
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0f1520);
  scene.add(createFloor(), createLine(), ...createLights());
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 120);
  camera.position.set(0, 18, 19);
  const target = new THREE.Vector3(0, 0, -0.8);
  camera.lookAt(target);
  return { scene, camera, target };
}

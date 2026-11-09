// ADR 0047, 0048: kj stage is a factory hall in real 3D, seen from a high camera
// at three quarters: the floor, the Sentinel's raised post and the light. The
// workshops are in hall.js; where everything stands is in layout.js.
import * as THREE from 'three';
import { populate } from './crew.js';
import { createHall } from './hall.js';
import { SENTINEL_POST } from './layout.js';
import { createWall } from './wall.js';

const matte = (color, roughness = 0.85) => new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.1 });

// KJC-TSK-1488: deep enough for several rows of workshops in front of the posts.
const FLOOR = { width: 80, depth: 64, px: 32 };
const FOV = 36;

/** The floor tiles and their seams, one per metre (the trimmed bundle has no GridHelper nor RepeatWrapping). */
function tileTexture(width, depth) {
  const canvas = Object.assign(document.createElement('canvas'), { width: width * FLOOR.px, height: depth * FLOOR.px });
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

/** A tiled floor; the map lays one as big as each hall under it (KJC-TSK-1452, 1454). */
export function createFloor(width = FLOOR.width, depth = FLOOR.depth) {
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), new THREE.MeshStandardMaterial({ map: tileTexture(width, depth), roughness: 0.85 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  return floor;
}

/** The Sentinel's raised post, over the whole hall (ADR 0048). */
function createTower() {
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, SENTINEL_POST.height, 16), matte(0x3a4656, 0.6));
  tower.position.set(SENTINEL_POST.x, SENTINEL_POST.height / 2, SENTINEL_POST.z);
  tower.castShadow = true;
  tower.receiveShadow = true;
  return tower;
}

function createLights() {
  const sky = new THREE.HemisphereLight(0xcfe3f0, 0x10161f, 0.9);
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(-6, 14, 9);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 14, bottom: -14 });
  return [sky, sun];
}

/**
 * KJC-TSK-1447 (ADR 0049): one factory mounted on `parent` (the scene, or a group the
 * map places): the Sentinel's tower, Karajan's crew and one workshop per lane.
 */
export function buildFactory(parent, lanes) {
  parent.add(createTower());
  // KJC-TSK-1459 (ADR 0050): and its task board wall.
  return { ...populate(parent), hall: createHall(parent, lanes), wall: createWall(parent) };
}

/**
 * Builds the light (and one floor) in a new scene and returns it with its camera. The map
 * lays its own floors and sees much further, without shadows (KJC-TSK-1452).
 */
export function createFactory(renderer, { floor = true, far = 300 } = {}) {
  renderer.shadowMap.enabled = floor;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0f1520);
  scene.add(...createLights());
  if (floor) scene.add(createFloor());
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, far);
  const target = new THREE.Vector3(0, 0, -0.6);
  return { scene, camera, target };
}

/** Where the camera sits, at three quarters, to fit a hall `width` metres wide on a screen of `aspect`. */
export function framing(width, aspect) {
  // Far enough that half the hall plus a margin fits half the view's width; never
  // closer than what fits its depth (about 13 m, from the door to the nameplates).
  // The trimmed bundle has no MathUtils.
  const halfView = Math.tan((FOV / 2) * (Math.PI / 180)) * aspect;
  const distance = Math.max(22, ((width / 2 + 2) / halfView) * 1.1);
  return new THREE.Vector3(0, distance * 0.7, distance * 0.72);
}

// KJC-TSK-1663 (asked by the maintainer on 2026-11-17): the coffee cart robot, in warm brown, pushing a
// cart with a wooden tray and a cup on it; and the cup a waiting host holds.
import * as THREE from 'three';
import { createRobot } from './robot.js';

const COFFEE = 0x9a6b45;
const matte = (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.7 });

// KJC-BUG-0637 (the maintainer, 2026-11-18): "it looks like a red button, more than a cup". A cup
// reads by its shape: a handle, a saucer, the coffee inside and its steam; a brown band sets it apart
// from the white robot that holds it.
const CUP = 0xf7f2ea;
const BAND = 0x8a5a32;
const STEAM = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false });

/** A wisp of steam: a thin wavy line rising from the coffee. */
function wisp(x, phase) {
  const points = Array.from({ length: 8 }, (_, i) => new THREE.Vector3(x + 0.05 * Math.sin(phase + i * 0.9), 0.24 + i * 0.07, 0));
  return new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 16, 0.018, 6), STEAM);
}

/** A cup of coffee on its saucer: white, with a handle, a brown band, the coffee inside and steam. */
export function createCup() {
  const cup = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.18, 0.4, 20), matte(CUP));
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.245, 0.215, 0.12, 20), matte(BAND));
  const coffee = new THREE.Mesh(new THREE.CircleGeometry(0.22, 20), matte(0x3b2314));
  coffee.rotation.x = -Math.PI / 2;
  coffee.position.y = 0.19;
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.03, 8, 16), matte(CUP));
  handle.position.x = 0.26;
  const saucer = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.3, 0.04, 24), matte(CUP));
  saucer.position.y = -0.21;
  cup.add(body, band, coffee, handle, saucer, wisp(-0.07, 0), wisp(0.07, 2));
  return cup;
}

/** The robot with its cart before it, and the cup on the cart's tray. */
export function createCoffeeCart() {
  const robot = createRobot({ accent: COFFEE, name: 'coffee' });
  const cart = new THREE.Group();
  const tray = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.12, 0.9), matte(0x7a4e2c));
  tray.position.y = 1.4;
  const stand = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.3, 0.5), matte(0x8a96a6));
  stand.position.y = 0.7;
  const cup = createCup();
  cup.position.y = 1.68;
  cart.add(tray, stand, cup);
  cart.position.z = 1.3;
  robot.hover.add(cart);
  return { ...robot, cup };
}

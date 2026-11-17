// KJC-TSK-1663 (asked by the maintainer on 2026-11-17): the coffee cart robot, in warm brown, pushing a
// cart with a wooden tray and a cup on it; and the cup a waiting host holds.
import * as THREE from 'three';
import { createRobot } from './robot.js';

const COFFEE = 0x9a6b45;
const matte = (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.7 });

/** A red mug with coffee in it: red, to stand out against a white robot. */
export function createCup() {
  const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.2, 0.44, 16), matte(0xd23c32));
  const coffee = new THREE.Mesh(new THREE.CircleGeometry(0.23, 16), matte(0x3b2314));
  coffee.rotation.x = -Math.PI / 2;
  coffee.position.y = 0.2;
  cup.add(coffee);
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

// KJC-TSK-1663 (asked by the maintainer on 2026-11-17): the coffee cart where coffee.js puts it, a robot
// in warm brown pushing a cart with a cup on its tray, teleporting in a beam at the booth.
import * as THREE from 'three';
import { BEAM_GEOMETRY, BEAM_HEIGHT, dispose } from './agents-floor.js';
import { createRobot } from './cast/robot.js';
import { cartAt, withCoffee } from './coffee.js';
import { SCALE } from './layout.js';
import { teleportLook } from './teleport.js';

const COFFEE = 0x9a6b45;
const matte = (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.7 });

/** The robot with its cart before it, and the cup on the cart's tray. */
function cartRobot() {
  const robot = createRobot({ accent: COFFEE, name: 'coffee' });
  const cart = new THREE.Group();
  const tray = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.12, 0.9), matte(0x7a4e2c));
  tray.position.y = 1.4;
  cart.add(tray);
  const stand = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.3, 0.5), matte(0x8a96a6));
  stand.position.y = 0.7;
  cart.add(stand);
  const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.2, 0.44, 16), matte(0xffffff));
  cup.position.y = 1.64;
  cart.add(cup);
  cart.position.z = 1.3;
  robot.hover.add(cart);
  return { ...robot, cup };
}

/** The carts mounted on `scene`: `update(hosts, now)` as the hosts wait or work, `frame(now, door)` every frame. */
export function createCoffeeFloor(scene) {
  let trips = [];
  const robots = new Map();
  const beamOf = () => new THREE.Mesh(BEAM_GEOMETRY, new THREE.MeshBasicMaterial({ color: 0x9fe3ff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
  const drop = (key) => {
    const robot = robots.get(key);
    scene.remove(robot.root, robot.beam);
    robot.beam.material.dispose();
    dispose(robot);
    robots.delete(key);
  };
  return {
    /** `hosts`: { key, waiting, spot } of every host at work, as the floor has them now. */
    update(hosts, now) { trips = withCoffee(trips, hosts, now); },
    frame(now, door) {
      const seen = new Set();
      for (const trip of trips) {
        const pose = cartAt(trip, now, door);
        if (!pose) continue;
        const key = `${trip.host}@${trip.at}`;
        seen.add(key);
        if (!robots.has(key)) {
          robots.set(key, { ...cartRobot(), beam: beamOf() });
          scene.add(robots.get(key).root, robots.get(key).beam);
        }
        const robot = robots.get(key);
        const look = teleportLook(pose.size);
        robot.root.position.set(pose.x, 0, pose.z);
        robot.root.rotation.y = pose.yaw;
        robot.root.scale.set(SCALE.crew * look.across, SCALE.crew * look.up, SCALE.crew * look.across);
        robot.beam.visible = look.beam > 0;
        robot.beam.material.opacity = 0.45 * look.beam;
        robot.beam.position.set(pose.x, BEAM_HEIGHT / 2, pose.z);
        robot.hover.position.y = 0.1 + (pose.walking ? 0.06 * Math.abs(Math.sin(now / 110)) : 0);
        robot.cup.visible = pose.cup;
      }
      // Deleting the entry being visited is safe while iterating a Map.
      for (const key of robots.keys()) if (!seen.has(key)) drop(key);
    },
  };
}

// KJC-TSK-1663 (asked by the maintainer on 2026-11-17): the coffee cart where coffee.js puts it, a robot
// in warm brown pushing a cart with a cup on its tray, teleporting in a beam at the booth.
import * as THREE from 'three';
import { BEAM_GEOMETRY, BEAM_HEIGHT, dispose } from './agents-floor.js';
import { avoidance } from './avoid.js';
import { createCoffeeCart } from './cast/coffee-cart.js';
import { cartAt, hasCup, withCoffee } from './coffee.js';
import { SCALE } from './layout.js';
import { teleportLook } from './teleport.js';

/** The carts mounted on `scene`: `update(hosts, now)` as the hosts wait or work, `frame(now, door)` every frame. */
export function createCoffeeFloor(scene) {
  let trips = [];
  let obstacles = []; // KJC-TSK-1660: nobody crashes, the cart included
  let bodies = [];
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
    /** Whether the host `key` holds its cup at `now`. */
    holds: (key, now) => hasCup(trips, key, now),
    /** KJC-TSK-1660: the other groups' robots, which the carts step aside from on the next frame. */
    avoid(others) { obstacles = others; },
    /** KJC-TSK-1660: where the carts stood on the last frame. */
    bodies: () => bodies,
    frame(now, door) {
      const seen = new Set();
      const posed = trips.map((trip) => ({ trip, pose: cartAt(trip, now, door) })).filter((p) => p.pose);
      const offsets = avoidance(posed.map((p) => p.pose), obstacles);
      posed.forEach((p, i) => { p.pose = { ...p.pose, x: p.pose.x + offsets[i].dx, z: p.pose.z + offsets[i].dz }; });
      bodies = posed.map(({ pose: { x, z, yaw, walking } }) => ({ x, z, yaw, walking }));
      for (const { trip, pose } of posed) {
        const key = `${trip.host}@${trip.at}`;
        seen.add(key);
        if (!robots.has(key)) {
          robots.set(key, { ...createCoffeeCart(), beam: beamOf() });
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

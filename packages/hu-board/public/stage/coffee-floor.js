// KJC-TSK-1663 (asked by the maintainer on 2026-11-17): the coffee cart where coffee.js puts it, a robot
// in warm brown pushing a cart with a cup on its tray, teleporting in a beam at the booth.
import * as THREE from 'three';
import { BEAM_GEOMETRY, BEAM_HEIGHT, dispose } from './agents-floor.js';
import { avoidance } from './avoid.js';
import { createCoffeeCart, createCup } from './cast/coffee-cart.js';
import { cartAt, cupOnDesk, hasCup, waitsSince, withCoffee } from './coffee.js';
import { SCALE } from './layout.js';
import { teleportLook } from './teleport.js';

/** KJC-TSK-1813: how big a cup left on a desk is, and how far below its centre its saucer is (cast/coffee-cart.js). */
const DESK_CUP = SCALE.crew * 1.2;
const SAUCER_DROP = 0.23;

/** The carts mounted on `scene`: `update(hosts, now)` as the hosts wait or work, `frame(now, door)` every frame. */
export function createCoffeeFloor(scene) {
  let trips = [];
  let since = {};
  let seated = [];
  const deskCups = new Map(); // KJC-TSK-1813: the cups left on desks, by host
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
    /** `hosts`: { key, waiting, spot } of every host at its desk, as the floor has them now. */
    update(hosts, now) {
      // KJC-TSK-1813: when each began to wait, so the cart comes only to a wait that lasts.
      since = waitsSince(since, hosts, now);
      seated = hosts.map((h) => ({ ...h, since: since[h.key] }));
      trips = withCoffee(trips, seated, now);
    },
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
      // KJC-TSK-1813: a host that works again left its cup on its desk; it stays there until the cart takes it.
      const onDesk = cupOnDesk(trips, seated, now);
      for (const { host, x, y, z } of onDesk) {
        if (!deskCups.has(host)) {
          const cup = createCup();
          cup.scale.setScalar(DESK_CUP);
          deskCups.set(host, cup);
          scene.add(cup);
        }
        deskCups.get(host).position.set(x, y + SAUCER_DROP * DESK_CUP, z); // its saucer on the desk top
      }
      const kept = new Set(onDesk.map((c) => c.host));
      for (const [host, cup] of deskCups) {
        if (kept.has(host)) continue;
        scene.remove(cup);
        dispose({ root: cup });
        deskCups.delete(host);
      }
    },
  };
}

// KJC-TSK-1461 (ADR 0050): the robots that carry the cards. One per errand, with the
// card's note over its head while it holds it; it leaves when the errand ends.
// courier.js says where each one is.
import * as THREE from 'three';
import { createRobot } from './cast/robot.js';
import { dispose } from './agents-floor.js';
import { SCALE } from './layout.js';
import { courierAt, tripFor } from './courier.js';

const COURIER = 0x8fa3b8; // a plain grey-blue: it is Karajan's errand robot, not an agent
const NOTE_OVER = 4.2; // metres over the robot's feet before scaling: above its helmet

/** The card's note, its id painted on it, as the wall shows it (bench-notes.js puts it on the benches too). */
export function cardNote(id) {
  const canvas = Object.assign(document.createElement('canvas'), { width: 256, height: 160 });
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#f0d58c';
  ctx.fillRect(0, 0, 256, 160);
  ctx.fillStyle = '#10161f';
  ctx.font = '700 56px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(id.slice(0, 9), 128, 80);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1), new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide }));
}

function courierFor(trip) {
  const robot = createRobot({ accent: COURIER, name: 'courier' });
  robot.root.scale.setScalar(SCALE.crew);
  const card = cardNote(trip.id);
  card.position.y = NOTE_OVER;
  robot.hover.add(card);
  return { robot, card };
}

/** The errand robots of one factory, mounted on `scene` (the factory's group on the map). */
export function createCouriers(scene) {
  let trips = [];
  const couriers = new Map();
  const leave = (key) => {
    const gone = couriers.get(key);
    scene.remove(gone.robot.root);
    dispose(gone.robot);
    couriers.delete(key);
  };
  return {
    /** A `card` event at `now` may send a robot on an errand. */
    push(event, now) {
      const trip = tripFor(event, now);
      if (trip) trips = [...trips, trip];
    },
    /** KJC-TSK-1462: the cards a robot is still carrying, not on their bench yet. */
    carried: () => new Set(trips.map((trip) => trip.id)),
    /** Moves every robot on an errand at `now`; `xOf(lane)`, `zOf(lane)`: the centre of a lane's workshop. */
    frame(now, xOf, zOf) {
      for (const trip of trips) {
        const key = `${trip.id}@${trip.at}`;
        const pose = courierAt(trip, now, xOf, zOf);
        if (!pose) {
          if (couriers.has(key)) leave(key);
          continue;
        }
        if (!couriers.has(key)) {
          couriers.set(key, courierFor(trip));
          scene.add(couriers.get(key).robot.root);
        }
        const { robot, card } = couriers.get(key);
        robot.root.position.set(pose.x, 0, pose.z);
        robot.root.rotation.y = pose.yaw;
        robot.hover.position.y = 0.1 + (pose.walking ? 0.06 * Math.abs(Math.sin(now / 110)) : 0);
        card.visible = pose.holding;
      }
      trips = trips.filter((trip) => courierAt(trip, now, xOf, zOf) !== null);
    },
  };
}

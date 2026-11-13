// KJC-TSK-1431 (decided by the maintainer on 2026-11-05): the agents kj launches
// on the factory floor, each a robot of its own colour with its name over its
// head. KJC-TSK-1435: the host too, with its badge and the tool it uses, and its
// subagents as dwarfs. workers.js says where each one is; this puts its robot there.
import * as THREE from 'three';
import { createRobot } from './cast/robot.js';
import { SCALE } from './layout.js';
import { tagAt } from './screen.js';
import { createLaptop } from './laptop.js';
import { dress } from './attire.js';
import { accentFor, avatarFor } from './avatars.js';
import { carry } from './backpack.js';
import { TYPING_YAW, accentOf, codeScrollAt, labelOf, typingAt, visitKey, withActivity, workerAt, workersFrom } from './workers.js';

// The robot is 3.5 m tall before scaling; a subagent is a dwarf (KJC-TSK-1435).
const DWARF = 0.55;
const scaleOf = (worker) => SCALE.crew * (worker.role === 'subagent' ? DWARF : 1);

/** KJC-TSK-1435 (ADR 0048): the host's name in its colour on its chest. Never a third-party logo. */
function badge(name, accent) {
  const canvas = Object.assign(document.createElement('canvas'), { width: 256, height: 96 });
  const ctx = canvas.getContext('2d');
  const colour = `#${accent.toString(16).padStart(6, '0')}`;
  ctx.fillStyle = '#10161f';
  ctx.fillRect(0, 0, 256, 96);
  ctx.strokeStyle = colour;
  ctx.lineWidth = 10;
  ctx.strokeRect(5, 5, 246, 86);
  ctx.fillStyle = colour;
  ctx.font = '700 54px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(name.slice(0, 8), 128, 50);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.3), new THREE.MeshBasicMaterial({ map: texture }));
  // Just in front of the body (0.8 m of radius at that height), tilted up towards the camera.
  plate.position.set(0, 0.92, 0.9);
  plate.rotation.x = -0.35;
  return plate;
}

/** A robot that left frees what it holds on the GPU: each one has its own geometry (couriers.js too). */
export function dispose(robot) {
  robot.root.traverse((o) => { o.geometry?.dispose(); o.material?.map?.dispose(); o.material?.dispose?.(); });
}

function robotFor(worker, avatar) {
  // KJC-TSK-1569 (ADR 0056): in the colour its owner gave its role, with its owner's backpack.
  const robot = createRobot({ accent: accentFor(worker, avatar), name: worker.agent });
  carry(robot, avatar?.emblem ?? null);
  if (worker.role === 'host') robot.hover.add(badge(worker.agent, accentOf(worker.agent)));
  robot.root.scale.setScalar(scaleOf(worker));
  return robot;
}

// KJC-TSK-1486: typing, the hands come in towards the keyboard and the agent
// turns side on to the camera, which sees its hands on the keys and its lit screen.
const TYPING = { spread: -0.25, yaw: TYPING_YAW };

/**
 * KJC-TSK-1486: typing, a robot opens its laptop in its `accent` and types, `elapsed` ms since
 * it began; otherwise it puts it away. KJC-TSK-1522: kaRAGan types with it too.
 */
export function typeOn(robot, { typing, elapsed, yaw, accent }) {
  if (typing && !robot.laptop) {
    robot.laptop = createLaptop(accent);
    robot.hover.add(robot.laptop);
  }
  if (robot.laptop) robot.laptop.visible = typing;
  if (typing) robot.laptop.userData.scroll(codeScrollAt(elapsed)); // KJC-TSK-1493
  // The baton the family robot holds stays in its hand only while it walks.
  for (const held of robot.armR.hand.children) held.visible = !typing;
  // Each robot types at its own pace, from the moment it arrived.
  const hands = typing ? typingAt(elapsed) : { L: 0, R: 0 };
  robot.pose('L', typing ? TYPING.spread : 0, hands.L);
  robot.pose('R', typing ? TYPING.spread : 0, hands.R);
  if (typing) robot.root.rotation.y = yaw + TYPING.yaw;
}

/** KJC-TSK-1486: at its spot the agent opens its laptop and types; walking, it puts it away. */
const work = (robot, worker, pose, t) =>
  typeOn(robot, { typing: !pose.walking, elapsed: t - worker.since, yaw: pose.yaw, accent: accentOf(worker.agent) });

/** `lanes` is [{lane, working}] of the last state; `xOf(lane)`, `zOf(lane)`: the centre of a lane's workshop. */
export function createAgentsFloor({ scene, camera, xOf, zOf, origin, avatar = null }, lanes, now) {
  let own = avatar; // KJC-TSK-1569: this person's avatar, which their robots wear
  let workers = lanes.flatMap(({ lane, working }) => workersFrom(working, now, lane));
  const robots = new Map();
  return {
    push(event, at) { workers = withActivity(workers, event, at); },
    /** KJC-TSK-1569: a new own avatar; every robot is built again, in it, on the next frame. */
    setAvatar(next) {
      own = next;
      for (const robot of robots.values()) { scene.remove(robot.root); dispose(robot); }
      robots.clear();
    },
    /** Moves every agent's robot; returns their name tags. */
    frame(t) {
      const tags = [];
      for (const worker of workers) {
        const pose = workerAt(worker, t, xOf, zOf);
        const key = visitKey(worker);
        let robot = robots.get(key);
        if (!pose) {
          if (robot) { scene.remove(robot.root); dispose(robot); robots.delete(key); }
          continue;
        }
        if (!robot) {
          robot = robotFor(worker, avatarFor(worker, own));
          scene.add(robot.root);
          robots.set(key, robot);
        }
        robot.root.position.set(pose.x, 0, pose.z);
        robot.root.rotation.y = pose.yaw;
        robot.hover.position.y = 0.1 + (pose.walking ? 0.06 * Math.abs(Math.sin(t / 110)) : 0);
        work(robot, worker, pose, t);
        dress(robot, worker); // KJC-TSK-1538: its model's accessory and its effort's build
        // Just above the helmet, so the label never sits on it.
        const head = robot.root.position.clone().setY(3.6 * scaleOf(worker));
        tags.push(tagAt(labelOf(worker), head, camera, { className: 'stage-worker', origin }));
      }
      workers = workers.filter((w) => workerAt(w, t, xOf, zOf) !== null);
      return tags;
    },
  };
}

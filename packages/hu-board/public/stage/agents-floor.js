// KJC-TSK-1431 (decided by the maintainer on 2026-11-05): the agents kj launches
// on the factory floor, each a robot of its own colour with its name over its
// head. KJC-TSK-1435: the host too, with its badge and the tool it uses, and its
// subagents as dwarfs. workers.js says where each one is; this puts its robot there.
import * as THREE from 'three';
import { createRobot } from './cast/robot.js';
import { SCALE } from './layout.js';
import { accentOf, labelOf, visitKey, withActivity, workerAt, workersFrom } from './workers.js';

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

/** The worker's label over its robot, placed in screen space. */
function nameTag(name, position, camera, height) {
  const at = position.clone().setY(height).project(camera);
  const tag = Object.assign(document.createElement('span'), { textContent: name, className: 'stage-worker' });
  tag.style.left = `${((at.x + 1) / 2) * innerWidth}px`;
  tag.style.top = `${((1 - at.y) / 2) * innerHeight}px`;
  return tag;
}

/** A robot that left frees what it holds on the GPU: each one has its own geometry. */
function dispose(robot) {
  robot.root.traverse((o) => { o.geometry?.dispose(); o.material?.map?.dispose(); o.material?.dispose?.(); });
}

function robotFor(worker) {
  const robot = createRobot({ accent: accentOf(worker.agent), name: worker.agent });
  if (worker.role === 'host') robot.hover.add(badge(worker.agent, accentOf(worker.agent)));
  robot.root.scale.setScalar(scaleOf(worker));
  return robot;
}

/** `lanes` is [{lane, working}] of the last state; `xOf(lane)` the centre of a lane's workshop. */
export function createAgentsFloor({ scene, camera, xOf }, lanes, now) {
  let workers = lanes.flatMap(({ lane, working }) => workersFrom(working, now, lane));
  const robots = new Map();
  return {
    push(event, at) { workers = withActivity(workers, event, at); },
    /** Moves every agent's robot; returns their name tags. */
    frame(t) {
      const tags = [];
      for (const worker of workers) {
        const pose = workerAt(worker, t, xOf);
        const key = visitKey(worker);
        let robot = robots.get(key);
        if (!pose) {
          if (robot) { scene.remove(robot.root); dispose(robot); robots.delete(key); }
          continue;
        }
        if (!robot) {
          robot = robotFor(worker);
          scene.add(robot.root);
          robots.set(key, robot);
        }
        robot.root.position.set(pose.x, 0, pose.z);
        robot.root.rotation.y = pose.yaw;
        robot.hover.position.y = 0.1 + (pose.walking ? 0.06 * Math.abs(Math.sin(t / 110)) : 0);
        // Just above the helmet, so the label never sits on it.
        tags.push(nameTag(labelOf(worker), robot.root.position, camera, 3.6 * scaleOf(worker)));
      }
      workers = workers.filter((w) => workerAt(w, t, xOf) !== null);
      return tags;
    },
  };
}

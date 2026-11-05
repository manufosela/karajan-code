// KJC-TSK-1431 (decided by the maintainer on 2026-11-05): the agents kj launches
// on the factory floor, each a robot of its own colour with its name over its
// head. workers.js says where each one is; this puts its robot there.
import { createRobot } from './cast/robot.js';
import { SCALE } from './layout.js';
import { accentOf, visitKey, withActivity, workerAt, workersFrom } from './workers.js';

// Just above the helmet, so the name never sits on it.
const HEAD_Y = 2.5;

/** The agent's name over its robot, placed in screen space. */
function nameTag(name, position, camera) {
  const at = position.clone().setY(HEAD_Y).project(camera);
  const tag = Object.assign(document.createElement('span'), { textContent: name, className: 'stage-worker' });
  tag.style.left = `${((at.x + 1) / 2) * innerWidth}px`;
  tag.style.top = `${((1 - at.y) / 2) * innerHeight}px`;
  return tag;
}

/** A robot that left frees what it holds on the GPU: each one has its own geometry. */
function dispose(robot) {
  robot.root.traverse((o) => { o.geometry?.dispose(); o.material?.dispose?.(); });
}

export function createAgentsFloor({ scene, camera }, working, now) {
  let workers = workersFrom(working, now);
  const robots = new Map();
  return {
    push(event, at) { workers = withActivity(workers, event, at); },
    /** Moves every agent's robot; returns their name tags. */
    frame(t) {
      const tags = [];
      for (const worker of workers) {
        const pose = workerAt(worker, t);
        const key = visitKey(worker);
        let robot = robots.get(key);
        if (!pose) {
          if (robot) { scene.remove(robot.root); dispose(robot); robots.delete(key); }
          continue;
        }
        if (!robot) {
          robot = createRobot({ accent: accentOf(worker.agent), name: worker.agent });
          robot.root.scale.setScalar(SCALE.crew);
          scene.add(robot.root);
          robots.set(key, robot);
        }
        robot.root.position.set(pose.x, 0, pose.z);
        robot.root.rotation.y = pose.yaw;
        robot.hover.position.y = 0.1 + (pose.walking ? 0.06 * Math.abs(Math.sin(t / 110)) : 0);
        tags.push(nameTag(worker.agent, robot.root.position, camera));
      }
      workers = workers.filter((w) => workerAt(w, t) !== null);
      return tags;
    },
  };
}

// KJC-TSK-1642 (asked by the maintainer on 2026-11-15): the plumbers of one factory, drawn where
// plumbers.js puts them: teleporting in a beam at the booth, walking, and swinging the wrench at
// their lane's belt while its pipeline has failed.
import * as THREE from 'three';
import { BEAM_GEOMETRY, BEAM_HEIGHT, dispose } from './agents-floor.js';
import { SCALE } from './layout.js';
import { createPlumber } from './plumber.js';
import { plumberAt, withPipelines } from './plumbers.js';
import { teleportLook } from './teleport.js';

const keyOf = (p) => `${p.lane}@${p.since}`;

/** The plumbers mounted on `scene`: `update(pipelines, now)` as the lanes' pipelines change, `frame(...)` every frame. */
export function createPlumbersFloor(scene) {
  let plumbers = [];
  const robots = new Map();
  const drop = (key) => {
    const robot = robots.get(key);
    scene.remove(robot.root, robot.beam);
    robot.beam.material.dispose();
    dispose(robot);
    robots.delete(key);
  };
  const robotFor = (key) => {
    if (robots.has(key)) return robots.get(key);
    const robot = createPlumber();
    robot.beam = new THREE.Mesh(BEAM_GEOMETRY, new THREE.MeshBasicMaterial({ color: 0x9fe3ff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    scene.add(robot.root, robot.beam);
    robots.set(key, robot);
    return robot;
  };
  return {
    /** `pipelines`: lane → its open pull request's pipeline, as the lanes' state says now. */
    update(pipelines, now) { plumbers = withPipelines(plumbers, pipelines, now); },
    /** Moves every plumber at `now`; `door` is the booth (layout.js boothAt). */
    frame(now, xOf, zOf, door) {
      const seen = new Set();
      for (const plumber of plumbers) {
        const pose = plumberAt(plumber, now, xOf, zOf, door);
        if (!pose) continue;
        const key = keyOf(plumber);
        seen.add(key);
        const robot = robotFor(key);
        const look = teleportLook(pose.size);
        robot.root.position.set(pose.x, 0, pose.z);
        robot.root.rotation.y = pose.yaw;
        robot.root.scale.set(SCALE.crew * look.across, SCALE.crew * look.up, SCALE.crew * look.across);
        robot.beam.visible = look.beam > 0;
        robot.beam.material.opacity = 0.45 * look.beam;
        robot.beam.position.set(pose.x, BEAM_HEIGHT / 2, pose.z);
        robot.hover.position.y = 0.1 + (pose.walking ? 0.06 * Math.abs(Math.sin(now / 110)) : 0);
        // At its belt it works the wrench up and down; walking, it carries it at its side.
        robot.pose('R', 0.45, pose.working ? 0.9 + 0.5 * Math.sin(now / 160) : 0.35);
      }
      // Deleting the entry being visited is safe while iterating a Map.
      for (const key of robots.keys()) if (!seen.has(key)) drop(key);
    },
  };
}

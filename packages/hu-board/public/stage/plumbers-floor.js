// KJC-TSK-1642 (asked by the maintainer on 2026-11-15): the plumbers of one factory, drawn where
// plumbers.js puts them: teleporting in a beam at the booth, walking, and swinging the wrench at
// their lane's belt while its pipeline has failed.
import * as THREE from 'three';
import { BEAM_GEOMETRY, BEAM_HEIGHT, dispose } from './agents-floor.js';
import { SCALE } from './layout.js';
import { createPlumber } from './plumber.js';
import { plumberAt, withPipelines } from './plumbers.js';
import { teleportLook } from './teleport.js';
import { avoidance } from './avoid.js';

const keyOf = (p) => `${p.lane}@${p.since}`;

/** The plumbers mounted on `scene`: `update(pipelines, now)` as the lanes' pipelines change, `frame(...)` every frame. */
export function createPlumbersFloor(scene) {
  let plumbers = [];
  let obstacles = []; // KJC-TSK-1660
  let bodies = [];
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
    /** KJC-TSK-1659: true when a new plumber was called (it teleports in at the booth). */
    update(pipelines, now) {
      const before = plumbers.filter((p) => p.leftAt === undefined).length;
      plumbers = withPipelines(plumbers, pipelines, now);
      return plumbers.filter((p) => p.leftAt === undefined).length > before;
    },
    /** KJC-TSK-1660: the other groups' robots, which the plumbers step aside from on the next frame. */
    avoid(others) { obstacles = others; },
    /** KJC-TSK-1660: where the plumbers stood on the last frame. */
    bodies: () => bodies,
    /** Moves every plumber at `now`; `door` is the booth (layout.js boothAt). */
    frame(now, xOf, zOf, door) {
      const seen = new Set();
      // KJC-TSK-1660: every plumber first, then they step aside from each other and from the rest.
      const posed = plumbers.map((plumber) => ({ plumber, pose: plumberAt(plumber, now, xOf, zOf, door) })).filter((p) => p.pose);
      const offsets = avoidance(posed.map((p) => p.pose), obstacles);
      posed.forEach((p, i) => { p.pose = { ...p.pose, x: p.pose.x + offsets[i].dx, z: p.pose.z + offsets[i].dz }; });
      bodies = posed.map(({ pose: { x, z, yaw, walking } }) => ({ x, z, yaw, walking }));
      for (const { plumber, pose } of posed) {
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

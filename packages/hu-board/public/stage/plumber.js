// KJC-TSK-1641 (asked by the maintainer on 2026-11-15): the plumber who fixes a failed pipeline's
// belt (conveyor.js). A family robot (cast/robot.js) in gray, with its suspenders as blue overalls,
// a bib and trousers over them, a yellow hard hat and a pipe wrench in place of the baton.
import * as THREE from 'three';
import { createRobot } from './cast/robot.js';
import { PLUMBER } from './plumber-look.js';

const WHITE_SHELL = 0xe6eaf0; // cast/robot.js's white
const matte = (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0.05 });

const at = (mesh, x, y, z) => { mesh.position.set(x, y, z); return mesh; };

/** Trousers round the lower body and a bib in front, in the overalls' blue. */
function overalls() {
  const denim = matte(PLUMBER.overalls);
  const group = new THREE.Group();
  // The lower body's own outline (cast/robot.js), a little wider, so the trousers sit over it.
  const outline = [[0.44, 0.02], [0.73, 0.14], [0.875, 0.38], [0.905, 0.66], [0.89, 0.76]].map(([r, y]) => new THREE.Vector2(r, y));
  group.add(new THREE.Mesh(new THREE.LatheGeometry(outline, 48), denim));
  const bib = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.46, 0.1), denim);
  group.add(at(bib, 0, 0.96, 0.8));
  const pocket = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.16, 0.02), matte(0x2c5287));
  group.add(at(pocket, 0, 0.98, 0.86));
  return group;
}

/** A hard hat over the helmet: a dome, a brim all round and a ridge along the top. */
function hardHat() {
  const yellow = matte(PLUMBER.hat);
  const group = new THREE.Group();
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1.04, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2), yellow);
  group.add(at(dome, 0, 0.18, 0));
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(1.26, 1.26, 0.07, 40), yellow);
  group.add(at(brim, 0, 0.2, 0.06));
  const ridge = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 1.9), yellow);
  group.add(at(ridge, 0, 1.17, 0));
  return group;
}

/** A pipe wrench: a handle, a hook jaw and the knurled ring that sets it. */
function pipeWrench() {
  const steel = new THREE.MeshStandardMaterial({ color: PLUMBER.wrench, roughness: 0.35, metalness: 0.7 });
  const group = new THREE.Group();
  group.add(at(new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.1, 0.08), steel), 0, -0.55, 0));
  group.add(at(new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.12, 0.12), steel), 0.1, -1.12, 0));
  group.add(at(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.1, 0.12), steel), 0.13, -1.34, 0));
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.14, 16), steel);
  ring.rotation.z = Math.PI / 2;
  group.add(at(ring, 0.02, -1.23, 0));
  group.position.y = -0.1;
  group.rotation.z = 0.35;
  return group;
}

/** The plumber, as createRobot answers a robot; `wrench` swings as it works. */
export function createPlumber() {
  const robot = createRobot({ accent: PLUMBER.overalls, name: 'plumber' });
  // Gray where the family is white.
  robot.root.traverse((o) => { if (o.isMesh && o.material.color?.getHex() === WHITE_SHELL) o.material.color.setHex(PLUMBER.body); });
  robot.hover.add(overalls());
  robot.head.add(hardHat());
  // The baton out of the right hand, the wrench in.
  robot.armR.hand.clear();
  const wrench = pipeWrench();
  robot.armR.hand.add(wrench);
  robot.pose('R', 0.45, 0.35); // the wrench out to the side, where it shows
  return { ...robot, wrench };
}

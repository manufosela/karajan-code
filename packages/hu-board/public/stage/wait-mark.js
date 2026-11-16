// KJC-TSK-1653 (asked by the maintainer on 2026-11-16): the marks over a waiting host, beside its
// head (its hologram sits over it): an amber "!" when it waits for you, a blue hourglass when it
// waits for a process. wait-look.js says which and how they move.
import * as THREE from 'three';

const AMBER = 0xffb347;
const BLUE = 0x4fb3e8;
const SIZE = 2;
const glow = (color) => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.2 });

function alert() {
  const group = new THREE.Group();
  const bar = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.7, 6, 12), glow(AMBER));
  bar.position.y = 0.75;
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.18, 16, 12), bar.material);
  group.add(bar, dot);
  return group;
}

function hourglass() {
  const group = new THREE.Group();
  const sand = glow(BLUE);
  for (const side of [-1, 1]) {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.55, 20), sand);
    cone.position.y = side * 0.3;
    cone.rotation.x = side > 0 ? Math.PI : 0;
    group.add(cone);
  }
  const frame = new THREE.MeshStandardMaterial({ color: 0x2a3442 });
  for (const y of [-0.62, 0.62]) {
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.08, 20), frame);
    plate.position.y = y;
    group.add(plate);
  }
  return group;
}

/** Puts the marks on `robot` (beside its head, in its own frame) and shows the one `look` asks for. */
export function showWaitMark(robot, look) {
  if (!robot.waitMarks) {
    robot.waitMarks = { alert: alert(), hourglass: hourglass() };
    for (const mark of Object.values(robot.waitMarks)) {
      mark.position.set(1.9, 3.2, 0);
      mark.visible = false;
      robot.hover.add(mark);
    }
  }
  const { alert: bang, hourglass: glass } = robot.waitMarks;
  bang.visible = look?.mark === 'alert';
  glass.visible = look?.mark === 'hourglass';
  // Big enough to be read from the whole hall.
  if (bang.visible) bang.scale.setScalar(SIZE * look.pulse);
  if (glass.visible) {
    glass.scale.setScalar(SIZE);
    glass.rotation.z = look.spin;
  }
}

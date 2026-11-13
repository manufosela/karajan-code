// KJC-TSK-1569 (ADR 0056, point 2, decided by the maintainer on 2026-11-12): a robot carries its
// owner's emblem on a backpack. The film's robot is never changed (cast/ is a checked copy): the
// backpack hangs from its hover, on its back (the badge of agents-floor.js is on its front).
import * as THREE from 'three';
import { glyphOf } from './avatars.js';

const PACK = { width: 0.95, height: 0.95, depth: 0.6, y: 0.95, z: -1 };

const hex = (color) => `#${color.toString(16).padStart(6, '0')}`;

/** The emblem painted on a round plate of `size` metres, in `color` (KJC-TSK-1603), white without one. */
function emblemPlate(glyph, size, color) {
  const canvas = Object.assign(document.createElement('canvas'), { width: 256, height: 256 });
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = color === null ? '#e9edf2' : hex(color);
  ctx.beginPath();
  ctx.arc(128, 128, 120, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = '150px "Noto Color Emoji", "Apple Color Emoji", "Segoe UI Emoji", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(glyph, 128, 140);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({ map: texture, transparent: true }));
}

/**
 * The emblem on the back of the pack, on both its sides and on its lid: a typing robot turns side
 * on (agents-floor.js), so one side faces the camera, which from above also sees the lid.
 */
function emblems(glyph, color) {
  const back = emblemPlate(glyph, 0.7, color);
  back.position.z = -PACK.depth / 2 - 0.01;
  back.rotation.y = Math.PI; // a plane faces +z; the back of the robot is -z
  const sides = [1, -1].map((side) => {
    const plate = emblemPlate(glyph, 0.5, color);
    plate.position.x = side * (PACK.width / 2 + 0.01);
    plate.rotation.y = side * (Math.PI / 2);
    return plate;
  });
  const lid = emblemPlate(glyph, 0.5, color);
  lid.position.y = PACK.height / 2 + 0.01;
  lid.rotation.x = -Math.PI / 2;
  return [back, ...sides, lid];
}

/**
 * Puts on `robot` the backpack of `emblem`; none for no emblem; again for the same one, nothing.
 * KJC-TSK-1603 (the maintainer, 2026-11-13): the pack and the round plates of its emblem are in
 * `color`, its owner's, which marks all their robots; dark and white without one.
 */
export function carry(robot, emblem, color = null) {
  const glyph = glyphOf(emblem);
  if (robot.backpack?.emblem === emblem && robot.backpack?.color === color) return;
  if (robot.backpack) robot.hover.remove(robot.backpack.group);
  robot.backpack = null;
  if (!glyph) return;
  const group = new THREE.Group();
  const bag = new THREE.Mesh(new THREE.BoxGeometry(PACK.width, PACK.height, PACK.depth), new THREE.MeshStandardMaterial({ color: color ?? 0x2b3442, roughness: 0.8 }));
  bag.castShadow = true;
  group.add(bag, ...emblems(glyph, color));
  group.position.set(0, PACK.y, PACK.z);
  robot.hover.add(group);
  robot.backpack = { emblem, color, group };
}

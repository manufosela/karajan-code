// KJC-TSK-1639 (asked by the maintainer on 2026-11-15): a lane's pipeline as a conveyor belt at
// the back of its workshop, ending at its git gates. conveyor.js says how it looks and where its
// boxes go; this draws it: a low frame on legs, the belt, its boxes and a lamp at its far end.
import * as THREE from 'three';
import { BELT, beltLook, boxesAt } from './conveyor.js';

const HEIGHT = 0.28;
const DEPTH = 0.42;
const BOX = 0.26;
/** The belt and its lamp for each look: blue riding, red stopped, green done. */
const TONE = { running: { belt: 0x2b3b52, lamp: 0x4fb3e8 }, failed: { belt: 0x5a1f22, lamp: 0xff4d4d }, passed: { belt: 0x1f4a33, lamp: 0x2fd27a } };

const mesh = (geometry, material, x, y, z) => {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(x, y, z);
  return m;
};

/** The belt as a group (in the workshop's frame), `show(pipeline)` and `frame(now)`. */
export function createBelt() {
  const group = new THREE.Group();
  group.visible = false;
  const span = BELT.to - BELT.from;
  const middle = (BELT.from + BELT.to) / 2;
  const steel = new THREE.MeshStandardMaterial({ color: 0x3a4656, roughness: 0.6, metalness: 0.4 });
  const surface = new THREE.MeshStandardMaterial({ color: TONE.running.belt, emissive: 0x000000, roughness: 0.9 });
  const glow = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: TONE.running.lamp, emissiveIntensity: 1.4 });
  group.add(mesh(new THREE.BoxGeometry(span, 0.08, DEPTH), steel, middle, HEIGHT - 0.06, BELT.z));
  group.add(mesh(new THREE.BoxGeometry(span, 0.03, DEPTH - 0.06), surface, middle, HEIGHT, BELT.z));
  for (const x of [BELT.from + 0.1, middle, BELT.to - 0.1]) group.add(mesh(new THREE.BoxGeometry(0.06, HEIGHT - 0.1, DEPTH - 0.1), steel, x, (HEIGHT - 0.1) / 2, BELT.z));
  // The lamp on a post at the near end, seen from across the hall.
  group.add(mesh(new THREE.BoxGeometry(0.05, 0.5, 0.05), steel, BELT.from, HEIGHT + 0.25, BELT.z - DEPTH / 2));
  group.add(mesh(new THREE.SphereGeometry(0.11, 16, 12), glow, BELT.from, HEIGHT + 0.55, BELT.z - DEPTH / 2));
  const cardboard = new THREE.MeshStandardMaterial({ color: 0xb08a5a, roughness: 0.9 });
  const boxes = Array.from({ length: BELT.boxes }, () => {
    const b = mesh(new THREE.BoxGeometry(BOX, BOX, BOX), cardboard, 0, HEIGHT + BOX / 2, BELT.z);
    group.add(b);
    return b;
  });
  let pipeline = null;
  return {
    group,
    /** Shows the belt for the lane's pipeline; none without an open pull request. */
    show(next) {
      pipeline = next;
      const look = beltLook(next);
      group.visible = Boolean(look);
      if (!look) return;
      surface.color.setHex(TONE[look.tone].belt);
      glow.emissive.setHex(TONE[look.tone].lamp);
    },
    /** Moves the boxes; a failed belt's lamp blinks. */
    frame(now) {
      if (!group.visible) return;
      const xs = boxesAt(pipeline, now);
      boxes.forEach((b, i) => {
        b.visible = i < xs.length;
        if (b.visible) b.position.x = xs[i];
      });
      glow.emissiveIntensity = pipeline === 'failed' ? 0.4 + 1.4 * Math.abs(Math.sin(now / 300)) : 1.4;
    },
  };
}

// KJC-TSK-1433 (ADR 0048): one workshop per lane, in a row at the front of the
// hall: a floor pad with the lane's name and a bench. A lane seen for the first
// time gets its workshop and the row recentres.
import * as THREE from 'three';
import { BOOTH, CONSOLE, CREW, WORKSHOP, workshopAt } from './layout.js';
import { plateName } from './lane-status.js';
import { deskParts } from './desk-layout.js';
import { createBelt } from './belt.js';
import { leaveSlot, opacityAt, slideAt, takeSlot } from './hall-motion.js';

const matte = (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.1 });

/** KJC-BUG-0623: a workshop seen at `k` (0..1) of its own opacity; whole again, as it was. */
function fade(group, k) {
  if (group.userData.k === k) return;
  group.userData.k = k;
  group.traverse((o) => {
    for (const m of [o.material].flat().filter(Boolean)) {
      m.userData.base ??= { opacity: m.opacity, transparent: m.transparent };
      m.opacity = m.userData.base.opacity * k;
      const transparent = m.userData.base.transparent || k < 1;
      if (m.transparent !== transparent) { m.transparent = transparent; m.needsUpdate = true; }
    }
  });
}

const cut = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

// KJC-TSK-1540: the colour of a lane's status line, by its state.
const TONE = { 'waiting-person': '#f0b429', 'waiting-merge': '#7fb3ff', finished: '#2fd27a', failed: '#ff5d5d', idle: '#8a96a6', unknown: '#e0848a' };

/**
 * The lane's name painted on the floor at the front of its workshop, and under it what the
 * lane is doing when it is not working (KJC-TSK-1540); `paint(line, state)` repaints it.
 */
function nameplate(name) {
  const canvas = Object.assign(document.createElement('canvas'), { width: 512, height: 150 });
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const paint = (line, state) => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#c9d6e3';
    ctx.font = '600 52px system-ui, sans-serif';
    ctx.fillText(cut(plateName(name), 18), 256, 48);
    if (line) {
      ctx.fillStyle = TONE[state] ?? '#c9d6e3';
      // As large as fits the plate, down to a size still readable from the default camera.
      let size = 42;
      do ctx.font = `600 ${size--}px system-ui, sans-serif`;
      while (size > 28 && ctx.measureText(line).width > 496);
      ctx.fillText(cut(line, 30), 256, 112, 496);
    }
    texture.needsUpdate = true;
  };
  paint('', 'working');
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(WORKSHOP.width * 0.9, WORKSHOP.width * 0.9 * (150 / 512)), new THREE.MeshBasicMaterial({ map: texture, transparent: true }));
  plate.rotation.x = -Math.PI / 2;
  plate.position.set(0, 0.03, WORKSHOP.depth / 2 + 0.55);
  return { plate, paint };
}

const PAD = 0x243244;
const PAD_DIM = 0x161d27;
const BENCH = 0x5a4a3a;
const BENCH_DIM = 0x352c24;

/** KJC-TSK-1591: a standing desk at each seat, its top on four legs, turned with its agent. */
function desks(wood) {
  const group = new THREE.Group();
  for (const desk of deskParts()) {
    const one = new THREE.Group();
    const box = (w, h, d, x, y, z) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wood);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      one.add(mesh);
    };
    // In the desk's own frame its width runs across (x) and its depth along the agent's way (z).
    box(desk.width, desk.thick, desk.depth, 0, desk.height - desk.thick / 2, 0);
    for (const leg of desk.legs) box(leg.size, leg.height, leg.size, leg.across, leg.height / 2, leg.along);
    one.position.set(desk.x, 0, desk.z);
    one.rotation.y = desk.yaw;
    group.add(one);
  }
  return group;
}

/** A workshop and `show(line, state)`, which dims it and says why while its lane is not working. */
function workshop(name) {
  const group = new THREE.Group();
  const pad = new THREE.Mesh(new THREE.BoxGeometry(WORKSHOP.width, 0.04, WORKSHOP.depth), matte(PAD));
  pad.position.y = 0.02;
  pad.receiveShadow = true;
  // KJC-TSK-1591: a desk at each seat where the bench was; one wood material, dimmed as one.
  const wood = matte(BENCH);
  const { plate, paint } = nameplate(name);
  group.add(pad, desks(wood), plate);
  const show = (line, state) => {
    const lit = state === 'working';
    pad.material.color.setHex(lit ? PAD : PAD_DIM);
    wood.color.setHex(lit ? BENCH : BENCH_DIM);
    paint(line, state);
  };
  return { group, show };
}

/**
 * KJC-TSK-1632 (the maintainer, 2026-11-15): the teleport booth the hosts come and go by, beside
 * Karajan: a lit pad, a see-through glass tube and a glowing ring on top.
 */
function booth() {
  const glow = (opacity) => new THREE.MeshStandardMaterial({ color: 0x9fe3ff, emissive: 0x4fb3e8, emissiveIntensity: 0.6, transparent: true, opacity, depthWrite: false });
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.9, 0.14, 32), matte(0x2a3646));
  pad.position.y = 0.07;
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.02, 32), glow(0.9));
  disc.position.y = 0.15;
  // KJC-BUG-0603: in the crew's row, with room around it, it stands its full height again, taller
  // than a robot: a see-through glass tube with a glowing ring on top.
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, BOOTH.height, 32, 1, true), glow(0.18));
  tube.position.y = 0.15 + BOOTH.height / 2;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.06, 12, 40), glow(0.95));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.15 + BOOTH.height;
  const group = new THREE.Group();
  group.add(pad, disc, tube, ring);
  group.position.set(BOOTH.x, 0, BOOTH.z);
  return group;
}

/**
 * KJC-TSK-1437 (ADR 0048): the workshop's git gates, at the back where its work leaves for the base
 * branch. KJC-TSK-1646 (the maintainer, 2026-11-15): "remove those posts, I don't know what they are and they
 * get in the way". The workshop's git gates are no longer two posts and a bar: a flat strip along the
 * back edge of its pad, which lights when a commit passes or bounces. Returns it and its material.
 */
/**
 * KJC-TSK-1659 (the maintainer, 2026-11-17): the booth's console, within Karajan's reach: a slanted
 * desk on a post with a round button that lights as Karajan presses it. Returns it and `light(k)`.
 */
function boothConsole() {
  const group = new THREE.Group();
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.9, 0.16), matte(0x3a4656));
  post.position.y = 0.45;
  const desk = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.08, 0.42), matte(0x2a3442));
  desk.position.y = 0.95;
  desk.rotation.x = -0.35;
  const glow = new THREE.MeshStandardMaterial({ color: 0x1f6e8c, emissive: 0x4fb3e8, emissiveIntensity: 0 });
  const button = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.07, 24), glow);
  button.position.set(0, 1.01, 0.02);
  button.rotation.x = -0.35;
  group.add(post, desk, button);
  group.position.set(CONSOLE.x, 0, CONSOLE.z);
  group.rotation.y = Math.atan2(CREW.conductor.x - CONSOLE.x, CREW.conductor.z - CONSOLE.z); // facing Karajan
  return { group, light: (k) => { glow.emissiveIntensity = 2.2 * k; } };
}

function gates() {
  const light = new THREE.MeshStandardMaterial({ color: 0x2a3442, emissive: 0x000000, roughness: 0.5 });
  const gate = new THREE.Mesh(new THREE.BoxGeometry(WORKSHOP.width, 0.03, 0.14), light);
  gate.position.set(0, 0.05, -WORKSHOP.depth / 2 + 0.07);
  return { gate, light };
}

const PASS = 0x2fd27a;
const BOUNCE = 0xe0484f;

/** The row of workshops; `xOf(lane)` is the centre of a lane's workshop. */
export function createHall(scene, lanes) {
  const shops = new Map();
  const shown = new Map(); // KJC-TSK-1540: each lane's status line, repainted only when it changes
  const lines = new Map(); // KJC-TSK-1620: and that line, whole
  const lights = new Map();
  const belts = new Map(); // KJC-TSK-1639: each lane's pipeline belt
  // KJC-TSK-1702: the slots of the hall, a lane or a gap; each workshop keeps its slot.
  let slots = [];
  const last = new Map(); // KJC-BUG-0633: the slot each lane stood in, to come back to it
  // KJC-TSK-1488: in rows and columns once there are many.
  const at = (lane) => workshopAt(Math.max(0, slots.indexOf(lane)), slots.length);
  const order = () => slots.filter(Boolean);
  // KJC-TSK-1632: the booth the hosts come and go by, beside Karajan.
  scene.add(booth());
  const desk = boothConsole(); // KJC-TSK-1659
  scene.add(desk.group);
  // KJC-BUG-0623: a workshop already standing slides to its new place; a new one stands there at once.
  let opening = true; // the workshops of the first state stand whole, with no fade in
  const relayout = (now = performance.now()) => order().forEach((lane) => {
    const { group } = shops.get(lane);
    const to = at(lane);
    // While the first state lays the hall out, every workshop stands straight at its place.
    if (!group.userData.placed || opening) {
      group.position.set(to.x, 0, to.z);
      group.userData.placed = true;
    } else if (group.position.x !== to.x || group.position.z !== to.z) {
      shops.get(lane).move = { from: { x: group.position.x, z: group.position.z }, to, at: now };
    }
  });
  /** KJC-BUG-0623: a workshop gone for good: out of the scene; KJC-TSK-1702: its gap waits for the next one. */
  const drop = (lane) => {
    scene.remove(shops.get(lane).group);
    shops.delete(lane);
    shown.delete(lane);
    lines.delete(lane);
    lights.delete(lane);
    belts.delete(lane);
    slots = leaveSlot(slots, last, lane);
    relayout();
  };
  const ensure = (lane) => {
    // KJC-BUG-0623: one fading out that comes back fades in again where it stands.
    if (shops.get(lane)?.leaving) {
      shops.get(lane).leaving = null;
      shops.get(lane).born = performance.now();
      return true;
    }
    if (shops.has(lane)) return false;
    const shop = workshop(lane);
    shop.born = opening ? -Infinity : performance.now();
    const { gate, light } = gates();
    shop.group.add(gate);
    lights.set(lane, light);
    const belt = createBelt();
    shop.group.add(belt.group);
    belts.set(lane, belt);
    shops.set(lane, shop);
    slots = takeSlot(slots, last, lane); // KJC-BUG-0633: back where it stood, if free
    scene.add(shop.group);
    relayout();
    return true;
  };
  lanes.forEach(ensure);
  opening = false;
  /**
   * KJC-BUG-0557: takes a lane's workshop away and closes the gap; true when it had one.
   * KJC-BUG-0623: it fades out first, keeping its place; then the others slide into the gap (frame).
   */
  const remove = (lane, { instant = false } = {}) => {
    const shop = shops.get(lane);
    if (!shop || shop.leaving) return false;
    // KJC-TSK-1704: one stored while the stage opens was never seen in the hall: it goes at once.
    if (instant) drop(lane);
    else shop.leaving = { at: performance.now() };
    return true;
  };
  /** KJC-BUG-0623: fades and slides the workshops at `now`; one done fading out goes for good. */
  const frame = (now) => {
    // Deleting the entry being visited (drop) is safe while iterating a Map.
    for (const [lane, shop] of shops) {
      const k = opacityAt(shop, now);
      if (shop.leaving && k === 0) { drop(lane); continue; }
      fade(shop.group, k);
      const slid = slideAt(shop.move, now);
      if (slid) shop.group.position.set(slid.x, 0, slid.z);
      if (slid && slid.x === shop.move.to.x && slid.z === shop.move.to.z) shop.move = null;
    }
  };
  const standing = () => order().filter((lane) => !shops.get(lane).leaving);
  return {
    /** Adds the lane's workshop if it is new; true when the row changed. */
    ensure,
    xOf: (lane) => at(lane).x,
    /** KJC-TSK-1488: the z of a lane's workshop, which a factory of several rows sets apart. */
    zOf: (lane) => at(lane).z,
    remove,
    frame,
    /** KJC-TSK-1659: how lit the booth console's button is, 0 to 1. */
    lightConsole: (k) => desk.light(k),
    // KJC-TSK-1702: how many slots the hall spans, gaps included, which sizes the view and its edges.
    count: () => slots.length,
    /** KJC-TSK-1540: the lanes of the hall, in the order their workshops stand. */
    names: () => standing(),
    /** KJC-TSK-1620: the status line a lane's plate shows (cut), whole, for its tooltip. */
    lineOf: (lane) => lines.get(lane) ?? '',
    /** KJC-TSK-1540: dims a lane's workshop and says why while it is not working. */
    showStatus(lane, line, state) {
      const key = `${state}|${line}`;
      if (!shops.has(lane) || shown.get(lane) === key) return;
      shown.set(lane, key);
      lines.set(lane, line);
      shops.get(lane).show(line, state);
    },
    /** KJC-TSK-1639: shows a lane's pipeline on its belt (null: no open pull request, no belt). */
    showPipeline: (lane, pipeline) => belts.get(lane)?.show(pipeline),
    /** KJC-TSK-1639: moves the boxes of every belt. */
    frameBelts: (now) => belts.forEach((belt) => belt.frame(now)),
    /** Lights a lane's gates green (approve) or red (refuse) at `level` 0..1; 0 puts them out. */
    lightGates(lane, tone, level) {
      const light = lights.get(lane);
      if (!light) return;
      light.emissive.setHex(tone === 'approve' ? PASS : BOUNCE);
      light.emissiveIntensity = Math.max(0, level) * 1.6;
    },
  };
}

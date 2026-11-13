// KJC-TSK-1433 (ADR 0048): one workshop per lane, in a row at the front of the
// hall: a floor pad with the lane's name and a bench. A lane seen for the first
// time gets its workshop and the row recentres.
import * as THREE from 'three';
import { WORKSHOP, workshopAt } from './layout.js';
import { plateName } from './lane-status.js';
import { deskParts } from './desk-layout.js';

const matte = (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.1 });

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
 * KJC-TSK-1437 (ADR 0048): the workshop's git gates, at the back where its work
 * leaves for the base branch: two posts and a bar that lights when a commit
 * passes or bounces. Returns the gate and its bar's material.
 */
function gates() {
  const gate = new THREE.Group();
  for (const x of [-0.6, 0.6]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.9, 0.1), matte(0x3a4656));
    post.position.set(x, 0.45, 0);
    gate.add(post);
  }
  const light = new THREE.MeshStandardMaterial({ color: 0x55606e, emissive: 0x000000, roughness: 0.5 });
  const bar = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.12, 0.12), light);
  bar.position.y = 0.9;
  gate.add(bar);
  gate.position.set(WORKSHOP.width / 2 - 0.9, 0, -WORKSHOP.depth / 2);
  return { gate, light };
}

const PASS = 0x2fd27a;
const BOUNCE = 0xe0484f;

/** The row of workshops; `xOf(lane)` is the centre of a lane's workshop. */
export function createHall(scene, lanes) {
  const shops = new Map();
  const shown = new Map(); // KJC-TSK-1540: each lane's status line, repainted only when it changes
  const lights = new Map();
  const order = [];
  // KJC-TSK-1488: in rows and columns once there are many.
  const at = (lane) => workshopAt(Math.max(0, order.indexOf(lane)), order.length);
  const relayout = () => order.forEach((lane) => shops.get(lane).group.position.set(at(lane).x, 0, at(lane).z));
  const ensure = (lane) => {
    if (shops.has(lane)) return false;
    const shop = workshop(lane);
    const { gate, light } = gates();
    shop.group.add(gate);
    lights.set(lane, light);
    shops.set(lane, shop);
    order.push(lane);
    scene.add(shop.group);
    relayout();
    return true;
  };
  lanes.forEach(ensure);
  /** KJC-BUG-0557: takes a lane's workshop away and closes the gap; true when it had one. */
  const remove = (lane) => {
    if (!shops.has(lane)) return false;
    scene.remove(shops.get(lane).group);
    shops.delete(lane);
    shown.delete(lane);
    lights.delete(lane);
    order.splice(order.indexOf(lane), 1);
    relayout();
    return true;
  };
  return {
    /** Adds the lane's workshop if it is new; true when the row changed. */
    ensure,
    xOf: (lane) => at(lane).x,
    /** KJC-TSK-1488: the z of a lane's workshop, which a factory of several rows sets apart. */
    zOf: (lane) => at(lane).z,
    remove,
    count: () => order.length,
    /** KJC-TSK-1540: the lanes of the hall, in the order their workshops stand. */
    names: () => [...order],
    /** KJC-TSK-1540: dims a lane's workshop and says why while it is not working. */
    showStatus(lane, line, state) {
      const key = `${state}|${line}`;
      if (!shops.has(lane) || shown.get(lane) === key) return;
      shown.set(lane, key);
      shops.get(lane).show(line, state);
    },
    /** Lights a lane's gates green (approve) or red (refuse) at `level` 0..1; 0 puts them out. */
    lightGates(lane, tone, level) {
      const light = lights.get(lane);
      if (!light) return;
      light.emissive.setHex(tone === 'approve' ? PASS : BOUNCE);
      light.emissiveIntensity = Math.max(0, level) * 1.6;
    },
  };
}

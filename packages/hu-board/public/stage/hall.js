// KJC-TSK-1433 (ADR 0048): one workshop per lane, in a row at the front of the
// hall: a floor pad with the lane's name and a bench. A lane seen for the first
// time gets its workshop and the row recentres.
import * as THREE from 'three';
import { WORKSHOP, workshopX } from './layout.js';

const matte = (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.1 });

/** The lane's name painted on the floor at the front of its workshop. */
function nameplate(name) {
  const canvas = Object.assign(document.createElement('canvas'), { width: 512, height: 96 });
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#c9d6e3';
  ctx.font = '600 52px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(name.length > 18 ? `${name.slice(0, 17)}…` : name, 256, 48);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(WORKSHOP.width * 0.9, WORKSHOP.width * 0.17), new THREE.MeshBasicMaterial({ map: texture, transparent: true }));
  plate.rotation.x = -Math.PI / 2;
  plate.position.set(0, 0.03, WORKSHOP.depth / 2 + 0.35);
  return plate;
}

function workshop(name) {
  const group = new THREE.Group();
  const pad = new THREE.Mesh(new THREE.BoxGeometry(WORKSHOP.width, 0.04, WORKSHOP.depth), matte(0x243244));
  pad.position.y = 0.02;
  pad.receiveShadow = true;
  // Low enough that the badge on a working robot's chest shows over it (KJC-TSK-1435).
  const bench = new THREE.Mesh(new THREE.BoxGeometry(WORKSHOP.width * 0.8, 0.35, 0.6), matte(0x5a4a3a));
  bench.position.set(0, 0.175, 0.4);
  bench.castShadow = true;
  group.add(pad, bench, nameplate(name));
  return group;
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
  const lights = new Map();
  const order = [];
  const relayout = () => order.forEach((lane, i) => shops.get(lane).position.set(workshopX(i, order.length), 0, WORKSHOP.z));
  const ensure = (lane) => {
    if (shops.has(lane)) return false;
    const shop = workshop(lane);
    const { gate, light } = gates();
    shop.add(gate);
    lights.set(lane, light);
    shops.set(lane, shop);
    order.push(lane);
    scene.add(shop);
    relayout();
    return true;
  };
  lanes.forEach(ensure);
  return {
    /** Adds the lane's workshop if it is new; true when the row changed. */
    ensure,
    xOf: (lane) => workshopX(Math.max(0, order.indexOf(lane)), order.length),
    /** KJC-TSK-1488: the z of a lane's workshop, which a factory of several rows sets apart. */
    zOf: () => WORKSHOP.z,
    count: () => order.length,
    /** Lights a lane's gates green (approve) or red (refuse) at `level` 0..1; 0 puts them out. */
    lightGates(lane, tone, level) {
      const light = lights.get(lane);
      if (!light) return;
      light.emissive.setHex(tone === 'approve' ? PASS : BOUNCE);
      light.emissiveIntensity = Math.max(0, level) * 1.6;
    },
  };
}

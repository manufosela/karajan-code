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

/** The row of workshops; `xOf(lane)` is the centre of a lane's workshop. */
export function createHall(scene, lanes) {
  const shops = new Map();
  const order = [];
  const relayout = () => order.forEach((lane, i) => shops.get(lane).position.set(workshopX(i, order.length), 0, WORKSHOP.z));
  const ensure = (lane) => {
    if (shops.has(lane)) return false;
    const shop = workshop(lane);
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
    count: () => order.length,
  };
}

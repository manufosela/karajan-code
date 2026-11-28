// KJC-TSK-1815: the costumes piece-costumes.js names, as meshes on the robot cast/robot.js builds,
// modelled on costume-mesh.js: cloth hangs from its hover, the hat sits on its head, props in its hands.
import * as THREE from 'three';

import { HELD_PROPS } from './piece-costumes.js';

const cloth = (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, side: THREE.DoubleSide });
const at = (mesh, x, y, z) => { mesh.position.set(x, y, z); return mesh; };
const ring = (radius, tube, material, y) => {
  const mesh = at(new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 8, 40), material), 0, y, 0);
  mesh.rotation.x = Math.PI / 2;
  return mesh;
};
const coat = (top, bottom, height, y, material) =>
  at(new THREE.Mesh(new THREE.CylinderGeometry(top, bottom, height, 28, 1, true), material), 0, y + height / 2, 0);

/** Stands `prop` on the hand that holds `part` (its lowest point at the hand, never below), hiding the baton. */
function hold(robot, part, prop) {
  const box = new THREE.Box3().setFromObject(prop);
  prop.position.y -= box.min.y;
  const { hand } = robot[HELD_PROPS[part] === 'left' ? 'armL' : 'armR'];
  for (const child of hand.children) child.visible = false;
  hand.add(prop);
}
const solid = (geometry, material, x, y, z) => at(new THREE.Mesh(geometry, material), x, y, z);

const BUILD = {
  trenchcoat: ({ hover }) => {
    const beige = cloth(0xc8a675);
    hover.add(coat(0.85, 0.95, 1.2, 0.05, beige), ring(0.9, 0.05, beige, 0.55), ring(0.82, 0.07, beige, 1.25));
  },
  hat: ({ head }, trim) => {
    const brown = cloth(0x4a3324);
    const hat = new THREE.Group();
    hat.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.95, 0.05, 32), brown), 0, 0.62, 0),
      at(new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.68, 0.45, 28), brown), 0, 0.86, 0), ring(0.67, 0.04, trim, 0.7));
    hat.rotation.x = 0.12;
    head.add(hat);
  },
  magnifier: (robot, trim) => {
    const glass = new THREE.MeshStandardMaterial({ color: 0xcfe8ff, transparent: true, opacity: 0.35, side: THREE.DoubleSide });
    const lens = new THREE.Group();
    lens.add(new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.04, 8, 32), trim), new THREE.Mesh(new THREE.CircleGeometry(0.27, 32), glass),
      at(new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.35, 10), cloth(0x3a2a1e)), 0, -0.45, 0));
    hold(robot, 'magnifier', lens);
  },
  tailcoat: ({ hover }) => {
    const black = cloth(0x15171a);
    const tails = [-1, 1].map((side) => {
      const tail = at(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.7, 0.05), black), side * 0.2, 0.65, -0.85);
      tail.rotation.z = side * 0.08;
      return tail;
    });
    const shirt = at(new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.6), cloth(0xf4f6f8)), 0, 0.95, 0.88);
    hover.add(coat(0.86, 0.92, 1.1, 0.25, black), ...tails, shirt);
  },
  tray: (robot, trim) => {
    const tray = new THREE.Group();
    const glass = new THREE.MeshStandardMaterial({ color: 0xdff3ff, transparent: true, opacity: 0.5 });
    tray.add(new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.04, 32), trim),
      at(new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.05, 0.22, 16), glass), 0.12, 0.13, 0));
    hold(robot, 'tray', tray);
  },
  robe: ({ hover }) => hover.add(coat(0.8, 1, 1.4, 0.02, cloth(0x111318))),
  jabot: ({ hover }) => {
    const lace = cloth(0xf4f6f8);
    hover.add(...[-1, 1].map((side) => {
      const cone = at(new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.26, 16), lace), side * 0.07, 1.28, 0.82);
      cone.rotation.x = Math.PI;
      return cone;
    }));
  },
  gavel: (robot, trim) => {
    const gavel = new THREE.Group();
    const head = at(new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.32, 20), trim), 0, 0.6, 0);
    head.rotation.z = Math.PI / 2;
    gavel.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.6, 10), cloth(0x6b4423)), 0, 0.3, 0), head);
    hold(robot, 'gavel', gavel);
  },
  eyeshade: ({ head }, trim) => {
    const green = new THREE.MeshStandardMaterial({ color: 0x2f8f4e, transparent: true, opacity: 0.7, side: THREE.DoubleSide });
    const brim = solid(new THREE.CylinderGeometry(0.8, 0.8, 0.03, 32, 1, false, -Math.PI / 2, Math.PI), green, 0, 0.55, 0.45);
    head.add(brim, ring(0.9, 0.04, trim, 0.5));
  },
  waistcoat: ({ hover }, trim) => {
    const grey = cloth(0x3b3f46);
    const buttons = [0.7, 0.95, 1.2].map((y) => solid(new THREE.SphereGeometry(0.04, 10, 10), trim, 0, y, 0.9));
    hover.add(coat(0.9, 0.86, 0.9, 0.45, grey), ...buttons);
  },
  book: (robot) => {
    const book = new THREE.Group();
    book.add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.38), cloth(0x7a2e22)),
      solid(new THREE.BoxGeometry(0.46, 0.09, 0.02), cloth(0xf1e6c8), 0, 0, 0.19));
    hold(robot, 'book', book);
  },
  cap: ({ head }, trim) => {
    const navy = cloth(0x1d2b4a);
    const visor = solid(new THREE.CylinderGeometry(0.72, 0.72, 0.04, 28, 1, false, -Math.PI / 2, Math.PI), cloth(0x000000), 0, 0.7, 0.2);
    head.add(solid(new THREE.CylinderGeometry(0.7, 0.72, 0.3, 28), navy, 0, 0.78, 0), ring(0.72, 0.04, trim, 0.68), visor);
  },
  greatcoat: ({ hover }, trim) => {
    const buttons = [-1, 1].flatMap((side) => [0.5, 0.85, 1.2].map((y) => solid(new THREE.SphereGeometry(0.04, 10, 10), trim, side * 0.25, y, 0.9)));
    hover.add(coat(0.98, 0.86, 1.35, 0.02, cloth(0x1d2b4a)), ...buttons);
  },
  barrier: (robot) => {
    const pole = new THREE.Group();
    for (let i = 0; i < 4; i++) {
      const stripe = cloth(i % 2 ? 0xffffff : 0xd83a34);
      pole.add(solid(new THREE.CylinderGeometry(0.05, 0.05, 0.4, 12), stripe, 0, (i - 1.5) * 0.4, 0));
    }
    pole.rotation.z = Math.PI / 2;
    hold(robot, 'barrier', pole);
  },
  headphones: ({ head }, trim) => {
    const band = new THREE.Mesh(new THREE.TorusGeometry(1,0.06, 8, 32, Math.PI), trim);
    band.position.y = 0.15;
    const dark = cloth(0x22262c);
    const cups = [-1, 1].map((side) => {
      const cup = solid(new THREE.CylinderGeometry(0.26, 0.26, 0.18, 20), dark, side * 1.1, 0.15, 0);
      cup.rotation.z = Math.PI / 2;
      return cup;
    });
    head.add(band, ...cups);
  },
  radar: (robot, trim) => {
    const radar = new THREE.Group();
    const dish = solid(new THREE.SphereGeometry(0.3, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), trim, 0, 0.4, 0);
    trim.side = THREE.DoubleSide;
    dish.rotation.x = Math.PI / 3; // open side up and toward +z
    radar.add(solid(new THREE.CylinderGeometry(0.04, 0.04, 0.4, 10), cloth(0x3a2a1e), 0, 0.2, 0), dish);
    hold(robot, 'radar', radar);
  },
};

/** Dresses `robot` in `costume.parts`; returns the material its accent parts share, for the piece to light. */
export function dressPiece(robot, costume) {
  const trim = new THREE.MeshStandardMaterial({ color: 0xd8dde3, metalness: 0.6, roughness: 0.3, emissive: 0x000000 });
  for (const part of costume.parts) BUILD[part](robot, trim);
  return { trim };
}

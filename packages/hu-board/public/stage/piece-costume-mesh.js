// KJC-TSK-1815: the costumes piece-costumes.js names, as meshes on the robot cast/robot.js builds,
// modelled on costume-mesh.js: cloth hangs from its hover, the hat sits on its head, props in its hands.
import * as THREE from 'three';

const cloth = (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, side: THREE.DoubleSide });
const at = (mesh, x, y, z) => { mesh.position.set(x, y, z); return mesh; };
const ring = (radius, tube, material, y) => {
  const mesh = at(new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 8, 40), material), 0, y, 0);
  mesh.rotation.x = Math.PI / 2;
  return mesh;
};
const coat = (top, bottom, height, y, material) =>
  at(new THREE.Mesh(new THREE.CylinderGeometry(top, bottom, height, 28, 1, true), material), 0, y + height / 2, 0);

/** Puts `parts` in `hand`, hiding the baton it held. */
function hold(hand, ...parts) {
  for (const child of hand.children) child.visible = false;
  hand.add(...parts);
}

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
  magnifier: ({ armR }, trim) => {
    const glass = new THREE.MeshStandardMaterial({ color: 0xcfe8ff, transparent: true, opacity: 0.35, side: THREE.DoubleSide });
    const lens = new THREE.Group();
    lens.add(new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.04, 8, 32), trim), new THREE.Mesh(new THREE.CircleGeometry(0.27, 32), glass),
      at(new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.35, 10), cloth(0x3a2a1e)), 0, -0.45, 0));
    lens.position.y = -0.4;
    hold(armR.hand, lens);
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
  tray: ({ armL }, trim) => {
    const tray = new THREE.Group();
    const glass = new THREE.MeshStandardMaterial({ color: 0xdff3ff, transparent: true, opacity: 0.5 });
    tray.add(new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.04, 32), trim),
      at(new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.05, 0.22, 16), glass), 0.12, 0.13, 0));
    tray.position.y = -0.22;
    hold(armL.hand, tray);
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
  gavel: ({ armR }, trim) => {
    const gavel = new THREE.Group();
    const head = at(new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.32, 20), trim), 0, -0.6, 0);
    head.rotation.z = Math.PI / 2;
    gavel.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.6, 10), cloth(0x6b4423)), 0, -0.3, 0), head);
    hold(armR.hand, gavel);
  },
};

/** Dresses `robot` in `costume.parts`; returns the material its accent parts share, for the piece to light. */
export function dressPiece(robot, costume) {
  const trim = new THREE.MeshStandardMaterial({ color: 0xd8dde3, metalness: 0.6, roughness: 0.3, emissive: 0x000000 });
  for (const part of costume.parts) BUILD[part](robot, trim);
  return { trim };
}

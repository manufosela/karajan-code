// KJC-TSK-1526 (decided by the maintainer on 2026-11-11): the "Ready to release" table. The
// cards done since the last release lie on it in one pile, the newest on top, under a sign
// with how many there are and since which release. release.js says which cards.
import * as THREE from 'three';
import { RELEASE_TABLE } from './layout.js';
import { cardNote } from './couriers.js';
import { releaseSign } from './release.js';

const TOP = { width: 1.6, depth: 1, height: 0.75 };
const PILE_MAX = 12; // a taller pile says no more: the sign gives the count
const NOTE = { size: 0.5, step: 0.025 };

/** The sign over the table, its two lines painted on a canvas. */
function sign() {
  const canvas = Object.assign(document.createElement('canvas'), { width: 512, height: 128 });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.4), new THREE.MeshBasicMaterial({ map: texture, transparent: true }));
  plate.position.set(0, TOP.height + 0.9, -TOP.depth / 2);
  const paint = ([title, since]) => {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 512, 128);
    ctx.fillStyle = 'rgba(16, 22, 31, 0.85)';
    ctx.fillRect(0, 0, 512, 128);
    ctx.fillStyle = '#9be0a8';
    ctx.font = '700 44px system-ui, sans-serif';
    ctx.fillText(title, 18, 54);
    ctx.fillStyle = '#c9d6e3';
    ctx.font = '30px system-ui, sans-serif';
    ctx.fillText(since, 18, 104);
    texture.needsUpdate = true;
  };
  return { plate, paint };
}

/** Mounts the table on `parent`; `show(cards, release)` redraws the pile only when it changed. */
export function createReleaseTable(parent) {
  const table = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 0.8 });
  const top = new THREE.Mesh(new THREE.BoxGeometry(TOP.width, 0.08, TOP.depth), wood);
  top.position.y = TOP.height;
  const legs = [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz]) => {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, TOP.height, 0.08), wood);
    leg.position.set(sx * (TOP.width / 2 - 0.1), TOP.height / 2, sz * (TOP.depth / 2 - 0.1));
    return leg;
  });
  const { plate, paint } = sign();
  const pile = new THREE.Group();
  table.add(top, ...legs, plate, pile);
  table.position.set(RELEASE_TABLE.x, 0, RELEASE_TABLE.z);
  table.rotation.y = RELEASE_TABLE.yaw;
  parent.add(table);
  let shown = null;
  return {
    group: table,
    show(cards, release) {
      const key = JSON.stringify([cards.map((c) => c.id), release?.tag ?? null]);
      if (key === shown) return;
      shown = key;
      paint(releaseSign(cards.length, release));
      for (const note of pile.children.splice(0)) { note.geometry.dispose(); note.material.map.dispose(); note.material.dispose(); }
      // Oldest at the bottom: the newest card lies on top, its number up.
      cards.slice(0, PILE_MAX).toReversed().forEach((card, i) => {
        const note = cardNote(card.id);
        note.scale.setScalar(NOTE.size);
        note.rotation.set(-Math.PI / 2, 0, ((i * 37) % 9 - 4) * 0.03); // flat, a little askew
        note.position.set(0, TOP.height + 0.05 + i * NOTE.step, 0);
        pile.add(note);
      });
    },
  };
}

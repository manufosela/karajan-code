// KJC-TSK-1459 (ADR 0050): the factory's task board, a wall beside Karajan's posts with
// three columns (to do, in progress, done). Its cards are the HU Board's ones of the
// project, as the card trace tells them; the external board is never drawn.
import * as THREE from 'three';
import { WALL } from './layout.js';
import { wallColumns } from './wall-layout.js';

const PX = { width: 1024, height: 640, head: 70, row: 84, pad: 14 };
const NOTE = { todo: '#f0d58c', doing: '#8cc8f0', done: '#9be0a8' };
const clip = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** Paints the columns on the wall's canvas. */
function paint(ctx, columns) {
  const colWidth = PX.width / columns.length;
  ctx.fillStyle = '#1e2a38';
  ctx.fillRect(0, 0, PX.width, PX.height);
  columns.forEach((column, i) => {
    const x = i * colWidth;
    const tone = Object.values(NOTE)[i];
    ctx.fillStyle = '#c9d6e3';
    ctx.font = '600 34px system-ui, sans-serif';
    ctx.fillText(column.title, x + PX.pad, 48);
    column.cards.forEach((card, row) => {
      const y = PX.head + row * PX.row;
      ctx.fillStyle = tone;
      ctx.fillRect(x + PX.pad, y, colWidth - 2 * PX.pad, PX.row - 10);
      ctx.fillStyle = '#10161f';
      ctx.font = '700 26px system-ui, sans-serif';
      ctx.fillText(card.id, x + PX.pad + 10, y + 30);
      ctx.font = '22px system-ui, sans-serif';
      ctx.fillText(clip(card.title, 24), x + PX.pad + 10, y + 60);
    });
    if (column.more) {
      ctx.fillStyle = '#9ca6ae';
      ctx.font = '22px system-ui, sans-serif';
      ctx.fillText(`+${column.more} more`, x + PX.pad, PX.height - 12);
    }
  });
}

/** Mounts the wall on `parent`; `show(cards)` repaints it only when what it shows changed. */
export function createWall(parent) {
  const canvas = Object.assign(document.createElement('canvas'), { width: PX.width, height: PX.height });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const board = new THREE.Mesh(new THREE.PlaneGeometry(WALL.width, WALL.height), new THREE.MeshBasicMaterial({ map: texture }));
  const frame = new THREE.Mesh(new THREE.BoxGeometry(WALL.width + 0.16, WALL.height + 0.16, 0.08), new THREE.MeshStandardMaterial({ color: 0x3a4656, roughness: 0.7 }));
  board.position.z = 0.05;
  const wall = new THREE.Group();
  wall.add(frame, board);
  wall.position.set(WALL.x, WALL.y + WALL.height / 2, WALL.z);
  parent.add(wall);
  let shown = null;
  return {
    group: wall,
    show(cards) {
      const columns = wallColumns(cards ?? []);
      const key = JSON.stringify(columns);
      if (key === shown) return;
      shown = key;
      paint(canvas.getContext('2d'), columns);
      texture.needsUpdate = true;
    },
  };
}

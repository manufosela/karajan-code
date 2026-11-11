// KJC-TSK-1545 (asked by the maintainer on 2026-11-11): the version counter beside the "Ready to
// release" table: a board on a post that says the project's last release. release.js says what.
import * as THREE from 'three';
import { VERSION_BOARD } from './layout.js';

const POST_HEIGHT = 1.5;
const PANEL = { width: 1.4, height: 0.7 };

/** Mounts the counter on `parent`; `show(line)` repaints it only when the line changed. */
export function createVersionBoard(parent) {
  const board = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0x3a4656, roughness: 0.6 });
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, POST_HEIGHT, 0.1), metal);
  post.position.y = POST_HEIGHT / 2;
  const canvas = Object.assign(document.createElement('canvas'), { width: 512, height: 256 });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(PANEL.width, PANEL.height), new THREE.MeshBasicMaterial({ map: texture }));
  panel.position.set(0, POST_HEIGHT + PANEL.height / 2 - 0.1, 0.06);
  board.add(post, panel);
  board.position.set(VERSION_BOARD.x, 0, VERSION_BOARD.z);
  board.rotation.y = VERSION_BOARD.yaw;
  parent.add(board);
  let shown = null;
  return {
    group: board,
    show(line) {
      if (line === shown) return;
      shown = line;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#10161f';
      ctx.fillRect(0, 0, 512, 256);
      ctx.strokeStyle = '#9be0a8';
      ctx.lineWidth = 8;
      ctx.strokeRect(4, 4, 504, 248);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#c9d6e3';
      ctx.font = '600 40px system-ui, sans-serif';
      ctx.fillText('Version', 256, 70);
      ctx.fillStyle = '#9be0a8';
      // As large as fits: "no release yet" is longer than a tag.
      let size = 96;
      do ctx.font = `700 ${size--}px system-ui, sans-serif`;
      while (size > 40 && ctx.measureText(line).width > 470);
      ctx.fillText(line, 256, 180, 470);
      texture.needsUpdate = true;
    },
  };
}

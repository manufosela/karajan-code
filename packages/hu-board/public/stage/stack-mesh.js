// KJC-TSK-1623: the stack of finished workshops by the "Ready to release" table: one block per
// lane, its HU on its faces. finished-stack.js says which blocks and where each one stands.
import * as THREE from 'three';
import { STACK, stackSpot } from './finished-stack.js';

/** A block with its `label` painted on every face, in the workshop pad's colours. */
function block(label) {
  const canvas = Object.assign(document.createElement('canvas'), { width: 128, height: 128 });
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#243244';
  ctx.fillRect(0, 0, 128, 128);
  ctx.strokeStyle = '#8cb4c9';
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, 122, 122);
  ctx.fillStyle = '#e2e8f0';
  ctx.font = '700 26px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, 64, 64, 116);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(new THREE.BoxGeometry(STACK.size, STACK.size, STACK.size), new THREE.MeshStandardMaterial({ map: texture, roughness: 0.7 }));
}

/** Mounts the stack on `scene`; `show(blocks)` restacks it only when its blocks changed. */
export function createStack(scene) {
  const group = new THREE.Group();
  scene.add(group);
  let shown = '';
  return {
    show(blocks) {
      const key = blocks.map((b) => b.lane).join('|');
      if (key === shown) return;
      shown = key;
      for (const child of group.children) {
        child.geometry.dispose();
        child.material.map.dispose();
        child.material.dispose();
      }
      group.clear();
      blocks.forEach(({ label }, i) => {
        const mesh = block(label);
        const at = stackSpot(i);
        mesh.position.set(at.x, at.y, at.z);
        mesh.castShadow = true;
        group.add(mesh);
      });
    },
  };
}

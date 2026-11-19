// KJC-TSK-1704: the warehouse beside the hall: shelves where each stored workshop waits as a slab
// with its short name on its front and top. warehouse.js says where each slab stands.
import * as THREE from 'three';
import { labelTexture } from './cast/props.js';
import { plateName } from './lane-status.js';
import { RACK, rackBays, rackSpot } from './warehouse.js';

/** A stored workshop's short name: its HU, else the start of its lane's name. */
export const slabLabel = (lane) => /^HU-\d+/.exec(lane)?.[0] ?? plateName(lane).slice(0, 12);

/** A slab: the workshop's pad, its name on its top and on the face towards the camera. */
function slab(label) {
  const side = new THREE.MeshStandardMaterial({ color: 0x243244, roughness: 0.8 });
  const face = new THREE.MeshStandardMaterial({ map: labelTexture(['', label], { height: 150 }), roughness: 0.8 });
  // BoxGeometry faces: +x, -x, +y, -y, +z, -z.
  return new THREE.Mesh(new THREE.BoxGeometry(RACK.w, RACK.h, RACK.d), [side, side, face, side, face, side]);
}

const steel = new THREE.MeshStandardMaterial({ color: 0x4a5566, roughness: 0.6, metalness: 0.4 });

const placed = (geometry, x, y, z) => {
  const mesh = new THREE.Mesh(geometry, steel);
  mesh.position.set(x, y, z);
  return mesh;
};

/** The shelves for `bays` bays: a plank under each level, a side panel at each end. */
function shelves(bays) {
  const group = new THREE.Group();
  const depth = bays * RACK.bay;
  const z = rackSpot(0).z - RACK.bay / 2 + depth / 2;
  const top = rackSpot(RACK.high - 1).y + RACK.h;
  for (let level = 0; level < RACK.high; level += 1) group.add(placed(new THREE.BoxGeometry(RACK.w + 0.2, 0.05, depth), RACK.x, rackSpot(level).y - RACK.h / 2 - 0.03, z));
  for (const dx of [-1, 1]) group.add(placed(new THREE.BoxGeometry(0.05, top, depth), RACK.x + dx * (RACK.w / 2 + 0.1), top / 2, z));
  return group;
}

const dispose = (group) => group.traverse((o) => {
  o.geometry?.dispose();
  for (const m of [o.material ?? []].flat().filter((m) => m !== steel)) { m.map?.dispose(); m.dispose(); }
});

/** Mounts the warehouse on `scene`; `show(lanes)` (by slot, null a gap) rebuilds it only when they change. */
export function createRack(scene) {
  const group = new THREE.Group();
  scene.add(group);
  let shown = '';
  return {
    show(lanes) {
      const key = lanes.join('|');
      if (key === shown) return;
      shown = key;
      dispose(group);
      group.clear();
      if (!lanes.some(Boolean)) return;
      group.add(shelves(rackBays(lanes.length)));
      lanes.forEach((lane, i) => {
        if (!lane) return;
        const mesh = slab(slabLabel(lane));
        const at = rackSpot(i);
        mesh.position.set(at.x, at.y, at.z);
        group.add(mesh);
      });
    },
  };
}

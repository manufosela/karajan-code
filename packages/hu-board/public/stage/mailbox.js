// KJC-TSK-1473: the human's mailbox at the front corner of each factory's floor.
// A post, a box and a flag; the box and the flag glow amber as mail.js says.
import * as THREE from 'three';

const AMBER = 0xffb347;
const POST_H = 2.2;

const part = (geometry, material, { x = 0, y = 0, z = 0 } = {}) => {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  return mesh;
};

/** The mailbox as a group, and `light(k)` that sets its glow from 0 (dark) to 1. */
export function createMailbox() {
  const group = new THREE.Group();
  group.name = 'mailbox';
  const post = new THREE.MeshStandardMaterial({ color: 0x4a5566, roughness: 0.8 });
  const box = new THREE.MeshStandardMaterial({ color: 0x2f6f9f, emissive: AMBER, emissiveIntensity: 0, roughness: 0.5 });
  const flag = new THREE.MeshStandardMaterial({ color: 0xd9483b, emissive: AMBER, emissiveIntensity: 0 });
  group.add(part(new THREE.BoxGeometry(0.25, POST_H, 0.25), post, { y: POST_H / 2 }));
  group.add(part(new THREE.BoxGeometry(1.4, 1, 1.9), box, { y: POST_H + 0.5 }));
  group.add(part(new THREE.BoxGeometry(0.08, 0.9, 0.5), flag, { x: 0.75, y: POST_H + 1.1, z: 0.5 }));
  const light = (k) => { box.emissiveIntensity = 1.6 * k; flag.emissiveIntensity = 1.6 * k; };
  return { group, light };
}

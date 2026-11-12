// KJC-TSK-1547: the drone that takes the "Ready to release" pile away: a body, four rotors and,
// under it while it carries, the pile as one parcel. drone.js says where it is and when it carries.
import * as THREE from 'three';

/** Mounts the drone on `parent`, hidden; `show(pose, now)` flies it, a null pose hides it. */
export function createDrone(parent) {
  const drone = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: 0x1b1f27, roughness: 0.5 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.18, 0.7), new THREE.MeshStandardMaterial({ color: 0xeef1f6, roughness: 0.4 }));
  const rotors = [[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([sx, sz]) => {
    const rotor = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.015, 0.06), dark);
    rotor.position.set(sx * 0.5, 0.12, sz * 0.5);
    return rotor;
  });
  // The cards it carries, as a parcel of paper the size of the table's pile.
  const parcel = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.2, 0.45), new THREE.MeshStandardMaterial({ color: 0xf3e3a1, roughness: 0.9 }));
  parcel.position.y = -0.3;
  drone.add(body, parcel, ...rotors);
  drone.visible = false;
  parent.add(drone);
  return {
    group: drone,
    show(pose, now) {
      drone.visible = Boolean(pose);
      if (!pose) return;
      drone.position.set(pose.x, pose.y, pose.z);
      for (const rotor of rotors) rotor.rotation.y = now / 30;
      parcel.visible = pose.carrying;
    },
  };
}

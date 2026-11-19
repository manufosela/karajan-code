// KJC-TSK-1701: a piece's drone: a body in the piece's colour, four rotors, a camera on a rope under it
// and its shadow on the floor, smaller and fainter the higher it flies. piece-drone.js says where it is.
import * as THREE from 'three';

/** Each piece's colour, so its drone is known for whose it is. */
export const DRONE_TINT = { tdd: 0x3fb950, sonar: 0x4e9bd8, steward: 0xb07cd8, ledger: 0xe8b04b, gates: 0xe07a5f };
const TONE = { approve: 0x2fd27a, refuse: 0xff5d5d };

/** Mounts a drone of `tint` on `parent`; `show(pose, act, now)` flies it, lowers its camera and lights it. */
export function createPieceDrone(parent, tint) {
  const drone = new THREE.Group();
  const shell = new THREE.MeshStandardMaterial({ color: tint, roughness: 0.4, emissive: new THREE.Color(0) });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1b1f27, roughness: 0.5 });
  const rotors = [[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([sx, sz]) => {
    const rotor = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.012, 0.04), dark);
    rotor.position.set(sx * 0.3, 0.09, sz * 0.3);
    return rotor;
  });
  const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 1, 6), dark);
  const camera = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.1, 0.14), dark);
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.06, 12), shell);
  lens.rotation.x = Math.PI / 2;
  lens.position.z = 0.09;
  camera.add(lens);
  drone.add(new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.12, 0.42), shell), ...rotors, rope, camera);
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.4, 24), new THREE.MeshBasicMaterial({ color: 0, transparent: true, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  drone.scale.setScalar(1.6); // as big as its piece's head, so it reads from the camera
  parent.add(drone, shadow);
  return {
    show(pose, act, now) {
      drone.position.set(pose.x, pose.y, pose.z);
      for (const rotor of rotors) rotor.rotation.y = pose.flying ? now / 25 : 0;
      rope.visible = pose.cable > 0.01;
      rope.scale.y = Math.max(pose.cable, 0.01);
      rope.position.y = -0.06 - pose.cable / 2;
      camera.position.y = -0.11 - pose.cable;
      // It lights in the result's colour once its piece knows it.
      shell.emissive.setHex(TONE[act?.kind] ?? 0);
      shell.emissiveIntensity = TONE[act?.kind] ? 0.8 : 0;
      shadow.visible = pose.flying;
      shadow.position.set(pose.x, 0.02, pose.z);
      shadow.scale.setScalar(Math.max(0.4, 1.2 - pose.y / 5));
      shadow.material.opacity = Math.max(0.12, 0.45 - pose.y / 10);
    },
  };
}

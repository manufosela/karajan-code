// KJC-TSK-1701: a piece's drone: a body in the piece's colour, four rotors, a camera on a rope under it
// and its shadow on the floor, smaller and fainter the higher it flies. piece-drone.js says where it is.
import * as THREE from 'three';

export { DRONE_TINT, SENTINEL_TINT } from './drone-tint.js';
const TONE = { approve: 0x2fd27a, refuse: 0xff5d5d };

/**
 * KJC-TSK-1712: where each of the four motors sits, at the end of an arm in X, and its props'
 * reach: guards and all, a docked drone stays narrower than the gap between two posts.
 */
const ARM = 0.27;
const PROP_R = 0.13;

/**
 * KJC-TSK-1712 (the maintainer, 2026-11-21): the black rotors did not stand out from the floor and
 * the drones read as squares flying. Now a rounded body in the piece's colour with a light canopy,
 * four light arms in X, motors with a guard ring each, two-bladed props and, in flight, the pale
 * disc a spinning prop leaves, landing skids and a light in the piece's colour on each motor.
 */
function rotorAt(sx, sz, light, metal, glow) {
  const rotor = new THREE.Group();
  rotor.position.set(sx * ARM, 0.05, sz * ARM);
  const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.07, 12), metal);
  const guard = new THREE.Mesh(new THREE.TorusGeometry(PROP_R + 0.02, 0.012, 6, 28), light);
  guard.rotation.x = Math.PI / 2;
  guard.position.y = 0.05;
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 6), glow);
  led.position.y = -0.045;
  const prop = new THREE.Group();
  prop.position.y = 0.05;
  for (const turn of [0, Math.PI / 2]) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(PROP_R * 2, 0.008, 0.035), light);
    blade.rotation.y = turn;
    prop.add(blade);
  }
  const blur = new THREE.Mesh(new THREE.CircleGeometry(PROP_R, 24),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide }));
  blur.rotation.x = -Math.PI / 2;
  blur.position.y = 0.055;
  rotor.add(motor, guard, led, prop, blur);
  return { rotor, prop, blur };
}

/** Mounts a drone of `tint` on `parent`; `show(pose, act, now)` flies it, lowers its camera and lights it. */
export function createPieceDrone(parent, tint) {
  const drone = new THREE.Group();
  const shell = new THREE.MeshStandardMaterial({ color: tint, roughness: 0.35, metalness: 0.1, emissive: new THREE.Color(0) });
  const light = new THREE.MeshStandardMaterial({ color: 0xe6ebf2, roughness: 0.45 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x9aa6b5, roughness: 0.3, metalness: 0.6 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a313c, roughness: 0.5 });
  const glow = new THREE.MeshBasicMaterial({ color: tint });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.2, 20, 12), shell);
  body.scale.set(1, 0.45, 1.25);
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), light);
  canopy.position.set(0, 0.06, -0.03);
  const arms = [1, -1].map((side) => {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(ARM * 2 * Math.SQRT2, 0.035, 0.05), light);
    arm.rotation.y = side * Math.PI / 4;
    arm.position.y = 0.02;
    return arm;
  });
  const skids = [1, -1].map((side) => {
    const skid = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.42, 6), light);
    skid.rotation.x = Math.PI / 2;
    skid.position.set(side * 0.13, -0.12, 0);
    return skid;
  });
  const legs = [1, -1].flatMap((sx) => [1, -1].map((sz) => {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.1, 6), light);
    leg.position.set(sx * 0.13, -0.075, sz * 0.12);
    return leg;
  }));
  const rotors = [[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([sx, sz]) => rotorAt(sx, sz, light, metal, glow));
  const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 1, 6), light);
  const camera = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.1, 0.14), dark);
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.06, 12), shell);
  lens.rotation.x = Math.PI / 2;
  lens.position.z = 0.09;
  camera.add(lens);
  drone.add(body, canopy, ...arms, ...skids, ...legs, ...rotors.map((r) => r.rotor), rope, camera);
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.4, 24), new THREE.MeshBasicMaterial({ color: 0, transparent: true, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  drone.scale.setScalar(1.6); // as big as its piece's head, so it reads from the camera
  parent.add(drone, shadow);
  return {
    show(pose, act, now) {
      drone.position.set(pose.x, pose.y, pose.z);
      // In flight the props spin and leave their pale disc; its lights blink in the piece's colour.
      rotors.forEach(({ prop, blur }, i) => {
        const spin = i % 2 ? -1 : 1; // neighbours turn opposite ways, as on a real quadcopter
        prop.rotation.y = pose.flying ? spin * now / 25 : 0;
        blur.visible = pose.flying;
      });
      glow.color.setHex(pose.flying && Math.floor(now / 400) % 2 ? 0xffffff : tint);
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

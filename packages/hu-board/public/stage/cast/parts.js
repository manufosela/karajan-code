// The family's shared features for the characters that are objects of the
// orchestra (atril, and the smaller members on the family page): the robots'
// dark visor with two glowing eyes, and thin arms with white hands.
// 'three' is the landing's trimmed bundle (public/lib/three.min.js).
import * as THREE from 'three';

/**
 * A visor `width` wide (atril's is 0.66, the reference size) with two eyes
 * glowing in `color`. Returns the face and its eyes, which blink and look.
 */
export function createFace(color, width = 0.66) {
  const s = width / 0.66;
  const face = new THREE.Group();
  const visor = new THREE.Mesh(
    new THREE.RoundedBoxGeometry(width, 0.3 * s, 0.08 * s, 3, 0.07 * s),
    new THREE.MeshStandardMaterial({ color: 0x0b1118, roughness: 0.25, metalness: 0.4 }),
  );
  const glow = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 2.4 });
  const eyes = new THREE.Group();
  eyes.position.z = 0.045 * s;
  const eyeGeo = new THREE.CapsuleGeometry(0.036 * s, 0.1 * s, 4, 10);
  for (const x of [-0.13 * s, 0.13 * s]) {
    const eye = new THREE.Mesh(eyeGeo, glow);
    eye.position.x = x;
    eyes.add(eye);
  }
  face.add(visor, eyes);
  return { face, eyes };
}

// atril's arm, the reference: 0.44 long, 0.022 thick, with a 0.06 hand.
const BONE = 0.022 / 0.44, HAND = 0.06 / 0.44;

/** A thin arm `length` long hanging from its shoulder (the group returned), with a white hand. */
export function createArm(metal, white, length) {
  const shoulder = new THREE.Group();
  const bone = new THREE.Mesh(new THREE.CylinderGeometry(BONE * length, BONE * length, length, 10), metal);
  bone.position.y = -length / 2;
  const hand = new THREE.Mesh(new THREE.SphereGeometry(HAND * length, 16, 12), white);
  hand.position.y = -length;
  shoulder.add(bone, hand);
  return shoulder;
}

/** The family's metal in `color`, and the white of the robots' hands. */
export const metalIn = (color) => new THREE.MeshPhysicalMaterial({ color, roughness: 0.32, metalness: 0.75, clearcoat: 0.4 });
export const handWhite = () => new THREE.MeshPhysicalMaterial({ color: 0xe6eaf0, roughness: 0.35, clearcoat: 0.6 });

/** Two small feet `spread` apart, for the characters that stand on the floor. */
export function createFeet(material, spread) {
  return [-spread, spread].map((x) => {
    const foot = new THREE.Mesh(new THREE.CapsuleGeometry(0.04, 0.07, 4, 10), material);
    foot.rotation.x = Math.PI / 2;
    foot.position.set(x, 0.04, 0.04);
    return foot;
  });
}

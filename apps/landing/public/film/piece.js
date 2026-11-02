// The method's pieces as characters of the orchestra: each stands on a plinth
// that carries its number and name, wears the family's face and arms, and
// lights up like the crates did. Its body (pieces/*.js) says what it does.
// 'three' is the landing's trimmed bundle (public/lib/three.min.js).
import * as THREE from 'three';
import { createArm, createFace, handWhite, metalIn } from './parts.js';
import { labelTexture, KINDS, RED } from './props.js';

/** The plinth's size, and the height where the hands meet to catch the diff. */
export const PIECE = { w: 1.0, plinth: 0.3, d: 0.62, catchY: 1.66 };
const ARM = 0.42;
// Arms hang a little open at rest and rise above the head to catch.
const REST = 0.45, CATCH = Math.PI - 0.5;

/**
 * A piece on the staff. `kind` is 'method' or 'tool'; `body(look)` builds what
 * stands on the plinth and returns { group, face: { y, z, width }, shoulders: { x, y, z } }.
 */
export function createPiece(index, name, { kind, body }) {
  const look = KINDS[kind];
  if (!look) throw new Error(`piece "${name}": unknown kind "${kind}"`);
  const group = new THREE.Group();
  const stone = new THREE.MeshPhysicalMaterial({
    color: look.body, roughness: 0.45, metalness: 0.2, clearcoat: 0.6, emissive: new THREE.Color(0x000000),
  });
  const plinth = new THREE.Mesh(new THREE.RoundedBoxGeometry(PIECE.w, PIECE.plinth, PIECE.d, 3, 0.05), stone);
  plinth.position.y = PIECE.plinth / 2;
  const plateMaterial = new THREE.MeshBasicMaterial({
    map: labelTexture([String(index + 1).padStart(2, '0'), name], { color: look.ink, height: 170 }),
    transparent: true, toneMapped: false,
  });
  // The plate keeps the label's 512x170 proportions across the plinth's front.
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(PIECE.w * 0.9, PIECE.w * 0.3), plateMaterial);
  plate.position.set(0, PIECE.plinth / 2, PIECE.d / 2 + 0.003);
  const built = body(look);
  built.group.position.y = PIECE.plinth;
  const { face, eyes } = createFace(look.glow.getHex(), built.face.width);
  face.position.set(0, PIECE.plinth + built.face.y, built.face.z);
  const metal = metalIn(look.strip);
  const white = handWhite();
  const arms = [-1, 1].map((side) => {
    const arm = createArm(metal, white, ARM);
    arm.position.set(side * built.shoulders.x, PIECE.plinth + built.shoulders.y, built.shoulders.z);
    arm.rotation.z = side * REST;
    return arm;
  });
  const glow = eyes.children[0].material;
  group.add(plinth, plate, built.group, face, ...arms);
  return {
    group,
    /** gold: earned light (0..1), in the piece's own colour; red: refusal flash (0..1). */
    setLight(gold, red = 0) {
      stone.emissive.copy(look.glow).multiplyScalar(gold * 0.16).lerp(RED.clone().multiplyScalar(0.55), red);
      glow.emissive.copy(look.glow).lerp(RED, red);
      glow.emissiveIntensity = 1.2 + 1.6 * Math.max(gold, red);
      plateMaterial.color.setScalar(0.55 + 0.45 * Math.max(gold, red));
    },
    /** Raises both arms over the head (0..1) to catch or hold the diff. */
    catch(level) {
      arms.forEach((arm, i) => { arm.rotation.z = (i ? 1 : -1) * (REST + (CATCH - REST) * level); });
    },
    /** Shakes its head no (amount 0..1 at film time t). */
    shake(amount, t) {
      face.rotation.y = amount * 0.5 * Math.sin(t * 22);
    },
  };
}

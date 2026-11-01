// A Karajan family robot built from primitives, faithful to the logo:
// round helmet, dark visor with glowing eyes, suspenders and bow tie in the
// member's colour, two articulated arms and a baton.
// 'three' is the landing's trimmed bundle (public/lib/three.min.js): the core
// classes and the addons the film uses, all under one name (tests/landing/three-bundle.test.js).
import * as THREE from 'three';
import { buildHead } from './robot-head.js';
import { createContactShadow } from './props.js';

const BODY_PROFILE = [
  [0, 0], [0.42, 0.02], [0.7, 0.14], [0.84, 0.38], [0.87, 0.66],
  [0.8, 0.96], [0.64, 1.22], [0.42, 1.4], [0.001, 1.46],
];

const radiusAt = (y) => {
  for (let i = 1; i < BODY_PROFILE.length; i++) {
    const [r0, y0] = BODY_PROFILE[i - 1];
    const [r1, y1] = BODY_PROFILE[i];
    if (y <= y1) return r0 + ((r1 - r0) * (y - y0)) / (y1 - y0);
  }
  return 0;
};

const shell = (color, extra = {}) => new THREE.MeshPhysicalMaterial({
  color, roughness: 0.3, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.15, ...extra,
});

const castAll = (object) => object.traverse((o) => { if (o.isMesh) o.castShadow = true; });

function buildArm(side, materials) {
  const pivot = new THREE.Group();
  pivot.position.set(side * 0.8, 1.12, 0);
  const swing = new THREE.Group();
  pivot.add(swing);
  const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.5, 8, 20), materials.white);
  upper.position.y = -0.45;
  const hand = new THREE.Mesh(new THREE.SphereGeometry(0.2, 24, 16), materials.white);
  hand.position.y = -0.9;
  swing.add(upper, hand);
  return { pivot, swing, hand };
}

function buildBaton(materials) {
  const baton = new THREE.Group();
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.026, 1.45, 10), materials.baton);
  stick.position.y = -0.72;
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.04, 12, 8), materials.white);
  tip.position.y = -1.45;
  baton.add(stick, tip);
  baton.position.y = -0.95;
  baton.rotation.z = 0.35;
  return baton;
}

function buildTorso(materials) {
  const torso = new THREE.Group();
  const outline = new THREE.SplineCurve(BODY_PROFILE.map(([r, y]) => new THREE.Vector2(r, y))).getPoints(48);
  torso.add(new THREE.Mesh(new THREE.LatheGeometry(outline, 64), materials.white));
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.34, 0.24, 24), materials.grey);
  neck.position.y = 1.5;
  torso.add(neck);
  for (const side of [-1, 1]) {
    const points = [];
    for (let i = 0; i <= 12; i++) {
      const u = i / 12;
      const y = 1.3 - u * 1.06;
      const x = side * (0.27 + u * 0.2);
      const z = Math.sqrt(Math.max(radiusAt(y) ** 2 - x * x, 0.01)) + 0.025;
      points.push(new THREE.Vector3(x, y, z));
    }
    const strap = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 32, 0.042, 8), materials.accent);
    const button = new THREE.Mesh(new THREE.SphereGeometry(0.065, 12, 8), materials.accent);
    button.position.copy(points.at(-1));
    torso.add(strap, button);
  }
  const bowY = 1.3;
  const bowZ = radiusAt(bowY) + 0.06;
  for (const side of [-1, 1]) {
    const wing = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.27, 20), materials.bow);
    wing.rotation.z = side * Math.PI / 2;
    wing.position.set(side * 0.15, bowY, bowZ);
    wing.scale.z = 0.55;
    torso.add(wing);
  }
  const knot = new THREE.Mesh(new THREE.SphereGeometry(0.07, 16, 12), materials.bow);
  knot.position.set(0, bowY, bowZ + 0.02);
  torso.add(knot);
  return torso;
}

/**
 * @param {{ accent: number, bow?: number, name: string }} options
 */
export function createRobot({ accent, bow = accent, name }) {
  const accentColor = new THREE.Color(accent);
  const materials = {
    white: shell(0xe6eaf0),
    grey: shell(0xaab5c0),
    frame: shell(0x2a3038, { roughness: 0.4 }),
    visor: shell(0x173247, { roughness: 0.08, clearcoatRoughness: 0.04 }),
    glow: new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 2.4 }),
    accent: new THREE.MeshStandardMaterial({ color: accent, roughness: 0.4, emissive: accent, emissiveIntensity: 0.12 }),
    bow: shell(bow),
    baton: shell(0xd8dde3, { roughness: 0.25 }),
  };

  const root = new THREE.Group();
  root.name = name;
  const hover = new THREE.Group();
  hover.position.y = 0.1;
  root.add(hover, createContactShadow());

  const torso = buildTorso(materials);
  const { head, eyes } = buildHead(materials);
  const armL = buildArm(-1, materials);
  const armR = buildArm(1, materials);
  armR.hand.add(buildBaton(materials));
  hover.add(torso, head, armL.pivot, armR.pivot);
  castAll(hover);

  return {
    root, hover, head, eyes, armL, armR,
    /** Glow of eyes and mouth: 0 is off, 1 is the resting glow. */
    setGlow(level) {
      materials.glow.emissiveIntensity = 2.4 * level;
      materials.glow.color.setScalar(0).lerp(accentColor, Math.min(1, level));
    },
    /** 0 = eyes open, 1 = closed. */
    setBlink(amount) { eyes.scale.y = 1 - 0.9 * amount; },
    /** Pose an arm: spread swings it sideways (0 down, ~2.5 up), forward swings it to the front. */
    pose(arm, spread, forward = 0) {
      const a = arm === 'L' ? armL : armR;
      a.pivot.rotation.z = (arm === 'L' ? -1 : 1) * spread;
      a.swing.rotation.x = -forward;
    },
  };
}

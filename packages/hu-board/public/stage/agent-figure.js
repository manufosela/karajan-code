// KJC-TSK-1814 (decided by the maintainer on 2026-11-27, ADR "kj stage en una línea"): an agent is a
// figure other than Karajan's robot, the same for every agent and painted whole in its agent's colour.
// Where Karajan floats, white, with a round helmet, bow tie and suspenders, the agent stands on two
// legs, with a slim body and a square head whose face is a screen with two round eyes. It answers as
// createRobot does (cast/robot.js), so what dresses, poses and seats a robot does the same with it.
import * as THREE from 'three';
import { FIGURE } from './agent-figure-shape.js';
import { createContactShadow } from './cast/props.js';

const EYES_LIT = 0xf4f8ff;

const paintOf = (color) => new THREE.MeshPhysicalMaterial({ color, roughness: 0.38, clearcoat: 0.8, clearcoatRoughness: 0.2 });
const mesh = (geometry, material, [x, y, z] = [0, 0, 0]) => {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(x, y, z);
  return m;
};

function buildLegs(m) {
  const { height, apart, radius } = FIGURE.legs;
  return [-apart, apart].flatMap((x) => [
    mesh(new THREE.CylinderGeometry(radius, radius, height, 16), m.trim, [x, height / 2, 0]),
    mesh(new THREE.BoxGeometry(radius * 2.4, 0.1, radius * 3.4), m.dark, [x, 0.05, radius * 0.6]),
  ]);
}

function buildBody(m) {
  const { bottom, top, radius, waist } = FIGURE.body;
  const body = mesh(new THREE.CylinderGeometry(radius, waist, top - bottom, 32), m.paint, [0, (bottom + top) / 2, 0]);
  const shoulders = mesh(new THREE.SphereGeometry(radius, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2), m.paint, [0, top, 0]);
  shoulders.scale.y = 0.35;
  const belt = mesh(new THREE.TorusGeometry(waist + 0.01, 0.05, 8, 32), m.trim, [0, bottom + 0.06, 0]);
  belt.rotation.x = Math.PI / 2;
  const neck = mesh(new THREE.CylinderGeometry(FIGURE.neck.radius, FIGURE.neck.radius, FIGURE.neck.height, 16), m.trim, [0, top + FIGURE.neck.height / 2, 0]);
  return [body, shoulders, belt, neck];
}

/** The square head, its face a dark screen with two round eyes and a short mouth lit in white. */
function buildHead(m) {
  const { y, width, height, depth, round } = FIGURE.head;
  const head = new THREE.Group();
  head.position.y = y;
  head.add(mesh(new THREE.RoundedBoxGeometry(width, height, depth, 5, round), m.paint));
  const front = depth / 2;
  head.add(mesh(new THREE.RoundedBoxGeometry(FIGURE.screen.width, FIGURE.screen.height, 0.1, 4, 0.14), m.dark, [0, 0, front]));
  const eyes = new THREE.Group();
  eyes.position.z = front + 0.06;
  for (const x of [-0.3, 0.3]) {
    const eye = mesh(new THREE.SphereGeometry(0.13, 20, 14), m.glow, [x, 0.08, 0]);
    eye.scale.z = 0.3;
    eyes.add(eye);
  }
  const mouth = mesh(new THREE.CapsuleGeometry(0.035, 0.22, 4, 8), m.glow, [0, -0.24, front + 0.06]);
  mouth.rotation.z = Math.PI / 2;
  head.add(eyes, mouth);
  return { head, eyes };
}

function buildArm(side, m) {
  const pivot = new THREE.Group();
  pivot.position.set(side * FIGURE.shoulder.x, FIGURE.shoulder.y, 0);
  const swing = new THREE.Group();
  pivot.add(swing);
  const upper = mesh(new THREE.CapsuleGeometry(0.16, 0.55, 8, 16), m.paint, [0, -0.45, 0]);
  const hand = mesh(new THREE.SphereGeometry(0.19, 20, 14), m.dark, [0, -0.9, 0]);
  swing.add(mesh(new THREE.SphereGeometry(0.2, 16, 12), m.trim), upper, hand);
  return { pivot, swing, hand };
}

/**
 * The agent `name` painted whole in `color`, with the interface of createRobot: root, hover, head,
 * eyes, armL and armR (pivot, swing, hand), setGlow, setBlink and pose.
 */
export function createAgentFigure({ color, name }) {
  const m = {
    paint: paintOf(color),
    trim: paintOf(new THREE.Color(color).multiplyScalar(0.62)),
    dark: new THREE.MeshStandardMaterial({ color: 0x1b2029, roughness: 0.3, metalness: 0.3 }),
    glow: new THREE.MeshStandardMaterial({ color: EYES_LIT, emissive: EYES_LIT, emissiveIntensity: 1.6 }),
  };
  const root = new THREE.Group();
  root.name = name;
  const hover = new THREE.Group();
  root.add(hover, createContactShadow());
  const { head, eyes } = buildHead(m);
  const armL = buildArm(-1, m);
  const armR = buildArm(1, m);
  hover.add(...buildLegs(m), ...buildBody(m), head, armL.pivot, armR.pivot);
  hover.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  const lit = new THREE.Color(EYES_LIT);
  return {
    root, hover, head, eyes, armL, armR,
    setGlow(level) {
      m.glow.emissiveIntensity = 1.6 * level;
      m.glow.color.setScalar(0).lerp(lit, Math.min(1, level));
    },
    setBlink(amount) { eyes.scale.y = 1 - 0.9 * amount; },
    pose(arm, spread, forward = 0) {
      const a = arm === 'L' ? armL : armR;
      a.pivot.rotation.z = (arm === 'L' ? -1 : 1) * spread;
      a.swing.rotation.x = -forward;
    },
  };
}

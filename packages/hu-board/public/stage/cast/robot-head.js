// The robot's head, faithful to the logo: round helmet, dark visor with
// glowing capsule eyes, the tilde over the left eye and a small V mouth.
// 'three' is the landing's trimmed bundle (public/lib/three.min.js): the core
// classes and the addons the film uses, all under one name (tests/landing/three-bundle.test.js).
import * as THREE from 'three';

function buildFace(materials) {
  const face = new THREE.Group();
  const eyeGeo = new THREE.CapsuleGeometry(0.062, 0.2, 6, 12);
  const eyeL = new THREE.Mesh(eyeGeo, materials.glow);
  eyeL.position.set(-0.34, 0, 0);
  const eyeR = new THREE.Mesh(eyeGeo, materials.glow);
  eyeR.position.set(0.34, 0.02, 0);
  eyeR.scale.y = 1.12;
  const tildePoints = [];
  for (let i = 0; i <= 16; i++) {
    const u = i / 16;
    tildePoints.push(new THREE.Vector3(-0.15 + u * 0.3, Math.sin(u * Math.PI * 2) * 0.035, 0));
  }
  const tilde = new THREE.Mesh(
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(tildePoints), 24, 0.03, 8),
    materials.glow,
  );
  tilde.position.set(-0.34, 0.25, 0);
  const mouthGeo = new THREE.CapsuleGeometry(0.026, 0.09, 4, 8);
  const mouthL = new THREE.Mesh(mouthGeo, materials.glow);
  mouthL.position.set(-0.04, -0.27, 0);
  mouthL.rotation.z = 0.6;
  const mouthR = new THREE.Mesh(mouthGeo, materials.glow);
  mouthR.position.set(0.04, -0.27, 0);
  mouthR.rotation.z = -0.6;
  const eyes = new THREE.Group();
  eyes.add(eyeL, eyeR, tilde);
  face.add(eyes, mouthL, mouthR);
  return { face, eyes };
}

export function buildHead(materials) {
  const head = new THREE.Group();
  head.position.y = 2.4;
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.98, 48, 32), materials.white);
  helmet.scale.set(1.16, 0.9, 0.86);
  const frame = new THREE.Mesh(new THREE.RoundedBoxGeometry(1.76, 1.12, 0.3, 5, 0.14), materials.frame);
  frame.position.z = 0.73;
  const visor = new THREE.Mesh(new THREE.RoundedBoxGeometry(1.6, 0.98, 0.3, 5, 0.13), materials.visor);
  visor.position.z = 0.78;
  const { face, eyes } = buildFace(materials);
  face.position.z = 0.935;
  head.add(helmet, frame, visor, face);
  for (const side of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.27, 0.22, 32), materials.white);
    ear.rotation.z = Math.PI / 2;
    ear.position.x = side * 1.1;
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.08, 24), materials.grey);
    cap.rotation.z = Math.PI / 2;
    cap.position.x = side * 1.22;
    head.add(ear, cap);
  }
  return { head, eyes };
}

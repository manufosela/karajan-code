// The concert hall: a dark floor, a glowing staff where the tools line up,
// a key spotlight with a visible beam and dust, wing lights and the shell.
// 'three' is the landing's trimmed bundle (public/lib/three.min.js): the core
// classes and the addons the film uses, all under one name (tests/landing/three-bundle.test.js).
import * as THREE from 'three';
import { beamMaterial, dustField } from './stage-fx.js';

export const STAFF = { from: -6.4, to: 6.6, z: 1.6, gap: 0.26, lines: 5 };
export const PODIUM = { x: 0, z: -2.2, h: 0.4 };

function staffLines() {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ color: 0x3b4f66, emissive: 0x6b8fa3, emissiveIntensity: 0.55 });
  const length = STAFF.to - STAFF.from;
  const geometry = new THREE.BoxGeometry(length, 0.008, 0.028);
  geometry.translate(length / 2, 0, 0);
  for (let i = 0; i < STAFF.lines; i++) {
    const line = new THREE.Mesh(geometry, material);
    line.position.set(STAFF.from, 0.005, STAFF.z + (i - 2) * STAFF.gap);
    group.add(line);
  }
  return { group, material };
}

function concertShell() {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ color: 0x0d1420, emissive: 0x2a3a4e, emissiveIntensity: 0.45, roughness: 0.8 });
  [8.5, 10.5, 12.5, 14.5].forEach((r, i) => {
    const arc = new THREE.Mesh(new THREE.TorusGeometry(r, 0.05 + i * 0.01, 8, 160, Math.PI), material);
    arc.position.set(0, -0.5, -7 - i * 1.6);
    group.add(arc);
  });
  return group;
}

export function createStage(scene, renderer) {
  scene.background = new THREE.Color(0x05080d);
  scene.fog = new THREE.FogExp2(0x05080d, 0.042);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new THREE.RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.32;

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(40, 96),
    new THREE.MeshPhysicalMaterial({ color: 0x0a1018, roughness: 0.32, metalness: 0.35, clearcoat: 0.5, clearcoatRoughness: 0.4 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const podium = new THREE.Mesh(
    new THREE.CylinderGeometry(1.45, 1.6, PODIUM.h, 64),
    new THREE.MeshPhysicalMaterial({ color: 0x121a26, roughness: 0.3, metalness: 0.4, clearcoat: 1 }),
  );
  podium.position.set(PODIUM.x, PODIUM.h / 2, PODIUM.z);
  podium.receiveShadow = true;
  podium.castShadow = true;
  const podiumRim = new THREE.Mesh(
    new THREE.TorusGeometry(1.46, 0.018, 8, 128),
    new THREE.MeshStandardMaterial({ color: 0xe8b04b, emissive: 0xe8b04b, emissiveIntensity: 0.9 }),
  );
  podiumRim.rotation.x = Math.PI / 2;
  podiumRim.position.set(PODIUM.x, PODIUM.h, PODIUM.z);
  scene.add(podium, podiumRim);

  const staff = staffLines();
  scene.add(staff.group, concertShell());

  const hemi = new THREE.HemisphereLight(0x8cb4c9, 0x05080d, 0);
  const rim = new THREE.DirectionalLight(0x8cb4c9, 0);
  rim.position.set(0, 7, -10);
  const fill = new THREE.DirectionalLight(0xbfd3e0, 0);
  fill.position.set(-4, 5, 12);
  scene.add(hemi, rim, fill);

  const key = new THREE.SpotLight(0xffe0b0, 0, 30, 0.34, 0.65, 0);
  key.position.set(0, 13, 1.4);
  key.target.position.set(0, 0, -1.8);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  scene.add(key, key.target);

  const wash = new THREE.SpotLight(0xfff1dc, 0, 40, 0.62, 0.9, 0);
  wash.position.set(0, 11, 9);
  wash.target.position.set(0, 0, 1.2);
  wash.castShadow = true;
  wash.shadow.mapSize.set(1024, 1024);
  wash.shadow.bias = -0.0004;
  scene.add(wash, wash.target);

  const wings = [-1, 1].map((side) => {
    const light = new THREE.SpotLight(side < 0 ? 0xf2c46b : 0x7cc4ef, 0, 30, 0.4, 0.8, 0);
    light.position.set(side * 8, 9, 5);
    light.target.position.set(side * 6.5, 0, 1.4);
    scene.add(light, light.target);
    return light;
  });

  // The visible beam runs along the key light's axis, apex at the lamp.
  const axis = key.position.clone().sub(key.target.position);
  const beam = new THREE.Mesh(new THREE.ConeGeometry(4.6, axis.length(), 64, 1, true), beamMaterial(0xffd9a0));
  beam.position.copy(key.target.position).addScaledVector(axis, 0.5);
  beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis.clone().normalize());
  scene.add(beam);

  const dust = dustField(700, 3.6, 9);
  dust.position.set(0, 0, -1.6);
  scene.add(dust);

  return {
    staff, wings, podiumRim,
    /** Lights and atmosphere as a pure function of the film clock. */
    lightsAt({ keyLevel, washLevel, wingLevel, ambient, time }) {
      key.intensity = 5.5 * keyLevel;
      wash.intensity = 2.2 * washLevel;
      wings.forEach((w) => { w.intensity = 3.5 * wingLevel; });
      scene.environmentIntensity = 0.06 + 0.22 * ambient;
      hemi.intensity = 0.35 * ambient;
      rim.intensity = 1.6 * ambient;
      fill.intensity = 0.55 * ambient;
      beam.material.uniforms.strength.value = keyLevel;
      dust.material.uniforms.strength.value = keyLevel;
      dust.material.uniforms.time.value = time;
      podiumRim.material.emissiveIntensity = 0.9 * keyLevel;
    },
    setPixelRatio(pr) { dust.material.uniforms.pixelRatio.value = pr; },
  };
}

// Props on stage: the method's tool crates, the diffs that travel across
// them and the pedestal where the green verdict is earned.
// 'three' is the landing's trimmed bundle (public/lib/three.min.js): the core
// classes and the addons the film uses, all under one name (tests/landing/three-bundle.test.js).
import * as THREE from 'three';

export const CRATE = { w: 1.15, h: 0.78, d: 0.78 };
export const DIFF_SIZE = 0.42;
const GOLD = new THREE.Color(0xe8b04b);
const RED = new THREE.Color(0xff4d4d);
const GREEN = new THREE.Color(0x34d399);

function labelTexture(lines, { width = 512, height = 256, color = '#e2e8f0', accent = '#e8b04b' } = {}) {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const g = c.getContext('2d');
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = accent;
  g.font = '500 44px "JetBrains Mono", monospace';
  g.fillText(lines[0], width / 2, height * 0.3);
  g.fillStyle = color;
  g.font = '600 74px "Inter", sans-serif';
  g.fillText(lines[1], width / 2, height * 0.64, width * 0.92);
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

/** A tool crate; `badge` (e.g. "new") is printed in green next to its number. */
export function createCrate(index, name, badge = '') {
  const group = new THREE.Group();
  const material = new THREE.MeshPhysicalMaterial({
    color: 0x1a2332, roughness: 0.45, metalness: 0.2, clearcoat: 0.6, clearcoatRoughness: 0.3,
    emissive: new THREE.Color(0x000000),
  });
  const body = new THREE.Mesh(new THREE.RoundedBoxGeometry(CRATE.w, CRATE.h, CRATE.d, 4, 0.07), material);
  body.position.y = CRATE.h / 2;
  body.castShadow = true;
  body.receiveShadow = true;
  const labelMaterial = new THREE.MeshBasicMaterial({
    map: labelTexture([[String(index + 1).padStart(2, '0'), badge].filter(Boolean).join(' · '), name], { accent: badge ? '#34d399' : '#e8b04b' }),
    transparent: true, toneMapped: false,
  });
  const label = new THREE.Mesh(new THREE.PlaneGeometry(CRATE.w * 0.92, CRATE.w * 0.46), labelMaterial);
  label.position.set(0, CRATE.h / 2, CRATE.d / 2 + 0.003);
  const stripMaterial = new THREE.MeshStandardMaterial({ color: 0x2a3a4e, emissive: GOLD.clone(), emissiveIntensity: 0 });
  const strip = new THREE.Mesh(new THREE.BoxGeometry(CRATE.w * 0.86, 0.025, 0.05), stripMaterial);
  strip.position.set(0, CRATE.h - 0.02, CRATE.d / 2 - 0.02);
  group.add(body, label, strip);
  return {
    group,
    /** gold: earned light (0..1); red: refusal flash (0..1). */
    setLight(gold, red = 0) {
      material.emissive.copy(GOLD).multiplyScalar(gold * 0.22).lerp(RED.clone().multiplyScalar(0.55), red);
      stripMaterial.emissive.copy(GOLD).lerp(RED, red);
      stripMaterial.emissiveIntensity = Math.max(gold, red) * 3.2;
      labelMaterial.color.setScalar(0.55 + 0.45 * Math.max(gold, red));
    },
  };
}

export function createDiff(kind) {
  const material = new THREE.MeshPhysicalMaterial({
    color: kind === 'rogue' ? 0x7d8b99 : 0xe9eef4, roughness: 0.25, clearcoat: 1,
    emissive: new THREE.Color(0x000000), transparent: true,
  });
  const mesh = new THREE.Mesh(new THREE.RoundedBoxGeometry(DIFF_SIZE, DIFF_SIZE, DIFF_SIZE, 4, 0.06), material);
  mesh.castShadow = true;
  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(DIFF_SIZE * 0.86, DIFF_SIZE * 0.43),
    new THREE.MeshBasicMaterial({
      map: labelTexture(['', kind === 'rogue' ? '+?? −??' : '+12 −3'], { color: kind === 'rogue' ? '#3b0d0d' : '#1a2a35' }),
      transparent: true,
    }),
  );
  face.position.z = DIFF_SIZE / 2 + 0.002;
  face.position.y = DIFF_SIZE * 0.04;
  mesh.add(face);
  const group = new THREE.Group();
  group.add(mesh);
  return {
    group, mesh,
    setGreen(level) {
      material.emissive.copy(GREEN).multiplyScalar(level * 1.6);
      material.color.set(0xe9eef4).lerp(GREEN, level * 0.6);
    },
    setFade(opacity) { material.opacity = opacity; face.material.opacity = opacity; },
  };
}

export function createVerdict() {
  const group = new THREE.Group();
  const pedestal = new THREE.Mesh(
    new THREE.CylinderGeometry(0.5, 0.62, 0.6, 48),
    new THREE.MeshPhysicalMaterial({ color: 0x141c28, roughness: 0.35, metalness: 0.4, clearcoat: 0.8 }),
  );
  pedestal.position.y = 0.3;
  pedestal.castShadow = true;
  pedestal.receiveShadow = true;
  const glow = new THREE.MeshStandardMaterial({ color: GREEN, emissive: GREEN, emissiveIntensity: 0 });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.035, 16, 96), glow);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.61;
  const check = new THREE.Group();
  const shortStroke = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.28, 6, 12), glow);
  shortStroke.position.set(-0.17, -0.08, 0);
  shortStroke.rotation.z = 0.75;
  const longStroke = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.62, 6, 12), glow);
  longStroke.position.set(0.12, 0.06, 0);
  longStroke.rotation.z = -0.62;
  check.add(shortStroke, longStroke);
  check.position.y = 1.75;
  const light = new THREE.PointLight(GREEN, 0, 9, 1.4);
  light.position.y = 1.4;
  const wave = new THREE.Mesh(
    new THREE.TorusGeometry(0.7, 0.02, 8, 96),
    new THREE.MeshBasicMaterial({ color: GREEN, transparent: true, opacity: 0, toneMapped: false }),
  );
  wave.rotation.x = Math.PI / 2;
  wave.position.y = 0.62;
  group.add(pedestal, ring, check, light, wave);
  return { group, pedestal, ring, check, glow, light, wave };
}

/** A red shock ring for the refused diff. */
export const createShock = () => new THREE.Mesh(
  new THREE.TorusGeometry(0.5, 0.025, 8, 96),
  new THREE.MeshBasicMaterial({ color: RED, transparent: true, opacity: 0, toneMapped: false }),
);

let contactShadowTexture;
/** A soft dark blot under a robot, cheaper than a real shadow. */
export const createContactShadow = () => {
  if (!contactShadowTexture) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(0,0,0,0.85)');
    grad.addColorStop(0.55, 'rgba(0,0,0,0.35)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    contactShadowTexture = new THREE.CanvasTexture(c);
  }
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(2.6, 2.6),
    new THREE.MeshBasicMaterial({ map: contactShadowTexture, transparent: true, depthWrite: false, opacity: 0.7 }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.012;
  mesh.renderOrder = 1;
  return mesh;
};

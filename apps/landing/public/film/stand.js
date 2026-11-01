// atril, new in 5.0: a music stand by the podium. Its sheets are the skills;
// it turns to the next one each time the reviewed diff lands on a crate.
// 'three' is the landing's trimmed bundle (public/lib/three.min.js): the core
// classes and the addons the film uses, all under one name (tests/landing/three-bundle.test.js).
import * as THREE from 'three';

const DESK = { w: 1.25, h: 0.86, tilt: 0.42 };
const SHEET = { w: 0.56, h: 0.76 };
const METAL = { color: 0x1f6f57, roughness: 0.32, metalness: 0.75, clearcoat: 0.4 };

function sheetTexture(title, kicker) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 352;
  const g = c.getContext('2d');
  g.fillStyle = '#cfc8b6';
  g.fillRect(0, 0, c.width, c.height);
  g.textAlign = 'center';
  g.fillStyle = '#1f9e74';
  g.font = '500 17px "JetBrains Mono", monospace';
  g.fillText(kicker, 128, 34);
  g.fillStyle = '#1a2a35';
  g.font = '600 30px "Inter", sans-serif';
  g.fillText(title, 128, 72, 230);
  // Five staves of a score, with a few notes on each.
  g.strokeStyle = 'rgba(26,42,53,0.55)';
  g.fillStyle = 'rgba(26,42,53,0.8)';
  g.lineWidth = 1.2;
  for (let s = 0; s < 5; s++) {
    const top = 110 + s * 46;
    for (let l = 0; l < 5; l++) {
      g.beginPath();
      g.moveTo(22, top + l * 6);
      g.lineTo(234, top + l * 6);
      g.stroke();
    }
    for (let n = 0; n < 7; n++) {
      g.beginPath();
      g.ellipse(44 + n * 28, top + ((n * 7 + s * 3) % 9) * 3, 4.2, 3.2, -0.4, 0, Math.PI * 2);
      g.fill();
    }
  }
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

function plaqueTexture(name, badge) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 96;
  const g = c.getContext('2d');
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#34d399';
  g.font = '600 54px "Inter", sans-serif';
  g.fillText(`${name}  ·  ${badge}`, 256, 50, 490);
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

const sheetMesh = (map) => new THREE.Mesh(
  new THREE.PlaneGeometry(SHEET.w, SHEET.h),
  new THREE.MeshStandardMaterial({ map, roughness: 0.9, emissive: 0xffffff, emissiveMap: map, emissiveIntensity: 0.04 }),
);

/**
 * The stand. `pages` are the sheets in order (the cover first); `turnTo(n, f)`
 * shows sheet n on the right, with sheet n-1 still turning over by f (0..1).
 */
export function createStand(name, badge, pages) {
  const metal = new THREE.MeshPhysicalMaterial(METAL);
  const group = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.62, 12), metal);
    const a = (i / 3) * Math.PI * 2 + 0.5;
    leg.position.set(Math.sin(a) * 0.2, 0.27, Math.cos(a) * 0.2);
    leg.rotation.set(Math.cos(a) * 0.75, 0, -Math.sin(a) * 0.75);
    group.add(leg);
  }
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 1.2, 16), metal);
  pole.position.y = 1.1;
  const desk = new THREE.Group();
  desk.position.y = 1.72;
  desk.rotation.x = -DESK.tilt;
  const board = new THREE.Mesh(new THREE.RoundedBoxGeometry(DESK.w, DESK.h, 0.035, 3, 0.012), metal);
  const lip = new THREE.Mesh(new THREE.RoundedBoxGeometry(DESK.w + 0.04, 0.09, 0.09, 3, 0.02), metal);
  lip.position.set(0, -DESK.h / 2 + 0.02, 0.05);
  const plaque = new THREE.Mesh(
    new THREE.PlaneGeometry(DESK.w * 0.8, DESK.w * 0.15),
    new THREE.MeshBasicMaterial({ map: plaqueTexture(name, badge), transparent: true, toneMapped: false }),
  );
  plaque.position.set(0, -DESK.h / 2 + 0.02, 0.097);
  const sheets = pages.map(([title, kicker]) => sheetTexture(title, kicker));
  const left = sheetMesh(sheets[0]);
  left.position.set(-SHEET.w / 2 - 0.01, 0.04, 0.03);
  const right = sheetMesh(sheets[0]);
  right.position.set(SHEET.w / 2 + 0.01, 0.04, 0.03);
  // The turning sheet hinges on the spine, in the middle of the desk.
  const hinge = new THREE.Group();
  hinge.position.set(0, 0.04, 0.035);
  const turning = sheetMesh(sheets[0]);
  turning.position.x = SHEET.w / 2 + 0.01;
  const back = sheetMesh(sheets[0]);
  back.position.x = SHEET.w / 2 + 0.01;
  back.rotation.y = Math.PI;
  hinge.add(turning, back);
  desk.add(board, lip, plaque, left, right, hinge);
  // No cast shadow: thin poles in the shadow map band the whole stage.
  group.add(pole, desk);
  const show = (mesh, i) => {
    const map = sheets[Math.max(0, Math.min(sheets.length - 1, i))];
    if (mesh.material.map !== map) { mesh.material.map = map; mesh.material.emissiveMap = map; mesh.material.needsUpdate = true; }
  };
  return {
    group,
    turnTo(n, f) {
      show(right, n);
      const shown = f < 1 ? n - 2 : n - 1;
      left.visible = shown >= 0;
      show(left, shown);
      show(turning, n - 1);
      show(back, n - 1);
      hinge.visible = n > 0 && f < 1;
      hinge.rotation.y = -Math.PI * f;
      hinge.position.z = 0.035 + 0.06 * Math.sin(Math.PI * f);
    },
  };
}

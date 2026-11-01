// atril, new in 5.0: a music stand by the podium, with the family's glowing eyes
// and two thin arms. Its sheets are the skills; it turns to the next one each
// time the reviewed diff lands on a crate.
// 'three' is the landing's trimmed bundle (public/lib/three.min.js): the core
// classes and the addons the film uses, all under one name (tests/landing/three-bundle.test.js).
import * as THREE from 'three';

const DESK = { w: 1.25, h: 0.86, tilt: 0.42 };
const SHEET = { w: 0.56, h: 0.76 };
const METAL = { color: 0x1f6f57, roughness: 0.32, metalness: 0.75, clearcoat: 0.4 };
const GREEN = 0x34d399;
const ARM = 0.44;
// The right arm reaches over the corner of the turning page; both rise on the verdict.
const REST = 0.35, REACH = Math.PI + 0.4, CHEER = Math.PI - 0.6;

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
  c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#0b1118';
  g.strokeStyle = '#34d399';
  g.lineWidth = 5;
  g.beginPath();
  g.roundRect(4, 4, 504, 120, 22);
  g.fill();
  g.stroke();
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#34d399';
  g.font = '600 64px "Inter", sans-serif';
  g.fillText(`${name}  ·  ${badge}`, 256, 66, 470);
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

const sheetMesh = (map) => new THREE.Mesh(
  new THREE.PlaneGeometry(SHEET.w, SHEET.h),
  new THREE.MeshStandardMaterial({ map, roughness: 0.9, emissive: 0xffffff, emissiveMap: map, emissiveIntensity: 0.04 }),
);

// A thin metal arm hanging from its shoulder, with a white hand like the robots'.
function createArm(metal, white) {
  const shoulder = new THREE.Group();
  const bone = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, ARM, 10), metal);
  bone.position.y = -ARM / 2;
  const hand = new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 12), white);
  hand.position.y = -ARM;
  shoulder.add(bone, hand);
  return shoulder;
}

// A face like the robots': a dark visor on top of the desk with two glowing eyes.
function createFace() {
  const face = new THREE.Group();
  face.position.set(0, DESK.h / 2 + 0.13, 0);
  const visor = new THREE.Mesh(
    new THREE.RoundedBoxGeometry(0.66, 0.3, 0.08, 3, 0.07),
    new THREE.MeshStandardMaterial({ color: 0x0b1118, roughness: 0.25, metalness: 0.4 }),
  );
  const glow = new THREE.MeshStandardMaterial({ color: GREEN, emissive: GREEN, emissiveIntensity: 2.4 });
  const eyes = new THREE.Group();
  eyes.position.z = 0.045;
  const eyeGeo = new THREE.CapsuleGeometry(0.036, 0.1, 4, 10);
  for (const x of [-0.13, 0.13]) {
    const eye = new THREE.Mesh(eyeGeo, glow);
    eye.position.x = x;
    eyes.add(eye);
  }
  face.add(visor, eyes);
  return { face, eyes };
}

/**
 * The stand. `pages` are the sheets in order (the cover first); `turnTo(n, f)`
 * shows sheet n on the right, with sheet n-1 still turning over by f (0..1);
 * `live(blink, look, cheer)` closes the eyes by blink (0..1), turns them toward
 * look (-1 left .. 1 right) and raises both arms by cheer (0..1).
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
  // The name plate glows just over the bloom threshold, like the crates' labels.
  const plaqueGlow = new THREE.MeshBasicMaterial({ map: plaqueTexture(name, badge), transparent: true, toneMapped: false });
  plaqueGlow.color.setScalar(1.3);
  const plaque = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.275), plaqueGlow);
  plaque.position.set(0, -DESK.h / 2 - 0.1, 0.1);
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
  const { face, eyes } = createFace();
  const white = new THREE.MeshPhysicalMaterial({ color: 0xe6eaf0, roughness: 0.35, clearcoat: 0.6 });
  const arms = [-1, 1].map((side) => {
    const arm = createArm(metal, white);
    arm.position.set(side * (DESK.w / 2 + 0.02), DESK.h * 0.15, 0.08);
    return arm;
  });
  desk.add(board, lip, plaque, left, right, hinge, face, ...arms);
  // No cast shadow: thin poles in the shadow map band the whole stage.
  group.add(pole, desk);
  const show = (mesh, i) => {
    const map = sheets[Math.max(0, Math.min(sheets.length - 1, i))];
    if (mesh.material.map !== map) { mesh.material.map = map; mesh.material.emissiveMap = map; mesh.material.needsUpdate = true; }
  };
  let reach = 0;
  return {
    group,
    live(blink, look, cheer) {
      eyes.scale.y = 1 - 0.9 * blink;
      eyes.position.x = 0.07 * look;
      const [leftArm, rightArm] = arms;
      leftArm.rotation.z = -(REST + (CHEER - REST) * cheer);
      const raised = REST + (REACH - REST) * reach;
      rightArm.rotation.z = raised + (CHEER - raised) * cheer;
    },
    turnTo(n, f) {
      reach = n > 0 && f < 1 ? Math.sin(Math.PI * f) : 0;
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

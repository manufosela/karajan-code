// KJC-TSK-1832: the one big drone of the task wall: a wide body, four arms with spinning rotors, a
// light underneath and, while it carries a card, the card's note hanging under it. wall-drone.js
// says where it is and what it holds.
import * as THREE from 'three';
import { NOTE, noteLines } from './wall-drone.js';

/** The card's note, its id painted on it, as the wall shows it (bench-notes.js puts it on the benches too). */
export function cardNote(id) {
  const canvas = Object.assign(document.createElement('canvas'), { width: 256, height: 160 });
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#f0d58c';
  ctx.fillRect(0, 0, 256, 160);
  ctx.fillStyle = '#10161f';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // KJC-TSK-1493: the prefix small on top, the number big below, each shrunk to fit.
  const [prefix, number] = noteLines(id);
  const fit = (text, size, y) => {
    ctx.font = `700 ${size}px system-ui, sans-serif`;
    const scale = Math.min(1, 232 / Math.max(1, ctx.measureText(text).width));
    ctx.font = `700 ${Math.floor(size * scale)}px system-ui, sans-serif`;
    ctx.fillText(text, 128, y);
  };
  if (prefix) fit(prefix, 36, 42);
  fit(number, 72, prefix ? 106 : 80);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(new THREE.PlaneGeometry(NOTE.height * 1.6, NOTE.height), new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide }));
}

/** Mounts the drone on `parent`; `show(pose, now)` flies it, holding the note of `pose.carrying`. */
export function createWallDrone(parent) {
  const drone = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: 0x1b1f27, roughness: 0.5 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.3, 1.4), new THREE.MeshStandardMaterial({ color: 0xeef1f6, roughness: 0.4 }));
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 8), new THREE.MeshBasicMaterial({ color: 0x9fe3ff }));
  lamp.position.y = -0.22;
  drone.add(body, lamp);
  const rotors = [[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([sx, sz]) => {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.08, 0.08), dark);
    arm.position.set(sx * 0.65, 0.05, sz * 0.65);
    arm.rotation.y = -Math.atan2(sz, sx);
    const rotor = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.02, 0.1), dark);
    rotor.position.set(sx, 0.2, sz);
    drone.add(arm, rotor);
    return rotor;
  });
  let note = null;
  let noted = null;
  const hold = (id) => {
    if (noted === id) return;
    if (note) {
      drone.remove(note);
      note.material.map.dispose();
      note.material.dispose();
      note.geometry.dispose();
    }
    note = id ? cardNote(id) : null;
    if (note) {
      note.position.y = -NOTE.below;
      drone.add(note);
    }
    noted = id;
  };
  parent.add(drone);
  return {
    group: drone,
    show(pose, now) {
      drone.position.set(pose.x, pose.y, pose.z);
      for (const rotor of rotors) rotor.rotation.y = now / 30;
      hold(pose.carrying);
    },
  };
}

// TDD as a tuner: the needle swings from the red (the test fails first) to the green.
import * as THREE from 'three';
import { metalIn } from '../parts.js';

function dialTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 160;
  const g = c.getContext('2d');
  g.fillStyle = '#e9e4d6';
  g.fillRect(0, 0, 256, 160);
  const arc = g.createLinearGradient(30, 0, 226, 0);
  arc.addColorStop(0, '#ef4444');
  arc.addColorStop(0.5, '#f5c518');
  arc.addColorStop(1, '#22c55e');
  g.strokeStyle = arc;
  g.lineWidth = 18;
  g.beginPath();
  g.arc(128, 150, 110, Math.PI * 1.15, Math.PI * 1.85);
  g.stroke();
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function tddBody() {
  const group = new THREE.Group();
  const casing = new THREE.Mesh(new THREE.RoundedBoxGeometry(0.62, 0.48, 0.16, 3, 0.05), metalIn(0x2a3442));
  casing.position.y = 0.3;
  const dial = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.31), new THREE.MeshStandardMaterial({ map: dialTexture(), roughness: 0.6 }));
  dial.position.set(0, 0.3, 0.081);
  const needle = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.24, 0.006), new THREE.MeshStandardMaterial({ color: 0x1a2a35 }));
  needle.geometry.translate(0, 0.12, 0);
  needle.position.set(0, 0.17, 0.088);
  needle.rotation.z = -0.55;
  group.add(casing, dial, needle);
  return { group, face: { y: 0.66, z: 0.02, width: 0.44 }, shoulders: { x: 0.33, y: 0.42, z: 0 } };
}

// KJC-TSK-1620: the pointer over a workshop shows a tooltip with its whole name and its HU.
// workshop-info.js says which workshop and what.
import * as THREE from 'three';
import { groundAt } from './flight.js';
import { huOfLane, laneAtPoint, tipOf } from './workshop-info.js';

const TIP_WIDTH = 340;

/** Watches `canvas` over `scene`'s hall: `tip` is the tooltip element, `cardsOf()` the cards the stage knows now. */
export function watchWorkshops({ canvas, scene, tip, cardsOf }) {
  // The board's three.js has no Raycaster: the ray goes from the camera through the pointer.
  const laneUnder = ({ clientX, clientY }) => {
    const { camera, hall } = scene;
    const through = new THREE.Vector3((clientX / innerWidth) * 2 - 1, -(clientY / innerHeight) * 2 + 1, 0.5).unproject(camera);
    const dir = through.sub(camera.position).normalize();
    return laneAtPoint(groundAt(camera.position, dir), hall.names(), hall.xOf, hall.zOf);
  };
  const hide = () => { tip.hidden = true; };
  canvas.addEventListener('pointermove', (event) => {
    if (event.pointerType !== 'mouse') return;
    const lane = laneUnder(event);
    if (!lane) { hide(); return; }
    const hu = huOfLane(lane, cardsOf());
    tip.replaceChildren(...tipOf(lane, hu, scene.hall.lineOf(lane)).map((line) => Object.assign(document.createElement('div'), { textContent: line })));
    tip.style.left = `${Math.min(event.clientX + 14, innerWidth - TIP_WIDTH - 8)}px`;
    tip.style.top = `${event.clientY + 16}px`;
    tip.hidden = false;
  });
  canvas.addEventListener('pointerleave', hide);
}

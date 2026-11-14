// KJC-TSK-1620: the pointer over a workshop shows a tooltip with its whole name and its HU.
// workshop-info.js says which workshop and what.
import * as THREE from 'three';
import { groundAt } from './flight.js';
import { huOfLane, laneAtPoint, tipOf } from './workshop-info.js';
import { rectOf, thingAt, thingBoxes, thingTip } from './hall-things.js';
import { onScreen } from './screen.js';

/** KJC-TSK-1625: a thing's box as it falls on the screen. */
function onScreenRect({ min, max }, camera) {
  const corners = [min.x, max.x].flatMap((x) => [min.y, max.y].flatMap((y) => [min.z, max.z].map((z) => new THREE.Vector3(x, y, z))));
  return rectOf(corners.map((corner) => onScreen(corner.project(camera), innerWidth, innerHeight)));
}

const TIP_WIDTH = 340;

/**
 * Watches `canvas` over `scene`'s hall: `tip` is the tooltip element, `cardsOf()` the cards the
 * stage knows now. KJC-TSK-1621: `openHu(hu)` opens one; answers `tapAt(event)`, for a tap or a
 * click that did not drag. KJC-TSK-1625: `thingsOf()` what the hall's things hold now;
 * KJC-TSK-1627: `openWall(cards)` opens the task wall large.
 */
export function watchWorkshops({ canvas, scene, tip, cardsOf, openHu, thingsOf, openWall }) {
  // The board's three.js has no Raycaster: the ray goes from the camera through the pointer.
  const laneUnder = ({ clientX, clientY }) => {
    const { camera, hall } = scene;
    const through = new THREE.Vector3((clientX / innerWidth) * 2 - 1, -(clientY / innerHeight) * 2 + 1, 0.5).unproject(camera);
    const dir = through.sub(camera.position).normalize();
    return laneAtPoint(groundAt(camera.position, dir), hall.names(), hall.xOf, hall.zOf);
  };
  // KJC-TSK-1625: the release table, the finished stack and the task wall, before the workshops.
  const thingUnder = ({ clientX, clientY }) => {
    const rects = thingBoxes(thingsOf().stacked.length).map((b) => ({ id: b.id, rect: onScreenRect(b, scene.camera) }));
    return thingAt({ left: clientX, top: clientY }, rects);
  };
  /** The tooltip's lines under the pointer, and whether a click there opens something; null when none. */
  const tipUnder = (event) => {
    const thing = thingUnder(event);
    if (thing) return { lines: thingTip(thing, thingsOf()), opens: thing === 'wall' };
    const lane = laneUnder(event);
    if (!lane) return null;
    const hu = huOfLane(lane, cardsOf());
    return { lines: tipOf(lane, hu, scene.hall.lineOf(lane), true), opens: Boolean(hu) };
  };
  const hide = () => { tip.hidden = true; canvas.style.cursor = ''; };
  canvas.addEventListener('pointermove', (event) => {
    if (event.pointerType !== 'mouse') return;
    const under = tipUnder(event);
    if (!under) { hide(); return; }
    tip.replaceChildren(...under.lines.map((line) => Object.assign(document.createElement('div'), { textContent: line })));
    tip.style.left = `${Math.min(event.clientX + 14, innerWidth - TIP_WIDTH - 8)}px`;
    tip.style.top = `${event.clientY + 16}px`;
    tip.hidden = false;
    canvas.style.cursor = under.opens ? 'pointer' : '';
  });
  canvas.addEventListener('pointerleave', hide);
  return (event) => {
    // KJC-TSK-1627: the task wall opens its tasks large; the other things only explain themselves.
    const thing = thingUnder(event);
    if (thing === 'wall') { hide(); openWall(thingsOf().cards); }
    if (thing) return;
    const lane = laneUnder(event);
    const hu = lane && huOfLane(lane, cardsOf());
    if (hu) { hide(); openHu(hu); }
  };
}

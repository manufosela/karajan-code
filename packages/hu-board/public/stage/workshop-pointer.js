// KJC-TSK-1620: the pointer over a workshop shows a tooltip with its whole name and its HU.
// workshop-info.js says which workshop and what.
import * as THREE from 'three';
import { groundAt } from './flight.js';
import { huOfLane, laneAtPoint, tipOf } from './workshop-info.js';
import { rectOf, thingAt, thingBoxes, thingTip } from './hall-things.js';
import { mailboxSpot } from './layout.js';
import { onScreen } from './screen.js';
import { KARAJAN_FIGURES, figureBoxes, figureTip } from './karajan-tips.js';
import { langOf } from './legend-es.js';

/** KJC-TSK-1625: a thing's box as it falls on the screen. */
function onScreenRect({ min, max }, camera) {
  const corners = [min.x, max.x].flatMap((x) => [min.y, max.y].flatMap((y) => [min.z, max.z].map((z) => new THREE.Vector3(x, y, z))));
  return rectOf(corners.map((corner) => onScreen(corner.project(camera), innerWidth, innerHeight)));
}

/** KJC-TSK-1836: the legend's language (legend-panel.js keeps the choice in this item). */
const legendLang = () => {
  let chosen = null;
  try { chosen = localStorage.getItem('kj-stage-legend-lang'); } catch { /* the browser's language */ }
  return langOf(chosen, navigator.language);
};

/** KJC-TSK-1836: where each Karajan figure stands now, in world metres. */
function figuresOf({ crew, pieces }, reviewCopies = []) {
  const at = new THREE.Vector3();
  const spot = (id, root) => {
    root.getWorldPosition(at);
    return { id, x: at.x, y: at.y, z: at.z, visible: root.visible };
  };
  const own = KARAJAN_FIGURES.map((id) => {
    const root = crew[id]?.root ?? pieces[id]?.group;
    return root ? spot(id, root) : { id, visible: false };
  });
  // The AI review's copies at the workshops answer as the review figure too.
  return [...own, ...reviewCopies.map((copy) => spot('review', copy))];
}

const TIP_WIDTH = 340;
/** The things a click opens large. */
const OPENS = new Set(['wall', 'mailbox']);

/**
 * Watches `canvas` over `scene`'s hall: `tip` is the tooltip element, `cardsOf()` the cards the
 * stage knows now. KJC-TSK-1621: `openHu(hu)` opens one; answers `tapAt(event)`, for a tap or a
 * click that did not drag. KJC-TSK-1625: `thingsOf()` what the hall's things hold now;
 * KJC-TSK-1627: `openWall(cards)` opens the task wall large; KJC-TSK-1638: `openMail(letters)` the mailbox's list.
 */
export function watchWorkshops({ canvas, scene, tip, cardsOf, openHu, thingsOf, figuresOf: figuresOfCopies = () => [], openWall, openMail }) {
  // The board's three.js has no Raycaster: the ray goes from the camera through the pointer.
  const laneUnder = ({ clientX, clientY }) => {
    const { camera, hall } = scene;
    const through = new THREE.Vector3((clientX / innerWidth) * 2 - 1, -(clientY / innerHeight) * 2 + 1, 0.5).unproject(camera);
    const dir = through.sub(camera.position).normalize();
    return laneAtPoint(groundAt(camera.position, dir), hall.names(), hall.xOf, hall.zOf);
  };
  // KJC-TSK-1625: the release table, the finished stack and the task wall, before the workshops.
  // KJC-TSK-1638: and the mailbox, where the hall puts it.
  const thingUnder = ({ clientX, clientY }) => {
    const rects = thingBoxes(thingsOf().stacked.length, mailboxSpot(scene.hall.count()), scene.hall.count()).map((b) => ({ id: b.id, rect: onScreenRect(b, scene.camera) }));
    return thingAt({ left: clientX, top: clientY }, rects);
  };
  // KJC-TSK-1836: a Karajan figure answers with its legend card; it is not clickable.
  const figureUnder = ({ clientX, clientY }) => {
    const rects = figureBoxes(figuresOf(scene, figuresOfCopies())).map((b) => ({ id: b.id, rect: onScreenRect(b, scene.camera) }));
    return thingAt({ left: clientX, top: clientY }, rects);
  };
  /** The tooltip's lines under the pointer, and whether a click there opens something; null when none. */
  const tipUnder = (event) => {
    const figure = figureUnder(event);
    if (figure) return { lines: figureTip(figure, legendLang()), opens: false };
    const thing = thingUnder(event);
    if (thing) return { lines: thingTip(thing, thingsOf()), opens: OPENS.has(thing) };
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
    if (thing === 'mailbox') { hide(); openMail(thingsOf().letters ?? []); }
    if (thing) return;
    const lane = laneUnder(event);
    const hu = lane && huOfLane(lane, cardsOf());
    if (hu) { hide(); openHu(hu); }
  };
}

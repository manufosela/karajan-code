// KJC-TSK-1452 (ADR 0049): the map of every factory of the user. One factory per
// known project on its lot, the busiest first; one stream for them all, each event
// taken to the factory of its project. A click on a factory flies there (KJC-TSK-1455).
import * as THREE from 'three';
import { buildFactory, createFactory, createFloor, framing } from './factory.js';
import { FLOOR_Z, packLots } from './map-layout.js';
import { createLive } from './live.js';
import { acrossLanes } from './rest.js';
import { tagAt } from './screen.js';
import { withToken } from './token.js';
import { listenPan, listenZoom, panTarget } from './zoom.js';
import { FLIGHT_MS, flightAt, groundAt, lotAt } from './flight.js';
import { mapName } from './cards.js';
import { MARK_MS } from './marks.js';
import { glowAt, mailboxOf, mailTotal, withMail } from './mail.js';
import { createMailbox } from './mailbox.js';

const NAME_OVER = new THREE.Vector3(0, 2.5, -8.5); // the factory's name stands at the back of its floor
const MAP_ZOOM = { min: 0.06, max: 1.3 }; // the closest shows one workshop whole
const CLICK_PX = 6; // a press that moves less than this is a click, not a drag
const HALL_LOOK_Z = -0.6; // where the camera looks in a hall, as on one factory (factory.js)
const LABELS_BELOW = 0.45; // robots' and marks' labels only show this close; the names always
const MAILBOX_INSET = 1.5; // metres from the floor's front right corner

/** The scene of the map with every factory on its lot; returns the factories and the render. */
function buildMap(canvas, factories, { instant, onView }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const { scene, camera, target } = createFactory(renderer, { floor: false, far: 3000 });
  // KJC-TSK-1467: each lot as wide as its own hall, packed in rows; its floor just under the hall.
  const bounds = packLots(factories.map(({ lanes }) => lanes.length));
  const { lots } = bounds;
  const placed = factories.map(({ project, lanes }, i) => {
    const lot = new THREE.Group();
    lot.position.set(lots[i].x, 0, lots[i].z);
    const floor = createFloor(lots[i].width, FLOOR_Z.front - FLOOR_Z.back);
    floor.position.z = (FLOOR_Z.back + FLOOR_Z.front) / 2;
    lot.add(floor);
    // KJC-TSK-1473: the human's mailbox at the front right corner of the floor.
    const mailbox = createMailbox();
    mailbox.group.position.set(lots[i].width / 2 - MAILBOX_INSET, 0, FLOOR_Z.front - MAILBOX_INSET);
    lot.add(mailbox.group);
    scene.add(lot);
    return { project, lanes, lot, mailbox, ...buildFactory(lot, lanes.map((l) => l.lane)) };
  });
  const render = () => renderer.render(scene, camera);
  let zoom = 1;
  const refit = () => {
    renderer.setSize(innerWidth, innerHeight, false);
    camera.aspect = innerWidth / innerHeight;
    // Wide enough for every column and, seen at three quarters, every row.
    camera.position.copy(target).add(framing(Math.max(bounds.width, bounds.depth * camera.aspect), camera.aspect).multiplyScalar(zoom));
    camera.lookAt(target);
    camera.updateProjectionMatrix();
    render();
  };
  addEventListener('resize', refit);
  let flight = null; // KJC-TSK-1455: the flight to a factory, if one is under way
  // From the whole map down to one workshop; dragging walks over the map at any zoom.
  const wheel = listenZoom(canvas, (k) => { zoom = k; flight = null; refit(); }, MAP_ZOOM);
  listenPan(canvas, (dx, dy) => {
    const metresPerPx = (2 * camera.position.distanceTo(target) * Math.tan((camera.fov * Math.PI) / 360)) / innerHeight;
    const next = panTarget(target, dx, dy, metresPerPx, bounds);
    target.set(next.x, 0, next.z);
    flight = null;
    refit();
  });
  // KJC-TSK-1455: a click (a press that did not drag) on a factory's floor flies there.
  const factoryZoom = (i) => framing(lots[i].width, camera.aspect).length() / framing(Math.max(bounds.width, bounds.depth * camera.aspect), camera.aspect).length();
  let pressed = null;
  canvas.addEventListener('pointerdown', (e) => { pressed = { x: e.clientX, y: e.clientY }; });
  canvas.addEventListener('pointerup', (e) => {
    const click = pressed && Math.hypot(e.clientX - pressed.x, e.clientY - pressed.y) < CLICK_PX;
    pressed = null;
    if (!click) return;
    const ray = new THREE.Vector3((e.clientX / innerWidth) * 2 - 1, 1 - (e.clientY / innerHeight) * 2, 0.5).unproject(camera).sub(camera.position);
    const i = lotAt(groundAt(camera.position, ray), lots);
    if (i < 0) return; // the gap between factories
    const to = { x: lots[i].x, z: lots[i].z + HALL_LOOK_Z, zoom: Math.max(MAP_ZOOM.min, factoryZoom(i)) };
    // Someone who asked for no motion lands at once.
    flight = { from: { x: target.x, z: target.z, zoom }, to, start: performance.now() - (instant ? FLIGHT_MS : 0) };
    onView();
  });
  /** Moves the camera along the flight at `now`; the wheel picks up from where it landed. */
  const step = (now) => {
    const at = flightAt(flight, now);
    if (!at) return;
    target.set(at.x, 0, at.z);
    zoom = at.zoom;
    wheel.set(zoom);
    if (at.done) flight = null;
    refit();
  };
  refit();
  return { placed, camera, render, refit, step, zoomNow: () => zoom };
}

/**
 * Mounts the map on `canvas` from the board's `/api/stage/map` answer and plays the
 * stream: `tell` gets one status line per factory, `counts` holds the labels.
 */
export function startMap({ canvas, factories, token, tell, counts }) {
  // ADR 0048, as on one factory: nothing moves without a real event, and someone who
  // asked for no motion gets one frame per event and another once its mark has gone.
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const { placed, camera, render, refit, step, zoomNow } = buildMap(canvas, factories, {
    instant: still,
    onView: () => { if (still) draw(performance.now()); },
  });
  const lines = new Map(factories.map(({ project }) => [project, 'at rest']));
  const tellAll = () => tell([...lines].map(([project, line]) => `${project}: ${line}`));
  const lives = new Map(placed.map((factory) => {
    const own = document.createElement('div'); // each factory relabels only its own corner
    counts.append(own);
    const tellOne = (said) => { lines.set(factory.project, said[0] ?? 'at rest'); tellAll(); };
    const live = createLive({ ...factory, scene: factory.lot, camera, refit, origin: factory.lot.position },
      { state: acrossLanes(factory.lanes), tell: tellOne, counts: own });
    tellOne(live.settle().lines);
    return [factory.project, { live, own, box: mailboxOf(factory.lanes), mailbox: factory.mailbox }];
  }));
  const names = document.createElement('div');
  counts.append(names);
  function draw(ms) {
    step(ms);
    // KJC-TSK-1455: from far away only the factories' names; their labels as the camera comes closer.
    const near = zoomNow() < LABELS_BELOW;
    for (const { live, own, box, mailbox } of lives.values()) {
      live.frame(ms);
      own.hidden = !near;
      mailbox.light(glowAt(mailTotal(box), ms, still));
    }
    // KJC-TSK-1460 (ADR 0050): each name says how many cards its factory has in progress,
    // and KJC-TSK-1473 how many handoffs wait for the human.
    const nameOf = (project) => {
      const { live, box } = lives.get(project);
      const mail = mailTotal(box);
      return mail ? `${mapName(project, live.cards())} · ✉ ${mail}` : mapName(project, live.cards());
    };
    const named = ({ project, lot }) => tagAt(nameOf(project), NAME_OVER, camera, { className: 'stage-worker', origin: lot.position });
    names.replaceChildren(...placed.map(named));
    render();
  }
  const events = new EventSource(withToken('/api/events?map=1', token));
  events.onmessage = ({ data }) => {
    const event = JSON.parse(data);
    const factory = lives.get(event.project); // a project not on the map has no factory
    if (factory) factory.box = withMail(factory.box, event);
    factory?.live.push(event, performance.now());
    if (still) { draw(performance.now()); setTimeout(() => draw(performance.now()), MARK_MS + 50); }
  };
  const loop = (ms) => { draw(ms); requestAnimationFrame(loop); };
  if (still) draw(performance.now());
  else requestAnimationFrame(loop);
  tellAll();
}

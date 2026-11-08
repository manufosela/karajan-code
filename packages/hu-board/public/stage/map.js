// KJC-TSK-1452 (ADR 0049): the map of every factory of the user. One factory per
// known project on its lot, the busiest first; one stream for them all, each event
// taken to the factory of its project. The flight to a factory comes later (8d-2).
import * as THREE from 'three';
import { buildFactory, createFactory, createFloor, framing } from './factory.js';
import { AISLE, FLOOR_Z, lotOrigin, lotSize, mapSize } from './map-layout.js';
import { createLive } from './live.js';
import { acrossLanes } from './rest.js';
import { tagAt } from './screen.js';
import { withToken } from './token.js';
import { listenPan, listenZoom, panTarget } from './zoom.js';
import { MARK_MS } from './marks.js';

const NAME_OVER = new THREE.Vector3(0, 2.5, -8.5); // the factory's name stands at the back of its floor
const MAP_ZOOM = { min: 0.06, max: 1.3 }; // the closest shows one workshop whole

/** The scene of the map with every factory on its lot; returns the factories and the render. */
function buildMap(canvas, factories) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const { scene, camera, target } = createFactory(renderer, { floor: false, far: 3000 });
  // KJC-TSK-1454: every lot as big as the widest hall, its floor just under the hall.
  const size = lotSize(factories.map(({ lanes }) => lanes.length));
  const placed = factories.map(({ project, lanes }, i) => {
    const lot = new THREE.Group();
    const { x, z } = lotOrigin(i, factories.length, size);
    lot.position.set(x, 0, z);
    const floor = createFloor(size.width - AISLE, size.depth - AISLE);
    floor.position.z = (FLOOR_Z.back + FLOOR_Z.front) / 2;
    lot.add(floor);
    scene.add(lot);
    return { project, lanes, lot, ...buildFactory(lot, lanes.map((l) => l.lane)) };
  });
  const render = () => renderer.render(scene, camera);
  const bounds = mapSize(factories.length, size);
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
  // From the whole map down to one workshop; dragging walks over the map at any zoom.
  listenZoom(canvas, (k) => { zoom = k; refit(); }, MAP_ZOOM);
  listenPan(canvas, (dx, dy) => {
    const metresPerPx = (2 * camera.position.distanceTo(target) * Math.tan((camera.fov * Math.PI) / 360)) / innerHeight;
    const next = panTarget(target, dx, dy, metresPerPx, bounds);
    target.set(next.x, 0, next.z);
    refit();
  });
  refit();
  return { placed, camera, render, refit };
}

/**
 * Mounts the map on `canvas` from the board's `/api/stage/map` answer and plays the
 * stream: `tell` gets one status line per factory, `counts` holds the labels.
 */
export function startMap({ canvas, factories, token, tell, counts }) {
  const { placed, camera, render, refit } = buildMap(canvas, factories);
  const lines = new Map(factories.map(({ project }) => [project, 'at rest']));
  const tellAll = () => tell([...lines].map(([project, line]) => `${project}: ${line}`));
  const lives = new Map(placed.map((factory) => {
    const own = document.createElement('div'); // each factory relabels only its own corner
    counts.append(own);
    const tellOne = (said) => { lines.set(factory.project, said[0] ?? 'at rest'); tellAll(); };
    const live = createLive({ ...factory, scene: factory.lot, camera, refit, origin: factory.lot.position },
      { state: acrossLanes(factory.lanes), tell: tellOne, counts: own });
    tellOne(live.settle().lines);
    return [factory.project, live];
  }));
  const names = document.createElement('div');
  counts.append(names);
  const draw = (ms) => {
    for (const live of lives.values()) live.frame(ms);
    names.replaceChildren(...placed.map(({ project, lot }) => tagAt(project, NAME_OVER, camera, { className: 'stage-worker', origin: lot.position })));
    render();
  };
  // ADR 0048, as on one factory: nothing moves without a real event, and someone who
  // asked for no motion gets one frame per event and another once its mark has gone.
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const events = new EventSource(withToken('/api/events?map=1', token));
  events.onmessage = ({ data }) => {
    const event = JSON.parse(data);
    lives.get(event.project)?.push(event, performance.now()); // a project not on the map has no factory
    if (still) { draw(performance.now()); setTimeout(() => draw(performance.now()), MARK_MS + 50); }
  };
  const loop = (ms) => { draw(ms); requestAnimationFrame(loop); };
  if (still) draw(performance.now());
  else requestAnimationFrame(loop);
  tellAll();
}

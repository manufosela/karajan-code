// KJC-TSK-1398 (ADR 0046, 0047): kj stage, the factory at rest. The film's cast
// works the hall and each station shows the last real state of the project;
// nothing is simulated. The live cues come from the director (KJC-TSK-1399).
import * as THREE from 'three';
import { buildFactory, createFactory, framing } from './factory.js';
import { hallDepth, hallWidth } from './layout.js';
import { createLive } from './live.js';
import { acrossLanes } from './rest.js';
import { boardToken, withToken } from './token.js';
import { listenZoom } from './zoom.js';
import { MARK_MS } from './marks.js';

const canvas = document.getElementById('stage');
const status = document.getElementById('stage-status');
const project = new URLSearchParams(location.search).get('project');
// KJC-BUG-0492: off loopback the board asks for its token, as on the RAG and Wiki pages.
const token = boardToken(location.search, () => localStorage);
// KJC-TSK-1468: the loading indicator goes with the first word, once that frame is drawn.
const loading = document.getElementById('stage-loading');
const loaded = () => requestAnimationFrame(() => { loading.hidden = true; });
const tell = (lines) => { status.replaceChildren(...lines.map((text) => Object.assign(document.createElement('li'), { textContent: text }))); loaded(); };

/** Builds the hall with one workshop per lane; returns its pieces, crew, hall and render. */
function buildScene(lanes) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const { scene, camera, target } = createFactory(renderer);
  const HALL_CENTRE_Z = target.z;
  const { crew, pieces, stand, hall, wall } = buildFactory(scene, lanes);
  const render = () => renderer.render(scene, camera);
  // The camera pulls back as the hall grows or the screen narrows, so every workshop
  // fits; the wheel or a pinch brings it closer or further (KJC-TSK-1433).
  let zoom = 1;
  const refit = () => {
    renderer.setSize(innerWidth, innerHeight, false);
    camera.aspect = innerWidth / innerHeight;
    // KJC-TSK-1488: the camera looks at the middle of the rows and fits their depth too.
    const n = hall.count();
    // The status lines sit over the bottom of the view, so the front row needs some room below it.
    const deep = hallDepth(n) > 0 ? hallDepth(n) + 10 : 0;
    target.z = HALL_CENTRE_Z + deep / 2;
    camera.position.copy(target).add(framing(Math.max(hallWidth(n), deep * camera.aspect), camera.aspect).multiplyScalar(zoom));
    camera.lookAt(target);
    camera.updateProjectionMatrix();
    render();
  };
  addEventListener('resize', refit);
  listenZoom(canvas, (k) => { zoom = k; refit(); });
  refit();
  return { scene, pieces, crew, stand, hall, wall, camera, render, refit };
}

/** The last real state of the project, or the reason the board could not give it. */
async function fetchState() {
  try {
    const res = await fetch(`/api/stage/state?project=${encodeURIComponent(project)}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    const body = await res.json();
    // ADR 0048: the state of every lane, newest first; a board without lanes answers the main checkout's.
    return res.ok ? { state: body.lanes ? acrossLanes(body.lanes) : body } : { error: body.error };
  } catch (err) {
    return { error: `the board did not answer (${err.message})` };
  }
}

async function start() {
  document.getElementById('stage-project').textContent = `kj stage · ${project}`;
  const { state, error } = await fetchState();
  if (error) { tell([`The board cannot read this project: ${error}`]); return; }
  const scene = buildScene((state.lanes ?? [{ lane: 'main' }]).map((l) => l.lane));
  // The status list never goes blank: with nothing to tell, it says so (also after a live event).
  const tellState = (lines) => tell(lines.length ? lines : ['Nothing has happened in this project yet: the stage is at rest.']);
  const live = createLive(scene, { state, tell: tellState, counts: document.getElementById('stage-counts') });
  tellState(live.settle().lines);
  scene.render();
  // ADR 0048: nothing moves without a real event. The frames only play what events
  // set going; someone who asked for no motion gets the lights and the list only.
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const events = new EventSource(withToken(`/api/events?project=${encodeURIComponent(project)}`, token));
  events.onmessage = ({ data }) => {
    live.push(JSON.parse(data), performance.now());
    // Without motion, each event still draws one frame: its lights, marks and gates, and
    // another once its mark has expired, so nothing stays lit (KJC-TSK-1437).
    if (still) {
      const draw = () => { live.frame(performance.now()); scene.render(); };
      draw();
      setTimeout(draw, MARK_MS + 50);
    }
  };
  const frame = (ms) => {
    live.frame(ms);
    scene.render();
    requestAnimationFrame(frame);
  };
  if (!still) requestAnimationFrame(frame);
}

/** KJC-TSK-1452 (ADR 0049): the map of every factory, from the board's list of them. */
async function startMapView() {
  document.getElementById('stage-project').textContent = 'kj stage · every factory';
  try {
    const res = await fetch('/api/stage/map', { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    const body = await res.json();
    if (!res.ok) { tell([`The board cannot draw the map: ${body.error}`]); return; }
    if (!body.length) { tell(['The board knows no project with a folder on this machine: there is no factory to show.']); return; }
    const { startMap } = await import('./map.js');
    startMap({ canvas, factories: body, token, tell, counts: document.getElementById('stage-counts') });
    status.classList.add('stage-unseen'); // KJC-TSK-1466: once the map is up its lines only speak to screen readers
  } catch (err) {
    tell([`The board did not answer (${err.message})`]);
  }
}

const wantsMap = new URLSearchParams(location.search).get('map') === '1';
if (!document.createElement('canvas').getContext('webgl2')) tell(['This browser has no WebGL2, so the 3D stage cannot be drawn.']);
else if (wantsMap) await startMapView();
else if (project) await start();
else tell(['Open the stage of a project: kj stage, or the Stage link of the board. Every factory at once: add ?map=1.']);

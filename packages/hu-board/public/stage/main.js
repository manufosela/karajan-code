// KJC-TSK-1398 (ADR 0046, 0047): kj stage, the factory at rest. The film's cast
// works the hall and each station shows the last real state of the project;
// nothing is simulated. The live cues come from the director (KJC-TSK-1399).
import * as THREE from 'three';
import { buildFactory, createFactory, framing } from './factory.js';
import { hallWidth } from './layout.js';
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
const tell = (lines) => status.replaceChildren(...lines.map((text) => Object.assign(document.createElement('li'), { textContent: text })));

/** Builds the hall with one workshop per lane; returns its pieces, crew, hall and render. */
function buildScene(lanes) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const { scene, camera, target } = createFactory(renderer);
  const { crew, pieces, stand, hall } = buildFactory(scene, lanes);
  const render = () => renderer.render(scene, camera);
  // The camera pulls back as the hall grows or the screen narrows, so every workshop
  // fits; the wheel or a pinch brings it closer or further (KJC-TSK-1433).
  let zoom = 1;
  const refit = () => {
    renderer.setSize(innerWidth, innerHeight, false);
    camera.aspect = innerWidth / innerHeight;
    camera.position.copy(target).add(framing(hallWidth(hall.count()), camera.aspect).multiplyScalar(zoom));
    camera.lookAt(target);
    camera.updateProjectionMatrix();
    render();
  };
  addEventListener('resize', refit);
  listenZoom(canvas, (k) => { zoom = k; refit(); });
  refit();
  return { scene, pieces, crew, stand, hall, camera, render, refit };
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

if (!project) tell(['Open the stage of a project: kj stage, or the Stage link of the board.']);
else if (document.createElement('canvas').getContext('webgl2')) await start();
else tell(['This browser has no WebGL2, so the 3D stage cannot be drawn.']);

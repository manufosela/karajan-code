// KJC-TSK-1398 (ADR 0046, 0047): kj stage, the factory at rest. The film's cast
// works the hall and each station shows the last real state of the project;
// nothing is simulated. The live cues come from the director (KJC-TSK-1399).
import * as THREE from 'three';
import { createFactory } from './factory.js';
import { populate } from './crew.js';
import { restState } from './rest.js';
import { runAmbient } from './ambient-loop.js';

const canvas = document.getElementById('stage');
const status = document.getElementById('stage-status');
const project = new URLSearchParams(location.search).get('project');
const tell = (lines) => status.replaceChildren(...lines.map((text) => Object.assign(document.createElement('li'), { textContent: text })));

/** Builds the hall; returns its stations by id, its crew by id and its render. */
function buildScene() {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const { scene, camera, target } = createFactory(renderer);
  const { crew, pieces } = populate(scene);
  const render = () => renderer.render(scene, camera);
  const framing = camera.position.clone();
  const resize = () => {
    renderer.setSize(innerWidth, innerHeight, false);
    camera.aspect = innerWidth / innerHeight;
    // A narrow screen pulls the camera back so the whole line still fits across it.
    camera.position.copy(target).lerp(framing, Math.max(1, 1.6 / camera.aspect));
    camera.lookAt(target);
    camera.updateProjectionMatrix();
    render();
  };
  addEventListener('resize', resize);
  resize();
  return { pieces, crew, camera, render };
}

/** The last real state of the project, or the reason the board could not give it. */
async function fetchState() {
  try {
    const res = await fetch(`/api/stage/state?project=${encodeURIComponent(project)}`);
    const body = await res.json();
    return res.ok ? { state: body } : { error: body.error };
  } catch (err) {
    return { error: `the board did not answer (${err.message})` };
  }
}

async function start() {
  document.getElementById('stage-project').textContent = `kj stage · ${project}`;
  const scene = buildScene();
  const { state, error } = await fetchState();
  if (error) { tell([`The board cannot read this project: ${error}`]); return; }
  const { lights, lines } = restState(state, Date.now());
  for (const [id, { gold, red }] of Object.entries(lights)) scene.pieces[id].setLight(gold, red);
  tell(lines.length ? lines : ['Nothing has happened in this project yet: the stage is at rest.']);
  scene.render();
  // The crew is always busy (ADR 0047), except for someone who asked for no motion.
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) runAmbient(scene, document.getElementById('stage-bubble'));
}

if (!project) tell(['Open the stage of a project: kj stage, or the Stage link of the board.']);
else if (document.createElement('canvas').getContext('webgl2')) await start();
else tell(['This browser has no WebGL2, so the 3D stage cannot be drawn.']);

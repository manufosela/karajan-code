// KJL-TSK-0163 (ADR 0052): the factory page's starter. It plays the recorded trace of one
// real task on the kj stage scene the board uses, copied at deploy by copy-stage.mjs.
import * as THREE from 'three';
import { timeline, asNow, shifted } from './replay-timeline.js';

const canvas = document.getElementById('stage');
const status = document.getElementById('stage-status');
const loading = document.getElementById('stage-loading');
const clock = document.getElementById('factory-clock');
const playButton = document.getElementById('factory-play');
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
const utc = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });

const loaded = () => requestAnimationFrame(() => { loading.hidden = true; });
const tell = (lines) => {
  status.replaceChildren(...lines.map((text) => Object.assign(document.createElement('li'), { textContent: text })));
  loaded();
};
const showTime = (at) => {
  clock.dateTime = at;
  clock.textContent = `${utc.format(new Date(at))} UTC`;
};

async function loadScene() {
  const { dir } = await (await fetch('./stage.json')).json();
  document.head.append(Object.assign(document.createElement('link'), { rel: 'stylesheet', href: `./${dir}/stage.css` }));
  const [factory, layout, live, rest, zoom, marks] = await Promise.all(
    ['factory', 'layout', 'live', 'rest', 'zoom', 'marks'].map((name) => import(`./${dir}/${name}.js`)),
  );
  return { factory, layout, live, rest, zoom, marks };
}

/** Builds the hall with one workshop per lane, as the board's starter does. */
function buildScene(lanes, { factory, layout, zoom }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const { scene, camera, target } = factory.createFactory(renderer);
  const centreZ = target.z;
  const { crew, pieces, stand, hall, wall, releaseTable } = factory.buildFactory(scene, lanes);
  const render = () => renderer.render(scene, camera);
  let level = 1;
  const refit = () => {
    renderer.setSize(innerWidth, innerHeight, false);
    camera.aspect = innerWidth / innerHeight;
    const n = hall.count();
    const deep = layout.hallDepth(n) > 0 ? layout.hallDepth(n) + 10 : 0;
    target.z = centreZ + deep / 2;
    camera.position.copy(target).add(factory.framing(Math.max(layout.hallWidth(n), deep * camera.aspect), camera.aspect).multiplyScalar(level));
    camera.lookAt(target);
    camera.updateProjectionMatrix();
    render();
  };
  addEventListener('resize', refit);
  zoom.listenZoom(canvas, (k) => { level = k; refit(); });
  refit();
  return { scene, pieces, crew, stand, hall, wall, releaseTable, camera, render, refit };
}

function player(demo, live, scene, marks) {
  const steps = timeline(demo.events);
  let index = 0;
  let timer = null;
  let playing = false;
  const draw = () => { live.frame(performance.now()); scene.render(); };
  const label = () => { playButton.textContent = playing ? 'Pause' : index >= steps.length ? 'Play again' : 'Play'; };
  const finish = () => { playing = false; label(); };
  const step = () => {
    const { event } = steps[index];
    live.push(asNow(event, Date.now()), performance.now());
    showTime(event.at);
    if (still) { draw(); setTimeout(draw, marks.MARK_MS + 50); }
    index += 1;
    if (index >= steps.length) { finish(); return; }
    timer = setTimeout(step, steps[index].ms - steps[index - 1].ms);
  };
  // A fresh scene for every replay: reloading leaves no robot or label of the last one behind.
  const restart = () => { location.hash = 'play'; location.reload(); };
  const play = () => { if (index >= steps.length) { restart(); return; } playing = true; label(); step(); };
  const pause = () => { clearTimeout(timer); playing = false; label(); };
  playButton.addEventListener('click', () => (playing ? pause() : play()));
  document.getElementById('factory-restart').addEventListener('click', restart);
  const frame = (ms) => { live.frame(ms); scene.render(); requestAnimationFrame(frame); };
  if (!still) requestAnimationFrame(frame);
  label();
  if (!still || location.hash === '#play') play();
}

async function start() {
  const demo = await (await fetch('./demo-hu-3870.json')).json();
  const modules = await loadScene();
  const state = modules.rest.acrossLanes(shifted(demo.state, Date.now() - Date.parse(demo.from)).lanes);
  const scene = buildScene(demo.lanes, modules);
  const tellState = (lines) => tell(lines.length ? lines : ['Nothing has happened in this task yet: the stage is at rest.']);
  const live = modules.live.createLive(scene, { state, tell: tellState, counts: document.getElementById('stage-counts') });
  tellState(live.settle().lines);
  scene.render();
  showTime(demo.from);
  player(demo, live, scene, modules.marks);
}

if (!document.createElement('canvas').getContext('webgl2')) tell(['This browser has no WebGL2, so the 3D scene cannot be drawn.']);
else await start();

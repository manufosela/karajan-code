// Runs the film in the hero: renderer, clock, captions, skip and replay.
// The last frame stays alive as the hero art and follows the pointer.
// 'three' is the landing's trimmed bundle (public/lib/three.min.js): the core
// classes and the addons the film uses, all under one name (tests/landing/three-bundle.test.js).
import * as THREE from 'three';
import { createStage } from './stage.js';
import { createCast } from './cast.js';
import { perform } from './score.js';
import { cameraAt } from './camera.js';
import { fitBeside } from './framing.js';
import { T, asideAt, lerp } from './timeline.js';

const root = document.documentElement;
const hero = document.getElementById('hero');
const canvas = document.getElementById('film');
const caption = document.getElementById('caption');
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
// The hero stacks the copy over the film on narrow or near-square screens (css/landing.css).
const stacked = matchMedia('(max-width: 1000px), (max-aspect-ratio: 23/20)');
const frozenAt = new URLSearchParams(location.search).get('t');
// Captions and crate labels live in the page, so each language brings its own.
const CAPTIONS = [...document.querySelectorAll('#captions li')]
  .map((li) => [Number(li.dataset.from), Number(li.dataset.to), li.textContent]);
const KINDS = canvas.dataset.kinds.split('|');
const TOOLS = canvas.dataset.tools.split('|').map((name, i) => ({ name, kind: KINDS[i] }));
const FRESH = { tool: canvas.dataset.newTool, badge: canvas.dataset.newBadge };

function supportsWebGL() {
  const probe = document.createElement('canvas');
  return Boolean(probe.getContext('webgl2'));
}

function showCaption(t) {
  const active = CAPTIONS.find(([a, b]) => t >= a && t <= b);
  if (!active || !root.classList.contains('film-on')) { caption.style.opacity = '0'; return; }
  const [a, b, text] = active;
  if (caption.textContent !== text) caption.textContent = text;
  caption.style.opacity = String(Math.min(1, (t - a) / 0.3, (b - t) / 0.3));
}

function finish() {
  root.classList.remove('film-on', 'film-outro');
  caption.style.opacity = '0';
  localStorage.setItem('kj-intro-seen', '1');
}

if (supportsWebGL()) {
  await Promise.all([
    document.fonts.load('600 74px "Inter"'),
    document.fonts.load('500 44px "JetBrains Mono"'),
  ]);
  start();
} else {
  console.warn('[film] WebGL2 unavailable: showing the still hero instead of the film.');
  root.classList.add('no-webgl');
  root.classList.remove('film-pending', 'film-on');
}

function start() {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 140);
  const stage = createStage(scene, renderer);
  const cast = createCast(scene, TOOLS, FRESH);

  const composer = new THREE.EffectComposer(renderer);
  composer.addPass(new THREE.RenderPass(scene, camera));
  const bloom = new THREE.UnrealBloomPass(new THREE.Vector2(1, 1), 0.5, 0.45, 1);
  composer.addPass(bloom);
  composer.addPass(new THREE.OutputPass());

  let width = 1, height = 1, copyRight = 0, copyBottom = 0;
  let beside = { wide: 1, shift: 0 };
  // The pieces the final shot must show whole (not the verdict's wave, which spreads out invisibly).
  const framed = [cast.conductor.root, cast.rag.root, cast.watch.root, cast.stand.group,
    cast.verdict.pedestal, cast.verdict.check, ...cast.crates.map((c) => c.group)];
  const box = new THREE.Box3();
  const corner = new THREE.Vector3();
  // Where the cast falls on screen, in px, in its final pose seen from `wide`.
  const castSpan = (wide) => {
    const shot = cameraAt(T.end, perform(T.end, cast, stage), wide);
    camera.position.copy(shot.pos);
    camera.lookAt(shot.look);
    camera.clearViewOffset();
    camera.updateMatrixWorld();
    let left = Infinity, right = -Infinity;
    for (const piece of framed) {
      box.setFromObject(piece);
      for (let i = 0; i < 8; i++) {
        corner.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z);
        const x = (corner.project(camera).x + 1) / 2 * width;
        left = Math.min(left, x);
        right = Math.max(right, x);
      }
    }
    return { left, right };
  };
  const resize = () => {
    width = hero.clientWidth;
    height = hero.clientHeight;
    const pixelRatio = Math.min(devicePixelRatio, 1.75);
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(width, height, false);
    composer.setPixelRatio(pixelRatio);
    composer.setSize(width, height);
    stage.setPixelRatio(pixelRatio);
    camera.aspect = width / height;
    // Where the hero copy ends: the final shot is framed in the room beside it or below it.
    const copy = document.querySelector('.hero-copy').getBoundingClientRect();
    const frame = hero.getBoundingClientRect();
    copyRight = copy.right - frame.left;
    copyBottom = copy.bottom - frame.top;
    // Measured twice: perspective makes the first pull-back slightly off.
    const room = { width, copyRight, gap: Math.max(24, 0.03 * width) };
    const fit = Math.max(1, 1.5 / camera.aspect);
    const first = fitBeside(castSpan(fit), room);
    const wide = fit * first.wide * fitBeside(castSpan(fit * first.wide), room).wide;
    beside = { wide, shift: fitBeside(castSpan(wide), room).shift };
  };
  resize();

  const pointer = { x: 0, y: 0, sx: 0, sy: 0 };
  addEventListener('pointermove', (e) => {
    pointer.x = (e.clientX / innerWidth) * 2 - 1;
    pointer.y = -((e.clientY / innerHeight) * 2 - 1);
  }, { passive: true });

  let startedAt = performance.now() - T.end * 1000;
  let playing = false;
  const filmTime = () => (frozenAt === null ? (performance.now() - startedAt) / 1000 : Number(frozenAt));

  function renderAt(t) {
    const cubeX = perform(t, cast, stage);
    const aspect = width / height;
    const aside = asideAt(t);
    const besideCopy = !stacked.matches;
    // The final shot pulls back until the cast fits the room the copy leaves.
    const fit = Math.max(1, 1.5 / aspect);
    const room = besideCopy ? beside.wide : 0.65 * height / Math.max(1, height - copyBottom);
    const wide = Math.min(2.4, lerp(fit, Math.max(fit, room), aside));
    const shot = cameraAt(t, cubeX, wide);
    scene.fog.density = 0.042 / wide;
    if (t > T.end && !reduced) {
      pointer.sx += (pointer.x - pointer.sx) * 0.05;
      pointer.sy += (pointer.y - pointer.sy) * 0.05;
      shot.pos.x += pointer.sx * 0.9;
      shot.pos.y += pointer.sy * 0.45;
      for (const robot of [cast.conductor, cast.rag, cast.watch]) {
        robot.head.rotation.y += pointer.sx * 0.35;
        robot.head.rotation.x = -pointer.sy * 0.12;
      }
    }
    camera.position.copy(shot.pos);
    camera.lookAt(shot.look);
    if (besideCopy) camera.setViewOffset(width, height, beside.shift * aside, 0, width, height);
    else camera.setViewOffset(width, height, 0, -0.47 * copyBottom * aside, width, height);
    camera.updateProjectionMatrix();
    composer.render();
  }


  function tick() {
    if (!playing) return;
    const t = filmTime();
    if (root.classList.contains('film-on')) {
      if (t >= T.titles) root.classList.add('film-outro');
      if (t >= T.end) finish();
    }
    showCaption(t);
    renderAt(t);
    requestAnimationFrame(tick);
  }

  const setPlaying = (on) => {
    if (on === playing) return;
    playing = on;
    if (on) requestAnimationFrame(tick);
  };

  function playFilm() {
    startedAt = performance.now();
    root.classList.remove('film-pending', 'film-outro');
    root.classList.add('film-on');
    scrollTo(0, 0);
    document.getElementById('skip').focus({ preventScroll: true });
    setPlaying(true);
  }

  function skip() {
    startedAt = performance.now() - T.end * 1000;
    finish();
  }

  document.getElementById('skip').addEventListener('click', skip);
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && root.classList.contains('film-on')) skip(); });
  document.getElementById('replay').addEventListener('click', () => { if (!reduced) playFilm(); });
  addEventListener('resize', () => { resize(); if (!playing) renderAt(filmTime()); });

  if (reduced || frozenAt !== null) {
    root.classList.remove('film-pending');
    if (frozenAt !== null && Number(frozenAt) < T.end) root.classList.add('film-on');
    showCaption(filmTime());
    renderAt(reduced ? T.end : filmTime());
  } else {
    new IntersectionObserver(([entry]) => setPlaying(entry.isIntersecting && !document.hidden)).observe(hero);
    document.addEventListener('visibilitychange', () => setPlaying(!document.hidden && hero.getBoundingClientRect().bottom > 0));
    if (root.classList.contains('film-pending')) playFilm();
    else setPlaying(true);
  }

  // Lets tooling freeze a frame: window.__film.seek(seconds).
  globalThis.__film = { seek: (t) => { startedAt = performance.now() - t * 1000; renderAt(t); showCaption(t); }, T };
}

// KJC-TSK-1398 (ADR 0046, 0047): kj stage, the factory at rest. The film's cast
// works the hall and each station shows the last real state of the project;
// nothing is simulated. The live cues come from the director (KJC-TSK-1399).
import * as THREE from 'three';
import { buildFactory, createFactory, framing } from './factory.js';
import { hallDepth, hallSpan, hallWidth, mailboxSpot } from './layout.js';
import { glowAt } from './mail.js';
import { createMailbox } from './mailbox.js';
import { createLive } from './live.js';
import { acrossLanes } from './rest.js';
import { boardToken, withToken } from './token.js';
import { listenPan, listenZoom, panTarget } from './zoom.js';
import { MARK_MS } from './marks.js';
import { mountAvatarPanel } from './avatar-panel.js';
import { panelEntries, panelHref, panelLine } from './project-panel.js';

/** KJC-BUG-0557: how often the scene checks itself against the board's state. */
const RESYNC_MS = 60 * 1000;

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
  const { crew, pieces, stand, hall, wall, releaseTable, versionBoard } = buildFactory(scene, lanes);
  const render = () => renderer.render(scene, camera);
  // The camera pulls back as the hall grows or the screen narrows, so every workshop
  // fits; the wheel or a pinch brings it closer or further (KJC-TSK-1433).
  let zoom = 1;
  // KJC-TSK-1592: how far a drag has walked the view from the middle of the hall.
  let pan = { x: 0, z: 0 };
  const refit = () => {
    renderer.setSize(innerWidth, innerHeight, false);
    camera.aspect = innerWidth / innerHeight;
    // KJC-TSK-1488: the camera looks at the middle of the rows and fits their depth too.
    const n = hall.count();
    // The status lines sit over the bottom of the view, so the front row needs some room below it.
    const deep = hallDepth(n) > 0 ? hallDepth(n) + 10 : 0;
    target.x = pan.x;
    target.z = HALL_CENTRE_Z + deep / 2 + pan.z;
    camera.position.copy(target).add(framing(Math.max(hallWidth(n), deep * camera.aspect), camera.aspect).multiplyScalar(zoom));
    camera.lookAt(target);
    camera.updateProjectionMatrix();
    render();
  };
  addEventListener('resize', refit);
  listenZoom(canvas, (k) => { zoom = k; refit(); });
  // KJC-TSK-1592: dragging walks over the hall at any zoom, as on the map, and stops at its edge.
  listenPan(canvas, (dx, dy) => {
    const metresPerPx = (2 * camera.position.distanceTo(target) * Math.tan((camera.fov * Math.PI) / 360)) / innerHeight;
    pan = panTarget(pan, dx, dy, metresPerPx, hallSpan(hall.count()));
    refit();
  });
  refit();
  return { scene, pieces, crew, stand, hall, wall, releaseTable, versionBoard, camera, render, refit };
}

/** KJC-TSK-1569 (ADR 0056): this person's avatar from the board; none when it cannot be read. */
async function fetchAvatar() {
  try {
    const res = await fetch('/api/stage/me', { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

/** KJC-TSK-1570: keeps `avatar` on the board; answers what it kept, or throws why it did not. */
async function saveAvatar(avatar) {
  const res = await fetch('/api/stage/me', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(avatar),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** KJC-TSK-1570: the Avatar button opens the panel; a saved avatar dresses `scene`'s robots at once. */
function offerAvatarPanel(scene) {
  const button = document.getElementById('stage-avatar');
  mountAvatarPanel({ button, dialog: document.getElementById('stage-avatar-panel'), load: fetchAvatar, save: saveAvatar, onSaved: (avatar) => scene.setAvatar(avatar) });
  button.hidden = false;
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
  const live = createLive(scene, { state, tell: tellState, counts: document.getElementById('stage-counts'), avatar: await fetchAvatar() });
  tellState(live.settle().lines);
  offerAvatarPanel(live);
  // ADR 0048: nothing moves without a real event. The frames only play what events
  // set going; someone who asked for no motion gets the lights and the list only.
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  // KJC-BUG-0578: the factory's mailbox at the front right of its hall, lit while handoffs wait
  // (the map draws its own for each factory).
  const mailbox = createMailbox();
  scene.scene.add(mailbox.group);
  const play = (ms) => {
    live.frame(ms);
    const at = mailboxSpot(scene.hall.count());
    mailbox.group.position.set(at.x, 0, at.z);
    mailbox.group.scale.setScalar(at.scale);
    mailbox.light(glowAt(live.pending(), ms, still));
  };
  play(performance.now());
  scene.render();
  // KJC-TSK-1600: the mouse over a robot, or a tap on it (a press that does not drag), shows its
  // full label; without motion, each pointing draws one frame.
  const pointAt = (at) => { live.point(at); if (still) { play(performance.now()); scene.render(); } };
  let pressed = null;
  canvas.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') pointAt({ left: e.clientX, top: e.clientY }); });
  canvas.addEventListener('pointerleave', () => pointAt(null));
  canvas.addEventListener('pointerdown', (e) => { pressed = { left: e.clientX, top: e.clientY }; });
  canvas.addEventListener('pointerup', (e) => {
    const tap = pressed && Math.hypot(e.clientX - pressed.left, e.clientY - pressed.top) < 8;
    if (tap && e.pointerType !== 'mouse') pointAt({ left: e.clientX, top: e.clientY });
  });
  const events = new EventSource(withToken(`/api/events?project=${encodeURIComponent(project)}`, token));
  events.onmessage = ({ data }) => {
    live.push(JSON.parse(data), performance.now());
    // Without motion, each event still draws one frame: its lights, marks and gates, and
    // another once its mark has expired, so nothing stays lit (KJC-TSK-1437).
    if (still) {
      const draw = () => { play(performance.now()); scene.render(); };
      draw();
      setTimeout(draw, MARK_MS + 50);
    }
  };
  // KJC-BUG-0557: every minute, the scene checks itself against the board's state.
  setInterval(async () => {
    const now = await fetchState();
    if (now.state) live.resync(now.state, performance.now());
  }, RESYNC_MS);
  const frame = (ms) => {
    play(ms);
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
    const map = startMap({ canvas, factories: body, token, tell, counts: document.getElementById('stage-counts'), avatar: await fetchAvatar() });
    offerAvatarPanel(map);
    // KJC-BUG-0557: every minute, each factory checks itself against the board's state.
    setInterval(async () => {
      const again = await fetch('/api/stage/map', { headers: token ? { Authorization: `Bearer ${token}` } : {} }).catch(() => null);
      if (again?.ok) map.resync(await again.json());
    }, RESYNC_MS);
    status.classList.add('stage-unseen'); // KJC-TSK-1466: once the map is up its lines only speak to screen readers
  } catch (err) {
    tell([`The board did not answer (${err.message})`]);
  }
}

/**
 * KJC-TSK-1590: the side panel of projects; each opens its factory alone. It folds on a narrow
 * screen behind its button. The map's request also tells what goes on in each.
 */
async function mountProjectPanel() {
  const panel = document.getElementById('stage-projects');
  const toggle = document.getElementById('stage-projects-toggle');
  toggle.addEventListener('click', () => {
    const open = toggle.getAttribute('aria-expanded') !== 'true';
    toggle.setAttribute('aria-expanded', String(open));
    panel.classList.toggle('stage-projects-open', open);
  });
  const res = await fetch('/api/stage/map', { headers: token ? { Authorization: `Bearer ${token}` } : {} }).catch(() => null);
  if (!res?.ok) { panel.querySelector('p').textContent = 'The board did not list its projects.'; return; }
  const factories = await res.json();
  if (!factories.length) { panel.querySelector('p').textContent = 'The board knows no project with a folder on this machine.'; return; }
  const items = panelEntries(factories, project).map((entry) => {
    const link = Object.assign(document.createElement('a'), { href: panelHref(entry.project) });
    if (entry.current) link.setAttribute('aria-current', 'page');
    const what = Object.assign(document.createElement('small'), { textContent: panelLine(entry) });
    link.append(Object.assign(document.createElement('strong'), { textContent: entry.name }), what);
    const item = document.createElement('li');
    item.append(link);
    return item;
  });
  panel.querySelector('p').remove();
  panel.querySelector('ul').replaceChildren(...items);
}

/** The map, one factory, or the word to pick one in the panel. */
async function startStage() {
  const wantsMap = new URLSearchParams(location.search).get('map') === '1';
  if (!document.createElement('canvas').getContext('webgl2')) tell(['This browser has no WebGL2, so the 3D stage cannot be drawn.']);
  else if (wantsMap) await startMapView();
  else if (project) await start();
  else tell(['Pick a project in the panel to open its factory. Every factory at once: the Every factory link.']);
}

// KJC-TSK-1590: the panel and the scene load side by side; neither waits for the other.
await Promise.all([mountProjectPanel(), startStage()]);

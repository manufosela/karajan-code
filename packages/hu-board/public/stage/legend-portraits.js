// KJC-TSK-1618: the portraits of the cast legend. Each character is built once with the scene's own
// builders, as portrait-recipes.js says, drawn in one offscreen renderer framed by its size, and
// kept as an image; the renderer lets its WebGL context go once no portrait is left to draw.
import * as THREE from 'three';
import { robotFor } from './agents-floor.js';
import { dress } from './attire.js';
import { createRobot } from './cast/robot.js';
import { createPiece } from './cast/piece.js';
import { createStand } from './cast/stand.js';
import { COURIER } from './couriers.js';
import { LOOKS, ROBOTS } from './crew.js';
import { createDrone } from './drone-mesh.js';
import { STATIONS } from './layout.js';
import { createMailbox } from './mailbox.js';
import { TEAMMATE, recipeOf } from './portrait-recipes.js';
import { createReleaseTable } from './release-table.js';
import { createWall } from './wall.js';

const SIZE = { width: 440, height: 320 };
const FOV = 30;
const WARDROBE_STEP = 2.6; // between the robots of the wardrobe's row
// A robot turned three quarters, so its backpack shows beside it.
const THREE_QUARTERS = 0.95;
// How much room around the character: a robot close up, a piece or a thing with all of it in.
const MARGIN = { robot: 0.95, other: 1.3 };

const turned = (root) => { root.rotation.y = THREE_QUARTERS; return root; };
/** An agent of the floor, in the own avatar or a teammate's, dressed in its model. */
function agentOf({ worker, avatar }, own) {
  const robot = robotFor(worker, avatar === 'teammate' ? TEAMMATE : own, { login: own?.login ?? null });
  dress(robot, worker);
  return turned(robot.root);
}

/** One robot in each model's wardrobe, side by side. */
function wardrobeOf(models) {
  const row = new THREE.Group();
  models.forEach((model, i) => {
    const robot = createRobot({ accent: 0xd97757, name: model });
    dress(robot, { model, effort: 'medium' });
    robot.root.position.x = (i - (models.length - 1) / 2) * WARDROBE_STEP;
    row.add(robot.root);
  });
  return row;
}

const crewOf = (id) => turned(createRobot(id === 'courier' ? { accent: COURIER, name: 'courier' } : ROBOTS.find(([key]) => key === id)[1]).root);
function pieceOf(id) {
  const [name, kind, body] = LOOKS[id];
  const piece = createPiece(STATIONS.indexOf(id), name, { kind, body });
  piece.setLight(1);
  return piece.group;
}

const standOf = () => createStand('atril', [['atril', 'skills'], ...STATIONS.map((id) => [LOOKS[id][0], 'skill'])]).group;
// A few cards for the wall and the table to show, as the board's trace gives them.
const SAMPLE = [['HU-1', 'pending'], ['HU-2', 'running'], ['HU-3', 'done'], ['HU-4', 'done']]
  .map(([id, status]) => ({ id, title: 'A card', status, lane: 'main', at: '2026-11-14T08:00:00.000Z' }));

function thingOf(id) {
  const group = new THREE.Group();
  if (id === 'wall') createWall(group).show(SAMPLE);
  if (id === 'release') createReleaseTable(group).show(SAMPLE.filter((card) => card.status === 'done'), null);
  if (id === 'drone') createDrone(group).show({ x: 0, y: 0, z: 0, carrying: true }, 0);
  const mailbox = id === 'mailbox' ? createMailbox() : null;
  mailbox?.light(1);
  if (mailbox) group.add(mailbox.group);
  return group;
}

/** The character of card `id`, as its recipe says; null without one. */
function characterOf(id, own) {
  const recipe = recipeOf(id);
  if (!recipe) return null;
  if (recipe.worker) return agentOf(recipe, own);
  if (recipe.wardrobe) return wardrobeOf(recipe.wardrobe);
  if (recipe.crew) return crewOf(recipe.crew);
  if (recipe.piece) return pieceOf(recipe.piece);
  if (recipe.stand) return standOf();
  return thingOf(recipe.thing);
}

/** A camera a little above the front of `object`, far enough for all of it to fit. */
function cameraFor(object, margin) {
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  const aspect = SIZE.width / SIZE.height;
  const fit = Math.max(size.y, size.x / aspect, 0.1) / (2 * Math.tan((FOV * Math.PI) / 360));
  const camera = new THREE.PerspectiveCamera(FOV, aspect, 0.01, 500);
  camera.position.set(centre.x, centre.y + size.y * 0.15, centre.z + size.z / 2 + fit * margin);
  camera.lookAt(centre);
  return camera;
}

/**
 * The portraits for `own` (this person's avatar, with their login): `portraitOf(card)` answers its
 * image's URL, or null when the character cannot be drawn; each is drawn once, one per frame.
 */
export function createPortraits(own) {
  const kept = new Map();
  let renderer = null;
  let pending = 0;
  let queue = Promise.resolve();
  const draw = (id) => {
    const character = characterOf(id, own);
    if (!character) return null;
    renderer ??= Object.assign(new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true }), { toneMapping: THREE.ACESFilmicToneMapping });
    renderer.setSize(SIZE.width, SIZE.height, false);
    const scene = new THREE.Scene();
    const key = new THREE.DirectionalLight(0xffffff, 2.4);
    key.position.set(3, 6, 8);
    scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x1a2230, 2), key, character);
    character.updateMatrixWorld(true);
    const recipe = recipeOf(id);
    renderer.render(scene, cameraFor(character, recipe.worker || recipe.crew ? MARGIN.robot : MARGIN.other));
    return renderer.domElement.toDataURL('image/png');
  };
  const done = () => {
    pending -= 1;
    if (pending || !renderer) return;
    renderer.dispose();
    renderer.forceContextLoss();
    renderer = null;
  };
  return (card) => {
    if (!kept.has(card.id)) {
      pending += 1;
      queue = queue.then(() => new Promise((next) => requestAnimationFrame(next))).then(() => draw(card.id)).catch(() => null);
      kept.set(card.id, queue);
      queue.finally(done);
    }
    return kept.get(card.id);
  };
}

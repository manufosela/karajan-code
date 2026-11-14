// KJC-TSK-1431 (decided by the maintainer on 2026-11-05): the agents kj launches
// on the factory floor, each a robot of its own colour with its name over its
// head. KJC-TSK-1435: the host too, with its badge and the tool it uses, and its
// subagents as dwarfs. workers.js says where each one is; this puts its robot there.
import * as THREE from 'three';
import { createRobot } from './cast/robot.js';
import { SCALE } from './layout.js';
import { onScreen, tagAt } from './screen.js';
import { declutter, pickNear, tagText } from './robot-labels.js';
import { createLaptop } from './laptop.js';
import { dress } from './attire.js';
import { avatarFor, ownerColor } from './avatars.js';
import { carry } from './backpack.js';
import { wear } from './costume-mesh.js';
import { HOST_SCALE, chestOf, hologramOf, hostColor, laptopLift } from './host-look.js';
import { TYPING_YAW, accentOf, codeScrollAt, typingAt, visitKey, withActivity, workerAt, workersFrom } from './workers.js';

// The robot is 3.5 m tall before scaling; a subagent is a dwarf (KJC-TSK-1435).
const DWARF = 0.55;
// KJC-TSK-1598: a host is a little bigger than everyone else.
const SIZE = { subagent: DWARF, host: HOST_SCALE };
const scaleOf = (worker) => SCALE.crew * (SIZE[worker.role] ?? 1);
// Just over the helmet, in the robot's own frame.
const HALO_Y = 3.75;

/** KJC-TSK-1435 (ADR 0048): the host's name in its colour on its chest. Never a third-party logo. */
function badge(name, accent) {
  const canvas = Object.assign(document.createElement('canvas'), { width: 256, height: 96 });
  const ctx = canvas.getContext('2d');
  const colour = `#${accent.toString(16).padStart(6, '0')}`;
  ctx.fillStyle = '#10161f';
  ctx.fillRect(0, 0, 256, 96);
  ctx.strokeStyle = colour;
  ctx.lineWidth = 10;
  ctx.strokeRect(5, 5, 246, 86);
  ctx.fillStyle = colour;
  ctx.font = '700 54px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(name.slice(0, 8), 128, 50);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.3), new THREE.MeshBasicMaterial({ map: texture }));
  // Just in front of the body (0.8 m of radius at that height), tilted up towards the camera.
  plate.position.set(0, 0.92, 0.9);
  plate.rotation.x = -0.35;
  return plate;
}

/** A robot that left frees what it holds on the GPU: each one has its own geometry (couriers.js too). */
export function dispose(robot) {
  robot.root.traverse((o) => { o.geometry?.dispose(); o.material?.map?.dispose(); o.material?.dispose?.(); });
}

/** KJC-TSK-1601: what the hologram shows, drawn once in light on a see-through canvas. */
function glyphTexture(glyph, color) {
  const canvas = Object.assign(document.createElement('canvas'), { width: 256, height: 256 });
  const ctx = canvas.getContext('2d');
  ctx.font = '700 170px system-ui, "Noto Color Emoji", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = `#${color.toString(16).padStart(6, '0')}`;
  ctx.shadowBlur = 28;
  ctx.fillStyle = ctx.shadowColor;
  ctx.fillText(glyph, 128, 140);
  // Scan lines, as a projection has.
  ctx.globalCompositeOperation = 'destination-out';
  for (let y = 0; y < 256; y += 6) ctx.fillRect(0, y, 256, 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * KJC-TSK-1601 (the maintainer, 2026-11-13): over a host's head, instead of a halo, a hologram of
 * `glyph` in `color` on a small base of light, with its beam; agents-floor.js turns it slowly.
 */
function hologram(glyph, color) {
  const group = new THREE.Group();
  group.position.y = HALO_Y;
  const light = { color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending };
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.36, 0.05, 32), new THREE.MeshBasicMaterial({ ...light, opacity: 0.9 }));
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.28, 0.9, 32, 1, true), new THREE.MeshBasicMaterial({ ...light, opacity: 0.12, side: THREE.DoubleSide }));
  beam.position.y = 0.47;
  const face = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.95), new THREE.MeshBasicMaterial({
    map: glyphTexture(glyph, color), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
  }));
  face.position.y = 0.6;
  group.add(base, beam, face);
  return group;
}

/** A worker's robot, as the floor draws it (KJC-TSK-1618: the legend's portraits too). */
export function robotFor(worker, avatar, me) {
  // KJC-TSK-1569 (ADR 0056): in the colour its owner gave its role, with its owner's backpack.
  // KJC-TSK-1603: the robot in its agent's colour; its backpack in its owner's, which marks all theirs.
  const robot = createRobot({ accent: accentOf(worker.agent), name: worker.agent });
  carry(robot, avatar?.emblem ?? null, ownerColor(avatar));
  wear(robot, worker.role); // KJC-TSK-1604: Solomon as a king
  // KJC-TSK-1598: a host stands out: bigger, its owner's emblem on its chest. KJC-TSK-1601: and a
  // hologram of it over its head.
  if (worker.role === 'host') {
    const color = hostColor(worker, avatar);
    robot.hologram = hologram(hologramOf(worker, avatar, me), color);
    robot.hover.add(badge(chestOf(worker, avatar), color), robot.hologram);
    robot.lift = HOST_SCALE;
  }
  robot.root.scale.setScalar(scaleOf(worker));
  return robot;
}

// KJC-TSK-1486: typing, the hands come in towards the keyboard and the agent
// turns side on to the camera, which sees its hands on the keys and its lit screen.
const TYPING = { spread: -0.25, yaw: TYPING_YAW };

/**
 * KJC-TSK-1486: typing, a robot opens its laptop in its `accent` and types, `elapsed` ms since
 * it began; otherwise it puts it away. KJC-TSK-1522: kaRAGan types with it too.
 */
export function typeOn(robot, { typing, elapsed, yaw, accent }) {
  if (typing && !robot.laptop) {
    robot.laptop = createLaptop(accent);
    // KJC-TSK-1598: a bigger host's laptop opens where everyone's does, over its desk.
    const lift = laptopLift(robot.lift ?? 1);
    robot.laptop.position.set(0, lift.up, lift.ahead);
    robot.laptop.scale.setScalar(lift.scale);
    robot.hover.add(robot.laptop);
  }
  if (robot.laptop) robot.laptop.visible = typing;
  if (typing) robot.laptop.userData.scroll(codeScrollAt(elapsed)); // KJC-TSK-1493
  // The baton the family robot holds stays in its hand only while it walks.
  for (const held of robot.armR.hand.children) held.visible = !typing;
  // Each robot types at its own pace, from the moment it arrived.
  const hands = typing ? typingAt(elapsed) : { L: 0, R: 0 };
  robot.pose('L', typing ? TYPING.spread : 0, hands.L);
  robot.pose('R', typing ? TYPING.spread : 0, hands.R);
  if (typing) robot.root.rotation.y = yaw + TYPING.yaw;
}

/** KJC-TSK-1486: at its spot the agent opens its laptop and types; walking, it puts it away. */
const work = (robot, worker, pose, t) =>
  // KJC-TSK-1596: before atril it reads, its laptop still away.
  // KJC-TSK-1607: and a waiting host keeps its laptop closed.
  typeOn(robot, { typing: !pose.walking && !pose.reading && !pose.waiting, elapsed: t - worker.since, yaw: pose.yaw, accent: accentOf(worker.agent) });

/** `lanes` is [{lane, working}] of the last state; `xOf(lane)`, `zOf(lane)`: the centre of a lane's workshop. */
export function createAgentsFloor({ scene, camera, xOf, zOf, origin, avatar = null }, lanes, now) {
  let own = avatar; // KJC-TSK-1569: this person's avatar, which their robots wear
  // KJC-TSK-1598: this person's login, which names the own host; a saved avatar does not carry it.
  const me = { login: avatar?.login ?? null };
  let workers = lanes.flatMap(({ lane, working }) => workersFrom(working, now, lane));
  const robots = new Map();
  let pointer = null; // KJC-TSK-1600
  const screenOf = (point) => onScreen((origin ? point.clone().add(origin) : point.clone()).project(camera), innerWidth, innerHeight);
  /**
   * KJC-TSK-1600: each robot's label as robot-labels.js says: the robot under the pointer says
   * everything, a host its owner, the rest nothing; of two that overlap the more important stays.
   */
  const labelsOf = (seen) => {
    const pointed = pickNear(pointer, seen.map(({ key, body }) => ({ key, ...screenOf(body) })));
    const tags = seen.flatMap(({ key, worker, head }) => {
      const text = tagText(worker, { own: me, pointed: key === pointed });
      // KJC-TSK-1607: a waiting host's label in the colour of what it waits for.
      const className = worker.waiting ? `stage-worker stage-wait-${worker.waiting}` : 'stage-worker';
      return text ? [{ ...screenOf(head), text, rank: key === pointed ? 2 : 1, head, className }] : [];
    });
    return declutter(tags).map(({ text, head, className }) => tagAt(text, head, camera, { className, origin }));
  };
  return {
    push(event, at) { workers = withActivity(workers, event, at); },
    /** KJC-BUG-0581: the robots at work now (not walking out), each with its lane. */
    working: () => workers.filter((w) => w.leftAt === undefined).map(({ agent, role, lane, id, waiting }) => ({ agent, role, lane, id, ...(waiting ? { waiting } : {}) })),
    /** KJC-TSK-1569: a new own avatar; every robot is built again, in it, on the next frame. */
    setAvatar(next) {
      own = next;
      for (const robot of robots.values()) { scene.remove(robot.root); dispose(robot); }
      robots.clear();
    },
    /** Moves every agent's robot; returns their name tags. */
    /** KJC-TSK-1600: where the pointer is on screen, in css px; null once it leaves. */
    point(at) { pointer = at; },
    frame(t) {
      const seen = [];
      for (const worker of workers) {
        const pose = workerAt(worker, t, xOf, zOf);
        const key = visitKey(worker);
        let robot = robots.get(key);
        if (!pose) {
          if (robot) { scene.remove(robot.root); dispose(robot); robots.delete(key); }
          continue;
        }
        if (!robot) {
          // `me` (this person's login, declared at the top of createAgentsFloor) names the own host's
          // hologram; `own`, the saved avatar, does not carry the login.
          robot = robotFor(worker, avatarFor(worker, own), me);
          scene.add(robot.root);
          robots.set(key, robot);
        }
        robot.root.position.set(pose.x, 0, pose.z);
        robot.root.rotation.y = pose.yaw;
        // KJC-TSK-1611: one Karajan launches grows out of it and shrinks back into it.
        robot.root.scale.setScalar(scaleOf(worker) * Math.max(0.001, pose.size ?? 1));
        if (robot.hologram) robot.hologram.rotation.y = t / 1200; // KJC-TSK-1601: it turns slowly
        robot.hover.position.y = 0.1 + (pose.walking ? 0.06 * Math.abs(Math.sin(t / 110)) : 0);
        work(robot, worker, pose, t);
        dress(robot, worker); // KJC-TSK-1538: its model's accessory and its effort's build
        // Just above the helmet, so the label never sits on it.
        // KJC-TSK-1598: over a host's halo. KJC-TSK-1600: what it says is decided below, for all at once.
        const head = robot.root.position.clone().setY((worker.role === 'host' ? HALO_Y + 1.2 : 3.6) * scaleOf(worker));
        const body = robot.root.position.clone().setY(1.8 * scaleOf(worker));
        seen.push({ key, worker, head, body });
      }
      workers = workers.filter((w) => workerAt(w, t, xOf, zOf) !== null);
      return labelsOf(seen);
    },
  };
}

// KJC-TSK-1399 (ADR 0047): the factory live. Each real event moves the last
// state of its piece and, through the director (bursts folded), sends a plain
// crate down the line to its station, which flashes when the crate arrives.
// The crate carries nothing but the burst count: no invented content.
import * as THREE from 'three';
import { createDirector, cueFor } from './director.js';
import { LIFETIME_MS, boxAt } from './line.js';
import { LINE } from './layout.js';
import { restState, withEvent } from './rest.js';
import { createAgentsFloor } from './agents-floor.js';
import { turnAt } from './workers.js';

const CRATE = 0.5;
const DARK = { gold: 0, red: 0 };
// Shared by every crate, so a crate that leaves the line frees nothing on the GPU.
const crateMaterial = new THREE.MeshStandardMaterial({ color: 0xc9a26b, roughness: 0.8 });
const crateGeometry = new THREE.BoxGeometry(CRATE, CRATE * 0.8, CRATE);

/** A label over a point of the scene, placed in screen space. */
function tagAt(text, position, camera, className = 'stage-count') {
  const at = position.clone().setY(position.y + CRATE).project(camera);
  const tag = Object.assign(document.createElement('span'), { textContent: text, className });
  tag.style.left = `${((at.x + 1) / 2) * innerWidth}px`;
  tag.style.top = `${((1 - at.y) / 2) * innerHeight}px`;
  return tag;
}

export function createLive({ scene, pieces, camera, stand }, { state: initial, tell, counts }) {
  let state = initial;
  let turn = null; // KJC-TSK-1428: the atril skills an agent just started with
  const director = createDirector({ lifetime: LIFETIME_MS });
  const crates = new Map();
  const floor = createAgentsFloor({ scene, camera }, initial.working ?? [], performance.now());
  /** Every station back to its last real state; returns that state. */
  const settle = () => {
    const rest = restState(state, Date.now());
    for (const [id, piece] of Object.entries(pieces)) piece.setLight((rest.lights[id] ?? DARK).gold, (rest.lights[id] ?? DARK).red);
    return rest;
  };
  return {
    settle,
    /** Takes one stream event at `now` (performance clock, ms). */
    push(event, now) {
      const next = withEvent(state, event);
      if (next === state) return; // not a stage event
      state = next;
      // An agent at work moves no crate (KJC-TSK-1430): its robot walks in or out instead.
      if (cueFor(event)) director.push(event, now);
      floor.push(event, now);
      if (event.type === 'agent-activity' && event.phase === 'start' && event.skills?.length) turn = { at: now, skills: event.skills };
      tell(settle().lines);
    },
    /** Moves the crates and flashes the stations they reached. */
    frame(now) {
      const { lights } = settle();
      const cues = director.active(now);
      for (const [cue, mesh] of crates) if (!cues.includes(cue)) { scene.remove(mesh); crates.delete(cue); }
      const tags = [];
      for (const cue of cues) {
        const box = boxAt(cue, now);
        if (!box) continue;
        let mesh = crates.get(cue);
        if (!mesh) {
          mesh = new THREE.Mesh(crateGeometry, crateMaterial);
          mesh.castShadow = true;
          scene.add(mesh);
          crates.set(cue, mesh);
        }
        mesh.position.set(box.x, LINE.height + CRATE * 0.4, LINE.z);
        const base = lights[cue.piece] ?? DARK;
        if (cue.tone === 'refuse') pieces[cue.piece].setLight(base.gold, Math.max(base.red, box.flash));
        else pieces[cue.piece].setLight(Math.max(base.gold, box.flash), base.red);
        if (cue.count > 1) tags.push(tagAt(`×${cue.count}`, mesh.position, camera));
      }
      // atril turns a page per skill; its sheets are the film's, so the skill's real name rides above it.
      const page = turnAt(turn, now);
      if (page) {
        stand.turnTo(page.page, page.fraction);
        tags.push(tagAt(page.skill, stand.group.position.clone().setY(2.3), camera, 'stage-worker'));
      } else if (turn) {
        stand.turnTo(0, 1);
        turn = null;
      }
      counts.replaceChildren(...tags, ...floor.frame(now));
    },
  };
}

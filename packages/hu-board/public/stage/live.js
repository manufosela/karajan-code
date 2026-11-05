// KJC-TSK-1399 (ADR 0047): the factory live. Each real event moves the last
// state of its piece and, through the director (bursts folded), sends a plain
// crate down the line to its station, which flashes when the crate arrives.
// The crate carries nothing but the burst count: no invented content.
import * as THREE from 'three';
import { createDirector, cueFor } from './director.js';
import { LIFETIME_MS, boxAt } from './line.js';
import { LINE } from './layout.js';
import { restState, withEvent } from './rest.js';

const CRATE = 0.5;
const DARK = { gold: 0, red: 0 };
// Shared by every crate, so a crate that leaves the line frees nothing on the GPU.
const crateMaterial = new THREE.MeshStandardMaterial({ color: 0xc9a26b, roughness: 0.8 });
const crateGeometry = new THREE.BoxGeometry(CRATE, CRATE * 0.8, CRATE);

/** A burst count over its crate, placed in screen space. */
function countTag(count, position, camera) {
  const at = position.clone().setY(position.y + CRATE).project(camera);
  const tag = Object.assign(document.createElement('span'), { textContent: `×${count}`, className: 'stage-count' });
  tag.style.left = `${((at.x + 1) / 2) * innerWidth}px`;
  tag.style.top = `${((1 - at.y) / 2) * innerHeight}px`;
  return tag;
}

export function createLive({ scene, pieces, camera }, { state: initial, tell, counts }) {
  let state = initial;
  const director = createDirector({ lifetime: LIFETIME_MS });
  const crates = new Map();
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
      if (!cueFor(event)) return;
      state = withEvent(state, event);
      director.push(event, now);
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
        if (cue.count > 1) tags.push(countTag(cue.count, mesh.position, camera));
      }
      counts.replaceChildren(...tags);
    },
  };
}

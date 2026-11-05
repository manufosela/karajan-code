// KJC-TSK-1399, 1433 (ADR 0048): the factory live. Each real event moves the
// last state of its piece and, through the director (bursts folded), flashes
// the piece that handles it, marked with the burst count. Nothing else moves
// unless an agent really starts or ends its work.
import { createDirector, cueLevel, cueFor } from './director.js';
import { restState, withEvent } from './rest.js';
import { createAgentsFloor } from './agents-floor.js';
import { turnAt } from './workers.js';
import { sentinelAt, withWatch } from './sentinel-watch.js';

const DARK = { gold: 0, red: 0 };
const OVER_PIECE = 1.6;

/** A label over a point of the scene, placed in screen space. */
function tagAt(text, position, camera, className = 'stage-count') {
  const at = position.clone().setY(position.y + OVER_PIECE).project(camera);
  const tag = Object.assign(document.createElement('span'), { textContent: text, className });
  tag.style.left = `${((at.x + 1) / 2) * innerWidth}px`;
  tag.style.top = `${((1 - at.y) / 2) * innerHeight}px`;
  return tag;
}

export function createLive({ scene, pieces, camera, stand, hall, refit }, { state: initial, tell, counts }) {
  let state = initial;
  let turn = null; // KJC-TSK-1428: the atril skills an agent just started with
  let watch = {}; // KJC-TSK-1436: the lane the Sentinel looks at and the denial it answers
  const director = createDirector();
  const working = (initial.lanes ?? []).map((l) => ({ lane: l.lane, working: l.working }));
  const floor = createAgentsFloor({ scene, camera, xOf: hall.xOf }, working, performance.now());
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
      // A lane seen for the first time gets its workshop (KJC-TSK-1433).
      if (event.lane && hall.ensure(event.lane)) refit();
      // An agent at work flashes no piece (KJC-TSK-1430): its robot walks in or out instead.
      if (cueFor(event)) director.push(event, now);
      floor.push(event, now);
      if (event.type === 'agent-activity' && event.phase === 'start' && event.skills?.length) turn = { at: now, skills: event.skills };
      watch = withWatch(watch, event, now);
      tell(settle().lines);
    },
    /** Flashes the pieces that handled a real event just now. */
    frame(now) {
      const { lights } = settle();
      const tags = [];
      // KJC-TSK-1436: the Sentinel watches the lane it checks, and goes down to the agent it stops.
      const sentinel = sentinelAt(watch, now, hall.xOf);
      pieces.sentinel.group.position.set(sentinel.x, sentinel.y, sentinel.z);
      pieces.sentinel.group.rotation.y = sentinel.yaw;
      for (const cue of director.active(now)) {
        const flash = cueLevel(cue, now);
        const piece = pieces[cue.piece];
        const base = lights[cue.piece] ?? DARK;
        if (cue.tone === 'refuse') piece.setLight(base.gold, Math.max(base.red, flash));
        else piece.setLight(Math.max(base.gold, flash), base.red);
        if (cue.count > 1) tags.push(tagAt(`×${cue.count}`, piece.group.position, camera));
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

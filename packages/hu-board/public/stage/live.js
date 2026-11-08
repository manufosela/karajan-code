// KJC-TSK-1399, 1433 (ADR 0048): the factory live. Each real event moves the
// last state of its piece and, through the director (bursts folded), flashes
// the piece that handles it, marked with the burst count. Nothing else moves
// unless an agent really starts or ends its work.
import { createDirector, cueLevel, cueFor } from './director.js';
import { restState, withEvent } from './rest.js';
import { createAgentsFloor } from './agents-floor.js';
import { turnAt } from './workers.js';
import { sentinelAt, withWatch } from './sentinel-watch.js';
import { marksAt, withMark } from './marks.js';
import { raganAt, withRag } from './ragan.js';
import { WORKSHOP } from './layout.js';
import { tagAt } from './screen.js';
import { Vector3 } from 'three';

// The marks stack over the workshop so two of one lane never sit on each other (tagAt adds OVER_PIECE).
// Over the robots' own labels, which sit just above their helmets.
// The gates' one sits just over their bar (0.9 m), which tagAt's lift would otherwise overshoot.
const MARK_Y = { review: 1.4, gates: -0.5, ledger: 1.9 };
const GATES_DX = WORKSHOP.width / 2 - 0.9; // as hall.js places them

const DARK = { gold: 0, red: 0 };
const OVER_PIECE = 1.6;

/** A label over a point of the factory (KJC-TSK-1447: from wherever the factory is mounted). */
const overPiece = (text, position, camera, origin, className) =>
  tagAt(text, position.clone().setY(position.y + OVER_PIECE), camera, { className, origin });

export function createLive({ scene, pieces, crew, camera, stand, hall, wall, refit, origin }, { state: initial, tell, counts }) {
  let state = initial;
  let turn = null; // KJC-TSK-1428: the atril skills an agent just started with
  let watch = {}; // KJC-TSK-1436: the lane the Sentinel looks at and the denial it answers
  let marks = []; // KJC-TSK-1437: what the roles just did, by lane
  let rag = null; // KJC-TSK-1438: the answer kaRAGan is taking, and where
  let gatesLit = new Set();
  const director = createDirector();
  const working = (initial.lanes ?? []).map((l) => ({ lane: l.lane, working: l.working }));
  const floor = createAgentsFloor({ scene, camera, xOf: hall.xOf, origin }, working, performance.now());
  /** Every station back to its last real state; returns that state. */
  const settle = () => {
    const rest = restState(state, Date.now());
    for (const [id, piece] of Object.entries(pieces)) piece.setLight((rest.lights[id] ?? DARK).gold, (rest.lights[id] ?? DARK).red);
    wall.show(state.cards); // KJC-TSK-1459: repainted only when a card moved
    return rest;
  };
  /**
   * KJC-TSK-1437: verdicts, commits and seals show on the workshop of their lane,
   * and a commit lights that workshop's gates. Returns the marks' labels.
   */
  const showMarks = (now) => {
    for (const lane of gatesLit) hall.lightGates(lane, 'approve', 0);
    gatesLit = new Set();
    return marksAt(marks, now).map((mark) => {
      // The gates' mark sits over the gates themselves, at the back corner of the workshop.
      const atGates = mark.kind === 'gates';
      if (atGates) { hall.lightGates(mark.lane, mark.tone, mark.level); gatesLit.add(mark.lane); }
      const over = new Vector3(hall.xOf(mark.lane) + (atGates ? GATES_DX : 0), MARK_Y[mark.kind], WORKSHOP.z - (atGates ? WORKSHOP.depth / 2 : 0));
      const tag = overPiece(mark.text, over, camera, origin, `stage-mark stage-mark-${mark.tone}`);
      tag.style.opacity = String(mark.level); // it fades as it ages
      return tag;
    });
  };
  /** KJC-TSK-1438: kaRAGan takes the RAG's answer to the lane that asked, and comes back. */
  const moveRagan = (now) => {
    const pose = raganAt(rag, now, hall.xOf);
    crew.rag.root.position.set(pose.x, 0, pose.z);
    crew.rag.root.rotation.y = pose.yaw;
    crew.rag.hover.position.y = 0.1 + (pose.walking ? 0.06 * Math.abs(Math.sin(now / 110)) : 0);
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
      marks = withMark(marks, event, now);
      rag = withRag(rag, event, now);
      tell(settle().lines);
    },
    /** Flashes the pieces that handled a real event just now. */
    frame(now) {
      const { lights } = settle();
      const tags = [];
      // KJC-TSK-1436: the Sentinel watches the lane it checks, and goes down to the agent it stops.
      moveRagan(now);
      const sentinel = sentinelAt(watch, now, hall.xOf);
      pieces.sentinel.group.position.set(sentinel.x, sentinel.y, sentinel.z);
      pieces.sentinel.group.rotation.y = sentinel.yaw;
      tags.push(...showMarks(now));
      for (const cue of director.active(now)) {
        const flash = cueLevel(cue, now);
        const piece = pieces[cue.piece];
        const base = lights[cue.piece] ?? DARK;
        if (cue.tone === 'refuse') piece.setLight(base.gold, Math.max(base.red, flash));
        else piece.setLight(Math.max(base.gold, flash), base.red);
        if (cue.count > 1) tags.push(overPiece(`×${cue.count}`, piece.group.position, camera, origin));
      }
      // atril turns a page per skill; its sheets are the film's, so the skill's real name rides above it.
      const page = turnAt(turn, now);
      if (page) {
        stand.turnTo(page.page, page.fraction);
        tags.push(overPiece(page.skill, stand.group.position.clone().setY(2.3), camera, origin, 'stage-worker'));
      } else if (turn) {
        stand.turnTo(0, 1);
        turn = null;
      }
      counts.replaceChildren(...tags, ...floor.frame(now));
    },
  };
}

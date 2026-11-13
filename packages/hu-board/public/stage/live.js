// KJC-TSK-1399, 1433 (ADR 0048): the factory live. Each real event moves the
// last state of its piece and, through the director (bursts folded), flashes
// the piece that handles it, marked with the burst count. Nothing else moves
// unless an agent really starts or ends its work.
import { createDirector, cueLevel, cueFor } from './director.js';
import { restState, withEvent } from './rest.js';
import { createAgentsFloor, typeOn } from './agents-floor.js';
import { RAGAN_ACCENT } from './crew.js';
import { createCouriers } from './couriers.js';
import { createBenchNotes } from './bench-notes.js';
import { atHome, freshCards } from './cards.js';
import { closedCards, deskSigns } from './desk-signs.js';
import { turnAt, turnFrom } from './workers.js';
import { blinkAt, sentinelAt, withWatch } from './sentinel-watch.js';
import { marksAt, withMark } from './marks.js';
import { raganAt, withIndex, withRag } from './ragan.js';
import { conductorAt, withBeat } from './conductor.js';
import { PIECE_WALK_MS, VISIT_SPOTS, gestureAt, pieceAt, withVisit } from './piece-visit.js';
import { reviewsAt, withReviews } from './review-crew.js';
import { POST, WORKSHOP, postX } from './layout.js';
import { tagAt } from './screen.js';
import { newRelease, readyToRelease, versionLine } from './release.js';
import { counterRelease, droneAt, releaseFlight, tableCards, watcherAt } from './drone.js';
import { createDrone } from './drone-mesh.js';
import { laneStatuses, statusLine } from './lane-status.js';
import { mailboxOf, mailTotal, withMail } from './mail.js';
import { goneLanes, staleEnds } from './resync.js';
import { Vector3 } from 'three';

// The marks stack over the workshop so two of one lane never sit on each other (tagAt adds OVER_PIECE).
// Over the robots' own labels, which sit just above their helmets.
// The gates' one sits just over their bar (0.9 m), which tagAt's lift would otherwise overshoot.
// KJC-TSK-1582: the other marks of a lane stack on screen, a row each, so they never overlap
// whatever the camera's distance.
const MARK_Y = { gates: -0.5 };
const MARK_BASE_Y = 1.4;
const MARK_ROW_PX = 22;
// KJC-TSK-1588: a desk's sign, just over the card on it and under the workshop's marks.
const DESK_SIGN_Y = -0.4;
const GATES_DX = WORKSHOP.width / 2 - 0.9; // as hall.js places them

const DARK = { gold: 0, red: 0 };
const OVER_PIECE = 1.6;

/** A label over a point of the factory (KJC-TSK-1447: from wherever the factory is mounted). */
const overPiece = (text, position, camera, origin, className) =>
  tagAt(text, position.clone().setY(position.y + OVER_PIECE), camera, { className, origin });

export function createLive({ scene, pieces, crew, camera, stand, hall, wall, releaseTable, versionBoard, refit, origin }, { state: initial, tell, counts, avatar = null }) {
  let state = initial;
  let turn = null; // KJC-TSK-1428: the atril skills an agent just started with
  let watch = {}; // KJC-TSK-1436: the lane the Sentinel looks at and the denial it answers
  let marks = []; // KJC-TSK-1437: what the roles just did, by lane
  let rag = null; // KJC-TSK-1438: the answer kaRAGan is taking, and where
  let index = null; // KJC-TSK-1522: the reindex kaRAGan types at
  let beat = null; // KJC-TSK-1490: the act of the method Karajan answers
  let visits = {}; // KJC-TSK-1517: the pieces out at a workshop, by piece
  let reviews = {}; // KJC-TSK-1595: the AI review pieces out, by lane
  let gatesLit = new Set();
  let box = mailboxOf(initial.lanes ?? []); // KJC-TSK-1540: pending handoffs by lane
  /** KJC-TSK-1540: dims each lane that is not working and says why on its nameplate. */
  let statuses = new Map(); // KJC-TSK-1588: each lane's status, for the signs over the desks
  const showStatuses = () => {
    // KJC-BUG-0581: with the robots the floor has at work, so a sign never denies one that types.
    statuses = laneStatuses(hall.names(), state, box, floor.working());
    for (const [lane, status] of statuses) hall.showStatus(lane, statusLine(status), status.state);
  };
  /** KJC-TSK-1588: over each desk whose card waits with no agent, what it waits for. */
  const showSigns = () => deskSigns(statuses, atHome(state.cards ?? [], hall.names())).map(({ lane, text, tone }) =>
    overPiece(text, new Vector3(hall.xOf(lane), DESK_SIGN_Y, hall.zOf(lane) + 0.4), camera, origin, `stage-desk stage-desk-${tone}`));
  const director = createDirector();
  const working = (initial.lanes ?? []).map((l) => ({ lane: l.lane, working: l.working }));
  // KJC-TSK-1569 (ADR 0056): the own robots wear this person's avatar.
  const floor = createAgentsFloor({ scene, camera, xOf: hall.xOf, zOf: hall.zOf, origin, avatar }, working, performance.now());
  const couriers = createCouriers(scene); // KJC-TSK-1461: the robots that carry the cards
  const benchNotes = createBenchNotes(scene); // KJC-TSK-1462: and the cards over the benches
  let flight = null; // KJC-TSK-1547: the release the drone is taking away, if one is
  const drone = createDrone(scene);
  /** Every station back to its last real state; returns that state. */
  const settle = () => {
    const rest = restState(state, Date.now());
    for (const [id, piece] of Object.entries(pieces)) piece.setLight((rest.lights[id] ?? DARK).gold, (rest.lights[id] ?? DARK).red);
    wall.show(state.cards); // KJC-TSK-1459: repainted only when a card moved
    // KJC-TSK-1526: the cards done since the last release, piled on their table; KJC-TSK-1547:
    // the old pile stays until the drone takes it, and the counter until kaWATCHan switches it.
    const now = performance.now();
    const onTable = tableCards(flight, now, readyToRelease(state.cards ?? [], state.release));
    releaseTable.show(onTable, onTable === flight?.cards ? flight.before : state.release);
    versionBoard?.show(versionLine(counterRelease(flight, now, state.release))); // KJC-TSK-1545
    return rest;
  };
  /** KJC-TSK-1547: the drone flies the old pile away and kaWATCHan walks to the counter and back. */
  const flyRelease = (now) => {
    drone.show(droneAt(flight, now), now);
    const pose = watcherAt(flight, now);
    crew.watch.root.position.set(pose.x, 0, pose.z);
    crew.watch.root.rotation.y = pose.yaw;
    crew.watch.hover.position.y = 0.1 + (pose.walking ? 0.06 * Math.abs(Math.sin(now / 110)) : 0);
  };
  /**
   * KJC-TSK-1437: verdicts, commits and seals show on the workshop of their lane,
   * and a commit lights that workshop's gates. Returns the marks' labels.
   */
  const showMarks = (now) => {
    for (const lane of gatesLit) hall.lightGates(lane, 'approve', 0);
    gatesLit = new Set();
    const rows = new Map(); // lane -> marks already stacked over its workshop
    return marksAt(marks, now).map((mark) => {
      // The gates' mark sits over the gates themselves, at the back corner of the workshop.
      const atGates = mark.kind === 'gates';
      if (atGates) { hall.lightGates(mark.lane, mark.tone, mark.level); gatesLit.add(mark.lane); }
      const over = new Vector3(hall.xOf(mark.lane) + (atGates ? GATES_DX : 0), MARK_Y[mark.kind] ?? MARK_BASE_Y, hall.zOf(mark.lane) - (atGates ? WORKSHOP.depth / 2 : 0));
      const tag = overPiece(mark.text, over, camera, origin, `stage-mark stage-mark-${mark.tone}`);
      const row = atGates ? 0 : rows.get(mark.lane) ?? 0;
      if (!atGates) rows.set(mark.lane, row + 1);
      tag.style.marginTop = `${-row * MARK_ROW_PX}px`;
      tag.style.opacity = String(mark.level); // it fades as it ages
      return tag;
    });
  };
  /** KJC-TSK-1438: kaRAGan takes the RAG's answer to the lane that asked, and comes back. */
  const moveRagan = (now) => {
    const pose = raganAt(rag, now, hall.xOf, hall.zOf, index);
    crew.rag.root.position.set(pose.x, 0, pose.z);
    crew.rag.root.rotation.y = pose.yaw;
    // KJC-TSK-1522: at a reindexing lane it types on its laptop, in its amber.
    typeOn(crew.rag, { typing: Boolean(pose.typing), elapsed: now - (pose.since ?? now), yaw: pose.yaw, accent: RAGAN_ACCENT });
    crew.rag.hover.position.y = 0.1 + (pose.walking ? 0.06 * Math.abs(Math.sin(now / 110)) : 0);
  };
  /** KJC-TSK-1490: Karajan turns to the lane the method just acted on and conducts it, or stops it. */
  const conduct = (now) => {
    const pose = conductorAt(beat, now, hall.xOf, hall.zOf);
    crew.conductor.root.rotation.y = pose.yaw;
    crew.conductor.pose('L', ...pose.L);
    crew.conductor.pose('R', ...pose.R);
  };
  /**
   * Sets a piece's `group` at its pose at `now`; returns the name tag of the agent it works for.
   * KJC-TSK-1583: at the workshop it leans over the box, then hops (approve) or shakes its head (refuse).
   */
  const place = (group, pose, act, by, now) => {
    const hop = act?.kind === 'approve' ? 0.25 * Math.sin(Math.PI * act.k) : 0;
    group.position.set(pose.x, (pose.walking ? 0.08 * Math.abs(Math.sin(now / 110)) : 0) + hop, pose.z);
    group.rotation.y = pose.yaw + (act?.kind === 'refuse' ? 0.5 * Math.sin(6 * Math.PI * act.k) * (1 - act.k) : 0);
    group.rotation.x = act?.kind === 'inspect' ? 0.18 + 0.06 * Math.sin(2 * Math.PI * act.k) : 0;
    return pose.away && by ? [overPiece(by, group.position, camera, origin, 'stage-worker')] : [];
  };
  /** KJC-TSK-1517, 1524: each piece of the method glides to the workshop it acts on, and back. */
  // KJC-TSK-1595: AI review goes out as one copy per review (moveReviews).
  const movePieces = (now) => Object.keys(VISIT_SPOTS).filter((id) => id !== 'review').flatMap((id) => {
    const pose = pieceAt(visits[id], now, { x: postX(id), z: POST.z }, hall.xOf, hall.zOf);
    return place(pieces[id].group, pose, gestureAt(visits[id], now), visits[id]?.by, now);
  });
  /**
   * KJC-TSK-1595 (the maintainer, 2026-11-13): one AI review piece of colour per review under way,
   * at its agent's side; meanwhile the post keeps a see-through ghost of the piece in its place.
   * The copies share the piece's materials, so its lights reach them; the ghost has its own.
   */
  const copies = new Map();
  let ghost = null;
  const seeThrough = (material) => Object.assign(material.clone(), { transparent: true, opacity: 0.25, depthWrite: false });
  const ghostOf = (group) => {
    const copy = group.clone();
    copy.traverse((o) => { if (o.material) o.material = Array.isArray(o.material) ? o.material.map(seeThrough) : seeThrough(o.material); });
    scene.add(copy);
    return copy;
  };
  const moveReviews = (now) => {
    const real = pieces.review.group;
    const { pieces: out, ghost: away } = reviewsAt(reviews, now, { x: postX('review'), z: POST.z }, hall.xOf, hall.zOf);
    if (away && !ghost) ghost = ghostOf(real);
    if (ghost) ghost.visible = away;
    real.visible = !away;
    const lanes = new Set(out.map((p) => p.lane));
    for (const [lane, copy] of copies) if (!lanes.has(lane)) { scene.remove(copy); copies.delete(lane); }
    return out.flatMap(({ lane, by, pose, act }) => {
      if (!copies.has(lane)) {
        const copy = real.clone();
        copy.visible = true;
        scene.add(copy);
        copies.set(lane, copy);
      }
      return place(copies.get(lane), pose, act, by, now);
    });
  };
  // KJC-TSK-1528: a review already going on when the stage opens has the AI review piece at it.
  for (const { lane, working: at } of working) {
    for (const w of at ?? []) reviews = withReviews(reviews, { type: 'agent-activity', role: w.role, agent: w.agent, phase: 'start', lane }, performance.now() - PIECE_WALK_MS);
  }
  showStatuses();
  const api = {
    settle,
    /** KJC-BUG-0578: how many handoffs wait for the human in this factory. */
    pending: () => mailTotal(box),
    /** KJC-TSK-1570: the own robots, built again in a newly saved avatar. */
    setAvatar: (next) => floor.setAvatar(next),
    /** KJC-TSK-1600: the pointer on screen (css px), whose robot shows its full label; null once it leaves. */
    point: (at) => floor.point(at),
    /**
     * KJC-BUG-0557: checks the scene against the board's state now (`server`, as acrossLanes
     * gives it). A lane the board no longer lists goes, once no robot works in it (so the
     * robots that leave walk out of their own workshop first); then everyone the board no
     * longer sees at work walks out, as if their end had come.
     */
    resync(server, now) {
      const gone = goneLanes(hall.names(), server.lanes ?? [], state.working ?? []);
      if (gone.map((lane) => hall.remove(lane)).some(Boolean)) refit();
      for (const end of staleEnds(state.working ?? [], server.working ?? [], new Date().toISOString())) api.push(end, now);
      // The branch facts and notes the statuses read, as the board sees them now; and
      // KJC-TSK-1545: a new release takes the pile off the table and changes the counter.
      const released = newRelease(state.release, server.release);
      // KJC-TSK-1547: only a release seen while the stage is open has a pile to fly away.
      if (released && state.release) flight = releaseFlight(state.release, server.release, readyToRelease(state.cards ?? [], state.release), now);
      // KJC-TSK-1587: a card the board closed (its merge leaves no line) leaves its desk.
      const held = state.cards ?? [];
      const cards = freshCards(held, server.cards ?? []);
      // KJC-TSK-1588: and a robot takes it from its desk to the wall's Done column.
      const at = new Date().toISOString();
      for (const closed of closedCards(atHome(held, hall.names()), atHome(cards, hall.names()))) couriers.push({ ...closed, at }, now);
      state = { ...state, cards, lanes: server.lanes ?? state.lanes, ...(released ? { release: server.release } : {}) };
      if (released || cards !== held) tell(settle().ordered);
      showStatuses();
    },
    /** KJC-TSK-1460: the factory's cards as they are now (the map counts the ones in progress). */
    cards: () => state.cards ?? [],
    /** Takes one stream event at `now` (performance clock, ms). */
    push(event, now) {
      const mail = withMail(box, event);
      if (mail !== box) { box = mail; showStatuses(); }
      const next = withEvent(state, event);
      if (next === state) return; // not a stage event
      state = next;
      // A lane seen for the first time gets its workshop (KJC-TSK-1433).
      if (event.lane && hall.ensure(event.lane)) refit();
      // An agent at work flashes no piece (KJC-TSK-1430): its robot walks in or out instead.
      if (cueFor(event)) director.push(event, now);
      floor.push(event, now);
      showStatuses(); // KJC-BUG-0581: once the floor has its robots where this event puts them
      couriers.push(event, now);
      // KJC-TSK-1596: once the agent stands before atril.
      if (event.type === 'agent-activity' && event.phase === 'start' && event.skills?.length) turn = { at: turnFrom(event, now), skills: event.skills };
      watch = withWatch(watch, event, now);
      marks = withMark(marks, event, now);
      rag = withRag(rag, event, now);
      index = withIndex(index, event, now);
      beat = withBeat(beat, event, now);
      visits = withVisit(visits, event, now);
      reviews = withReviews(reviews, event, now); // KJC-TSK-1595
      tell(settle().ordered); // KJC-TSK-1608: top down, the newest first
    },
    /** Flashes the pieces that handled a real event just now. */
    frame(now) {
      const { lights } = settle();
      const tags = [];
      // KJC-TSK-1436: the Sentinel watches the lane it checks, and goes down to the agent it stops.
      moveRagan(now);
      flyRelease(now);
      conduct(now);
      tags.push(...movePieces(now), ...moveReviews(now));
      couriers.frame(now, hall.xOf, hall.zOf);
      benchNotes.frame(atHome(state.cards ?? [], hall.names()), hall.xOf, couriers.carried(), hall.zOf);
      tags.push(...showSigns());
      const sentinel = sentinelAt(watch, now, hall.xOf, hall.zOf);
      pieces.sentinel.group.position.set(sentinel.x, sentinel.y, sentinel.z);
      pieces.sentinel.group.rotation.y = sentinel.yaw;
      // KJC-TSK-1584: it blinks its own light each time it lets a host's call through.
      const watchLight = lights.sentinel ?? DARK;
      pieces.sentinel.setLight(Math.max(watchLight.gold, blinkAt(watch, now)), watchLight.red);
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
  return api;
}

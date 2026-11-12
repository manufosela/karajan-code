/**
 * KJC-TSK-1552 (ADR 0054, slice 4a; decided by the maintainer on 2026-11-12): while an agent works
 * on a HU in progress, the board posts a status on the HU's issue through kj link (its privacy
 * scan and rules apply), at most once an hour, and a stopped status once when the lane stops.
 * Only HUs of the shared board (HU-<issue>) are posted. What went out is kept in the main
 * checkout's .karajan/link-status.json. Set KJ_LINK_STATUS=off to post nothing.
 */
import { execFile } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

import { mergeCards } from '../public/stage/cards.js';
import { KJ_CLI } from './command-runner.js';
import { sweepTargets } from './lane-sweeper.js';
import { laneStates } from './stage-state.js';
import { teamCards } from './stage-team.js';
import { WORKING_TEXT, readTeamStatus } from './team-status.js';

/** KJC-TSK-1553: reads the teammates' status of the project at `dir`, for their workshops on the map. */
const readTeam = (dir) => {
  const ownIds = laneStates(dir).flatMap((l) => (l.cards ?? []).map((c) => c.id));
  return readTeamStatus(dir, teamCards(dir, ownIds));
};

export const STATUS_EVERY_MS = 60 * 60 * 1000;
const BEAT_EVERY_MS = 5 * 60 * 1000;
const FORGET_STOPPED_MS = 24 * 60 * 60 * 1000;
const SEND_TIMEOUT_MS = 60 * 1000;
const RECORD = ['.karajan', 'link-status.json'];
const SHARED_HU = /^HU-(\d+)$/;

/** The HUs in progress of the lanes with an agent at work. */
function workedOn(lanes, cards) {
  const busy = new Set(lanes.filter((l) => l.working?.length).map((l) => l.lane));
  return cards.filter((c) => c.status === 'running' && busy.has(c.lane) && SHARED_HU.test(c.id));
}

/**
 * What to post now: `working` on each HU worked on that was not said so in the last hour, and
 * `stopped` once on each HU said to be worked on that no longer is. `last` is what went out.
 */
export function statusPosts(lanes, cards, last, now) {
  const post = (id, state) => ({ id, issue: Number(SHARED_HU.exec(id)[1]), state });
  const working = workedOn(lanes, cards).map((c) => c.id);
  const due = working.filter((id) => last[id]?.state !== 'working' || now - last[id].at >= STATUS_EVERY_MS);
  const stopped = Object.entries(last).filter(([id, s]) => s.state === 'working' && !working.includes(id)).map(([id]) => id);
  const posts = [...due.map((id) => post(id, 'working')), ...stopped.filter((id) => SHARED_HU.test(id)).map((id) => post(id, 'stopped'))];
  const next = { ...last };
  for (const p of posts) next[p.id] = { state: p.state, at: now };
  return { posts, next };
}

const readRecord = (dir) => { try { return JSON.parse(readFileSync(join(dir, ...RECORD), 'utf8')) ?? {}; } catch { return {}; } };

/** The one-line conclusion each status carries: the HU and whether an agent works on it. */
const textOf = ({ id, state }) => (state === 'working' ? `${id}: ${WORKING_TEXT}` : `${id}: no agent is working on it now`);

const sendStatus = (cwd, p) => promisify(execFile)(process.execPath,
  [KJ_CLI, 'link', 'send', `issue:${p.issue}`, '--type', 'status', '--to', 'all', '--context', p.id, '--text', textOf(p)],
  { cwd, timeout: SEND_TIMEOUT_MS });

/** Posts what is due for the project at `dir`; a post that fails is logged and tried again later. */
export async function beatStatus(dir, { lanesOf = laneStates, send = sendStatus, now = Date.now, log = console } = {}) {
  const lanes = lanesOf(dir);
  const cards = mergeCards(lanes.map((l) => l.cards ?? []));
  const last = readRecord(dir);
  const at = now();
  const { posts } = statusPosts(lanes, cards, last, at);
  const record = Object.fromEntries(Object.entries(last).filter(([, s]) => s.state === 'working' || at - s.at < FORGET_STOPPED_MS));
  for (const p of posts) {
    try {
      await send(dir, p);
      record[p.id] = { state: p.state, at };
    } catch (err) {
      log.warn(`[link-status] ${dir}: ${p.id}: ${err.message}`);
    }
  }
  if (!posts.length) return;
  mkdirSync(dirname(join(dir, ...RECORD)), { recursive: true });
  writeFileSync(join(dir, ...RECORD), `${JSON.stringify(record)}\n`);
}

/** Beats every project now and every 5 minutes, unless KJ_LINK_STATUS=off. Returns the stop. */
export function startStatusBeat({ targets = sweepTargets, beat = beatStatus, team = readTeam, everyMs = BEAT_EVERY_MS, log = console, env = process.env } = {}) {
  if (env.KJ_LINK_STATUS === 'off') return () => {};
  let running = null;
  const tick = () => {
    // KJC-TSK-1553: and then what the teammates said about theirs.
    running ??= (async () => { for (const dir of targets()) { await beat(dir); await team(dir); } })()
      .catch((err) => log.warn(`[link-status] skipped: ${err.message}`)).finally(() => { running = null; });
  };
  tick();
  const timer = setInterval(tick, everyMs);
  timer.unref?.();
  return () => clearInterval(timer);
}

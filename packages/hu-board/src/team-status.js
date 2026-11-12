/**
 * KJC-TSK-1553 (ADR 0054, slice 4b): what the teammates' agents are doing now, from the status
 * each one's board posts on the issue of the HU it works on (link-status.js). The thread of each
 * teammate card is read through kj link inbox, which keeps only authors with write permission;
 * the holder's newest status about the card is kept in the main checkout's
 * .karajan/team-status.json, and a card is working while that says so and is under 70 min old.
 */
import { execFile } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

import { KJ_CLI } from './command-runner.js';

/** What a working status says after its HU (link-status.js posts it), which the boards look for. */
export const WORKING_TEXT = 'an agent is working on it';
/** An hour between posts, and some slack for a beat that came late. */
export const FRESH_MS = 70 * 60 * 1000;
const RECORD = ['.karajan', 'team-status.json'];
const READ_TIMEOUT_MS = 60 * 1000;
const SHARED_HU = /^HU-(\d+)$/;

/** The newest status `person` posted about card `id`, as `{ state, at }`, or null. */
export function newestStatus(messages, id, person) {
  const theirs = messages.filter((m) => m?.kind === 'message' && m.type === 'status' && m.context === id && m.author === person
    && typeof m.conclusion === 'string' && !Number.isNaN(Date.parse(m.updatedAt)));
  const newest = theirs.toSorted((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0];
  return newest ? { state: newest.conclusion.includes(WORKING_TEXT) ? 'working' : 'stopped', at: newest.updatedAt } : null;
}

/** The cards of `person`, each with `working` when its newest status says so and is fresh at `now`. */
export const withStatus = (cards, record, person, now) => cards.map((c) => {
  const s = record[c.id];
  return { ...c, working: s?.by === person && s.state === 'working' && now - Date.parse(s.at) < FRESH_MS };
});

export const readRecord = (dir) => { try { return JSON.parse(readFileSync(join(dir, ...RECORD), 'utf8')) ?? {}; } catch { return {}; } };

const runInbox = async (cwd, issue) => {
  const { stdout } = await promisify(execFile)(process.execPath, [KJ_CLI, 'link', 'inbox', '--thread', `issue:${issue}`, '--json'], { cwd, timeout: READ_TIMEOUT_MS });
  return JSON.parse(stdout).messages ?? [];
};

/** Reads the thread of each teammate card of the project at `dir` and keeps its holder's newest status. */
export async function readTeamStatus(dir, team, { inbox = runInbox, log = console } = {}) {
  const record = readRecord(dir);
  for (const { person, cards } of team) {
    for (const { id } of cards) {
      const issue = SHARED_HU.exec(id)?.[1];
      if (!issue) continue;
      try {
        const status = newestStatus(await inbox(dir, Number(issue)), id, person);
        if (status) record[id] = { ...status, by: person };
      } catch (err) {
        log.warn(`[team-status] ${dir}: ${id}: ${err.message}`);
      }
    }
  }
  mkdirSync(dirname(join(dir, ...RECORD)), { recursive: true });
  writeFileSync(join(dir, ...RECORD), `${JSON.stringify(record)}\n`);
}

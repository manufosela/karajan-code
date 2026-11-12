/**
 * KJC-TSK-1548 (ADR 0054, slice 1): the teammates the map draws, from the agent link only. The
 * cards and their holder come from the shared board, which kj hu keeps cached in the main
 * checkout (.karajan/board-cache*.json); never a file of another machine. Who I am is the holder
 * of the cards of my own lanes, so nothing here needs the network. Read only.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { readRecord, withStatus } from './team-status.js';

const CACHE = /^board-cache(-[\w.-]+)?\.json$/;

/** The holder most of `ownIds` are claimed by, or null when none of them is held. */
function ownLogin(hus, ownIds) {
  const mine = new Set(ownIds);
  const counts = new Map();
  for (const hu of hus) if (mine.has(hu.short_id) && hu.claimed_by) counts.set(hu.claimed_by, (counts.get(hu.claimed_by) ?? 0) + 1);
  return [...counts].toSorted((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

/** A card of the cache: an object with its id and, when held, its holder's login. */
const isCard = (hu) => typeof hu?.short_id === 'string' && (hu.claimed_by === null || hu.claimed_by === undefined || typeof hu.claimed_by === 'string');

/** Every holder but me with their cards in progress, by name; nobody when I cannot be told. */
export function teamOf(entries, ownIds) {
  const hus = entries.filter(isCard);
  const me = ownLogin(hus, ownIds);
  if (!me) return [];
  const byPerson = new Map();
  for (const hu of hus) {
    if (hu.status !== 'running' || !hu.claimed_by || hu.claimed_by === me) continue;
    byPerson.set(hu.claimed_by, [...(byPerson.get(hu.claimed_by) ?? []), { id: hu.short_id, title: hu.title ?? null }]);
  }
  return [...byPerson].toSorted(([a], [b]) => a.localeCompare(b)).map(([person, cards]) => ({ person, cards }));
}

const readJson = (file) => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; } };

/**
 * KJC-TSK-1564 (ADR 0056): one repository is one factory. Each card a teammate has in progress is
 * a lane of it, `<card>@<owner>` (a worktree slug never holds an @), lit while its status says so.
 */
export const teamLanes = (team) => team.flatMap(({ person, cards }) => cards.map((c) => ({
  lane: `${c.id}@${person}`, owner: person, title: c.title ?? c.id, remote: true, remoteWorking: Boolean(c.working), working: [],
})));

/** The lanes of the factory at `dir` and, after them, those of its teammates. */
export function withTeam(dir, lanes, team = teamCards) {
  return [...lanes, ...teamLanes(team(dir, lanes.flatMap((l) => (l.cards ?? []).map((c) => c.id))))];
}

/** The teammates of the project at `projectDir`, each with when the board cache saw them. */
export function teamCards(projectDir, ownIds, now = Date.now) {
  const root = join(projectDir, '.karajan');
  let names;
  try { names = readdirSync(root).filter((n) => CACHE.test(n)); } catch { return []; }
  return names.flatMap((name) => {
    const cache = readJson(join(root, name));
    if (!Array.isArray(cache?.hus) || Number.isNaN(Date.parse(cache.updatedAt))) return [];
    // KJC-TSK-1553: each card working while its holder's newest status says so.
    const status = readRecord(projectDir);
    return teamOf(cache.hus, ownIds).map((t) => ({ ...t, cards: withStatus(t.cards, status, t.person, now()), at: cache.updatedAt }));
  });
}

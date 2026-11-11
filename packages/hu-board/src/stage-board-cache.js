/**
 * KJC-BUG-0547: kj stage draws its cards from the lanes' card lines, and a line lost with a
 * swept lane left its card in progress. The main checkout keeps the shared board's cache
 * (.karajan/board-cache*.json, written by kj hu): a status there newer than a card's last
 * line wins when the stage opens. Read only.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const STATUSES = new Set(['pending', 'running', 'done', 'failed', 'skipped']);
const CACHE = /^board-cache(-[\w.-]+)?\.json$/;

const readJson = (file) => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; } };

/** The status of each card in the board caches of `projectDir`, with when the cache was written. */
export function boardStatuses(projectDir) {
  const root = join(projectDir, '.karajan');
  let names;
  try { names = readdirSync(root).filter((n) => CACHE.test(n)); } catch { return new Map(); }
  const statuses = new Map();
  for (const name of names) {
    const cache = readJson(join(root, name));
    if (!Array.isArray(cache?.hus) || Number.isNaN(Date.parse(cache.updatedAt))) continue;
    for (const hu of cache.hus) {
      if (typeof hu?.short_id !== 'string') continue;
      // A card in two caches keeps the newer one's status, whatever order the folder lists them in.
      const before = statuses.get(hu.short_id);
      if (!before || Date.parse(cache.updatedAt) > Date.parse(before.at)) statuses.set(hu.short_id, { status: hu.status, at: cache.updatedAt });
    }
  }
  return statuses;
}

/** The cards with the cache's status where it is newer than their last line and one kj stage knows. */
export const withBoardCache = (cards, statuses) => cards.map((card) => {
  const known = statuses.get(card.id);
  const newer = known && STATUSES.has(known.status) && Date.parse(known.at) > Date.parse(card.at);
  return newer && known.status !== card.status ? { ...card, status: known.status } : card;
});

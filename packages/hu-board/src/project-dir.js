/**
 * KJC-TSK-0885 (BRD-P2, ADR 0011): the project behind a scoped view.
 *
 * The daemon's cwd is not the project (one board serves every project), so a
 * `/p/<slug>` view sends its slug and the server resolves the directory. It
 * never takes a path from the client: it reads the `projectDir` the project's
 * own plans recorded, and accepts it only if it exists and its slug is the one
 * asked for, so a plan cannot point the board at another directory.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { getHuBoardPlansDirs } from './db.js';
import { deriveProjectIdFromDir } from './sync.js';

const SLUG_RE = /^[a-zA-Z0-9_.-]+$/;

/** @returns {string|null} the project's directory, or null when unresolvable. */
export function projectDirForSlug(slug, { plansDirs = getHuBoardPlansDirs() } = {}) {
  if (typeof slug !== 'string' || !SLUG_RE.test(slug) || slug.startsWith('.')) return null;
  for (const root of plansDirs) {
    let names;
    try { names = readdirSync(join(root, slug)); } catch { continue; }
    for (const name of names.filter((n) => n.endsWith('.json'))) {
      let dir;
      try { dir = JSON.parse(readFileSync(join(root, slug, name), 'utf8'))?.projectDir; } catch { continue; }
      if (typeof dir === 'string' && deriveProjectIdFromDir(dir) === slug && existsSync(dir)) return dir;
    }
  }
  return null;
}

/**
 * The project a request is about: none when it names none (dashboard), its
 * directory when it resolves, and an Error that says why when it does not.
 */
export function requestProjectDir(project) {
  if (project === undefined || project === null || project === '') return null;
  const dir = projectDirForSlug(project);
  if (!dir) throw new Error(`project "${project}" has no plan recording where it lives: run a kj command in it once`);
  return dir;
}

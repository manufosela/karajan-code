/**
 * KJC-TSK-1432 (ADR 0048): the lanes of a project, the main checkout and each
 * worktree, so the stage sees the work where it happens. Each lane keeps its
 * own trace under its .karajan; nothing here writes.
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Where kj (kj worktree start) and Claude Code put the worktrees of a project. */
export const LANE_HOMES = [['.kj', 'worktrees'], ['.claude', 'worktrees']];
export const MAIN_LANE = 'main';

const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };

/** The worktrees under one lane home: a folder with a `.git` entry (a FILE in a worktree), never a dot folder. */
function worktreesIn(home) {
  let names;
  try { names = readdirSync(home); } catch { return []; }
  return names
    .filter((n) => !n.startsWith('.'))
    .map((n) => ({ lane: n, dir: join(home, n) }))
    .filter(({ dir }) => isDir(dir) && existsSync(join(dir, '.git')));
}

/** The main checkout first, then every worktree by name. */
export function listLanes(projectDir) {
  const worktrees = LANE_HOMES.flatMap((home) => worktreesIn(join(projectDir, ...home)));
  return [{ lane: MAIN_LANE, dir: projectDir }, ...worktrees.toSorted((a, b) => a.lane.localeCompare(b.lane))];
}

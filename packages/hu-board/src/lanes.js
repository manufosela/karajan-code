/**
 * KJC-TSK-1432 (ADR 0048): the lanes of a project, the main checkout and each
 * worktree, so the stage sees the work where it happens. Each lane keeps its
 * own trace under its .karajan; nothing here writes.
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

/** Where kj (kj worktree start) and Claude Code put the worktrees of a project. */
export const LANE_HOMES = [['.kj', 'worktrees'], ['.claude', 'worktrees']];
export const MAIN_LANE = 'main';

const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };

/** A lane is a folder with a `.git` entry (a FILE in a worktree), never a dot folder. */
export const isLaneDir = (dir) => !basename(dir).startsWith('.') && isDir(dir) && existsSync(join(dir, '.git'));

/** The worktrees under one lane home. */
function worktreesIn(home) {
  let names;
  try { names = readdirSync(home); } catch { return []; }
  return names.map((n) => ({ lane: n, dir: join(home, n) })).filter(({ dir }) => isLaneDir(dir));
}

/** The main checkout first, then every worktree by name. */
export function listLanes(projectDir) {
  const worktrees = LANE_HOMES.flatMap((home) => worktreesIn(join(projectDir, ...home)));
  return [{ lane: MAIN_LANE, dir: projectDir }, ...worktrees.toSorted((a, b) => a.lane.localeCompare(b.lane))];
}

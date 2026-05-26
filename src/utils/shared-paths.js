/**
 * Team-shared HU Board paths — KJC-PRP-0002 / v2.31.0 PR1.
 *
 * The shared root lives INSIDE the project, not in `~/.karajan/`, so a team
 * can commit it to git (or sync via Drive/SyncThing) and share plans + HU
 * stories without each member regenerating them locally.
 *
 *   <projectDir>/.karajan-shared/
 *     plans/<planId>.json     ← `kj plan share <planId>` copies here
 *     hu-stories/<huId>.md    ← reserved for PR2+ (board reads it)
 *
 * Keep the dir name in lockstep with the HU Board sync layer
 * (`packages/hu-board/src/sync.js`) — diverging the constant breaks the
 * watcher silently. One source of truth lives here.
 */

import path from "node:path";

export const SHARED_DIR_NAME = ".karajan-shared";

export function getSharedRoot(projectDir) {
  return path.join(projectDir, SHARED_DIR_NAME);
}

export function getSharedPlansDir(projectDir) {
  return path.join(getSharedRoot(projectDir), "plans");
}

export function getSharedHuStoriesDir(projectDir) {
  return path.join(getSharedRoot(projectDir), "hu-stories");
}

/**
 * Quick check used by callers that decide whether a plan came from local
 * (`~/.karajan/plans/`) or from the shared dir. The HU Board uses this to
 * stamp a `source` column on each record so the UI can render a 🌐 badge.
 */
export function isSharedPath(p) {
  if (!p) return false;
  return p.split(path.sep).includes(SHARED_DIR_NAME);
}

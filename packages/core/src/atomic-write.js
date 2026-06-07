// Atomic JSON writes for persistent state (resilience audit, Phase 2).
//
// A plain `writeFile(path, JSON.stringify(...))` truncates the live file
// before the new content lands. If the process is killed mid-write
// (SIGKILL, crash, power loss) the file is left truncated and the only
// good copy is already gone — the plan / session / standby JSON
// silently corrupts.
//
// write-temp + rename fixes it: `rename` is atomic on the same
// filesystem, so a reader sees either the old file or the complete new
// one, never a half-written one. The temp file sits next to the target
// (same dir → same FS) and is uniquely named so concurrent writers do
// not clobber each other's temp. A crash before the rename leaves an
// orphan `.tmp` but never a corrupt target.

import { writeFileSync, renameSync } from "node:fs";
import { writeFile, rename } from "node:fs/promises";

function tempPath(target) {
  return `${target}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
}

/**
 * Atomically write `obj` as pretty JSON to `target` (synchronous).
 * @param {string} target - destination path; its directory must exist
 * @param {unknown} obj
 */
export function writeJsonAtomicSync(target, obj) {
  const tmp = tempPath(target);
  writeFileSync(tmp, JSON.stringify(obj, null, 2), "utf-8");
  renameSync(tmp, target);
}

/**
 * Atomically write `obj` as pretty JSON to `target` (async).
 * @param {string} target - destination path; its directory must exist
 * @param {unknown} obj
 */
export async function writeJsonAtomic(target, obj) {
  const tmp = tempPath(target);
  await writeFile(tmp, JSON.stringify(obj, null, 2), "utf-8");
  await rename(tmp, target);
}

/**
 * KJC-BUG-0032: detect coder writes outside projectDir.
 *
 * The coder subprocess runs with `cwd: projectDir`, but its Bash
 * tool can `cd` anywhere. Real-world repro: a HU titled
 *   "Initialize project skeleton: create assistant/ directory…"
 * had Claude run `cd /home/manu/assistant && pnpm init …`. The
 * resulting 36 MB of code lived in $HOME/assistant — outside the
 * projectDir, outside any git repo, lost to tracking, commits and
 * review. The coder was happy, the user only noticed by accident.
 *
 * This module is a deterministic guard: snapshot $HOME's top-level
 * directory entries before the coder runs, scan again after, and
 * any new entry that isn't projectDir itself is a leak.
 *
 * Why top-level only:
 *   - Catches the realistic failure mode (coder creates a sibling
 *     `~/something` for the project skeleton).
 *   - Cheap (single readdirSync) — no `find -newer` traversal of
 *     $HOME's potentially massive tree.
 *   - Doesn't thrash on writes to existing dirs like ~/.npm or
 *     ~/.cache that legitimate node tooling touches.
 *
 * What it WON'T catch (acknowledged trade-offs):
 *   - Writes deep inside existing $HOME subdirs (e.g. modifying
 *     ~/.bashrc — would need a per-file mtime scan).
 *   - Writes to /tmp (high false-positive rate; /tmp is ephemeral
 *     by spec; less risky).
 *   - Writes to /etc, /var, etc. (would require root anyway).
 *
 * The first-pass guard is the right ROI. Subsequent iterations
 * can extend coverage if real-world cases warrant it.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Snapshot the immediate children of $HOME. Returns a Set of names
 * (not full paths) so detectNewHomeEntries can do a quick set
 * difference. Empty set on any FS error — treats "can't snapshot"
 * the same as "snapshot OK with nothing".
 *
 * @returns {Set<string>}
 */
export function snapshotHomeTopLevel() {
  try {
    return new Set(fs.readdirSync(os.homedir()));
  } catch {
    return new Set();
  }
}

/**
 * Detect $HOME top-level entries that didn't exist when `before`
 * was snapshotted. Excludes projectDir itself in case the user
 * keeps their projects directly under $HOME (no false positive
 * if `projectDir = $HOME/some-project` already existed).
 *
 * @param {Set<string>} before — snapshot from snapshotHomeTopLevel()
 * @param {string|null} projectDir — current run's projectDir
 * @returns {string[]} absolute paths of new entries (potential leaks)
 */
export function detectNewHomeEntries(before, projectDir) {
  const home = os.homedir();
  let after;
  try {
    after = fs.readdirSync(home);
  } catch {
    return [];
  }
  const projectDirAbs = projectDir ? path.resolve(projectDir) : null;
  const leaks = [];
  for (const name of after) {
    if (before.has(name)) continue;
    const full = path.join(home, name);
    // Skip projectDir itself (defensive — shouldn't happen since
    // projectDir is pre-existing, but a paranoid check costs nothing).
    if (projectDirAbs && path.resolve(full) === projectDirAbs) continue;
    leaks.push(full);
  }
  return leaks;
}

/**
 * Issue #546: filter potential leaks by attribution. Snapshot diff
 * cannot tell coder writes from concurrent writes by other processes
 * (host AI scratch files, parallel tooling, manual edits). Real-world
 * 2026-04-29 incident: a host-side write of `~/karajan-status-snapshot.md`
 * during a kj run aborted HU 003 with a false positive.
 *
 * Heuristic: if the coder genuinely created the leaked path, its
 * transcript will mention the path or its basename — the coder
 * narrates what it does (Bash commands, file operations, todos). If
 * neither the absolute path nor the basename appears anywhere in
 * the transcript, the entry was created by some other process during
 * the iteration window and should NOT abort the HU.
 *
 * False-negative trade-off: a coder that creates a file silently
 * (e.g. via a script that doesn't echo paths) escapes this filter.
 * That trade-off is acceptable: the original leak class (coder
 * skeleton-creating in $HOME) always emits the path in commands; the
 * silent-write case has never been observed.
 *
 * Back-compat: when `transcript` is empty/null/undefined, NO filtering
 * happens — every detected leak is passed through unchanged. This
 * preserves the strict behaviour for callers that don't have a
 * transcript handy.
 *
 * @param {string[]} leaks — output of detectNewHomeEntries()
 * @param {string|null|undefined} transcript — coder's full output text
 * @returns {string[]} filtered leaks (the subset attributable to coder)
 */
export function verifyLeaksAgainstTranscript(leaks, transcript) {
  if (!Array.isArray(leaks) || leaks.length === 0) return [];
  if (!transcript || typeof transcript !== "string" || transcript.length === 0) {
    return leaks; // no transcript ⇒ no filtering, original behaviour
  }
  return leaks.filter((p) => {
    const base = path.basename(p);
    // Skip artefacts whose basename is too short to be discriminating
    // (e.g. ".cache") — a 3-char basename matched against a long
    // transcript is meaningless. For such cases we prefer the strict
    // behaviour (flag) since they're rare and the user can inspect.
    if (base.length < 4) return true;
    return transcript.includes(p) || transcript.includes(base);
  });
}

/**
 * Format a leak list into a multiline plain-Spanish error message.
 * Includes a hint about how to recover (move-or-delete) so the user
 * isn't left guessing.
 *
 * @param {string[]} leaks — output of detectNewHomeEntries()
 * @param {string} projectDir
 * @returns {string}
 */
export function formatLeakMessage(leaks, projectDir) {
  const list = leaks.map((p) => `  - ${p}`).join("\n");
  return [
    `El coder creó archivos FUERA del proyecto (${projectDir}).`,
    "",
    "Rutas detectadas:",
    list,
    "",
    "Esto suele pasar cuando una HU usa una ruta absoluta o relativa a $HOME y el coder la sigue literalmente. Las rutas SIEMPRE deben ser relativas a la raíz del proyecto.",
    "",
    "Qué hacer:",
    "  1. Inspecciona las rutas listadas. Si tienen código útil, muévelo a tu proyecto manualmente.",
    "  2. Borra las rutas listadas si son basura.",
    "  3. Edita el título / scope de la HU para que no contenga rutas absolutas.",
    "  4. Vuelve a lanzar la HU.",
  ].join("\n");
}

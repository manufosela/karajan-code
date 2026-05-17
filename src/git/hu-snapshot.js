// KJC-TSK-0408: snapshots de ficheros por HU para soportar Undo.
//
// Antes de ejecutar una HU, guardamos un ref git apuntando al HEAD
// actual (`refs/kj-snapshots/<huId>`). Si el usuario hace Undo después,
// hacemos `git reset --hard <ref>` para volver al estado pre-run.
//
// Por qué refs en lugar de stash/tarball:
//   - Refs son objetos git nativos. No mueven blobs (todos compartidos
//     con HEAD), así que crear el snapshot es O(1).
//   - El snapshot persiste a través de checkouts y rebases.
//   - Si el ref ya apunta al SHA correcto, restore es no-op.
//
// El runner es inyectable para que los tests no necesiten un repo git real.

import { runCommand } from "../utils/process.js";

const REF_PREFIX = "refs/kj-snapshots/";

/**
 * Sanitiza un huId para uso como nombre de ref. Git rechaza:
 *   - `..`, `:`, `~`, `^`, `?`, `*`, `[`, `\`, espacios, control chars
 *   - segmentos que empiecen por `.` o terminen en `.lock`
 * Reemplazamos cualquier no [a-zA-Z0-9_-] por `_`.
 */
export function snapshotRefForHu(huId) {
  if (!huId) throw new Error("huId requerido");
  const safe = String(huId).replaceAll(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80);
  return REF_PREFIX + safe;
}

async function defaultRunner(args, opts = {}) {
  return runCommand("git", args, opts);
}

/**
 * Crea (o actualiza) el ref del snapshot apuntando al HEAD actual.
 *
 * @param {object} args
 * @param {string} args.projectDir
 * @param {string} args.huId
 * @param {Function} [args.runner] - sustituye git CLI en tests
 * @returns {Promise<{ ok: boolean, ref?: string, sha?: string, error?: string }>}
 */
export async function createHuSnapshot({ projectDir, huId, runner }) {
  const run = runner || defaultRunner;
  const ref = snapshotRefForHu(huId);
  const head = await run(["rev-parse", "HEAD"], { cwd: projectDir });
  if (head.exitCode !== 0) {
    return { ok: false, error: `rev-parse HEAD failed: ${(head.stderr || "").trim()}` };
  }
  const sha = (head.stdout || "").trim();
  if (!sha) return { ok: false, error: "HEAD vacío" };
  const update = await run(["update-ref", ref, sha], { cwd: projectDir });
  if (update.exitCode !== 0) {
    return { ok: false, error: `update-ref falló: ${(update.stderr || "").trim()}` };
  }
  return { ok: true, ref, sha };
}

/**
 * @param {object} args
 * @param {string} args.projectDir
 * @param {string} args.huId
 * @param {Function} [args.runner]
 * @returns {Promise<{ ok: boolean, sha?: string }>}
 */
export async function hasHuSnapshot({ projectDir, huId, runner }) {
  const run = runner || defaultRunner;
  const ref = snapshotRefForHu(huId);
  const r = await run(["rev-parse", "--verify", "--quiet", ref], { cwd: projectDir });
  if (r.exitCode !== 0) return { ok: false };
  return { ok: true, sha: (r.stdout || "").trim() };
}

/**
 * Restaura el workspace al snapshot. DESTRUCTIVO: hace `git reset --hard`,
 * lo que descarta cambios no committeados. Caller debe avisar al usuario.
 *
 * @returns {Promise<{ ok: boolean, sha?: string, error?: string }>}
 */
export async function restoreHuSnapshot({ projectDir, huId, runner }) {
  const run = runner || defaultRunner;
  const ref = snapshotRefForHu(huId);
  const has = await hasHuSnapshot({ projectDir, huId, runner: run });
  if (!has.ok) return { ok: false, error: `snapshot no encontrado para HU ${huId}` };
  const r = await run(["reset", "--hard", ref], { cwd: projectDir });
  if (r.exitCode !== 0) {
    return { ok: false, error: `reset --hard falló: ${(r.stderr || "").trim()}` };
  }
  return { ok: true, sha: has.sha };
}

/**
 * Borra el ref del snapshot. Idempotente: si no existe, devuelve ok:true.
 */
export async function removeHuSnapshot({ projectDir, huId, runner }) {
  const run = runner || defaultRunner;
  const ref = snapshotRefForHu(huId);
  const r = await run(["update-ref", "-d", ref], { cwd: projectDir });
  // git update-ref -d devuelve 0 incluso si el ref no existía.
  if (r.exitCode !== 0) {
    return { ok: false, error: `update-ref -d falló: ${(r.stderr || "").trim()}` };
  }
  return { ok: true };
}

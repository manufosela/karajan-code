// KJC-TSK-0414 PR 1: persistencia de sesiones hibernadas al disco.
//
// Cuando Brain decide hibernar (QUOTA_EXHAUSTED_DAILY con retryAfter > 5min),
// serializa el estado completo del run en ~/.kj/standby/<sessionId>.json.
// El proceso de kj run muere (exit 0) tras persistir; el board (o kj resume)
// lo reanuda cuando llega cooldownUntil.
//
// Layout en disco:
//   ~/.kj/standby/
//     <sessionId>.json    ← sesiones pendientes (scheduler les mete setTimeout)
//     <sessionId>.lock    ← lockfile durante spawn de kj resume
//     done/
//       <sessionId>.json  ← finalizadas (consumibles por GC en TSK-0414 PR3)

import fs from "node:fs";
import path from "node:path";
import { writeJsonAtomicSync } from "../utils/atomic-write.js";
import { resolveHome } from "../utils/paths.js";

const FILENAME_RE = /^[a-zA-Z0-9._-]+\.json$/;

// Delegates to the unified resolver. PR 1 keeps the legacy `.kj`
// default; PR 3 will switch every caller to `.karajan/`.
function getKjHome() {
  return resolveHome({ defaultSegment: ".kj" });
}

export function standbyDir() {
  return path.join(getKjHome(), "standby");
}

export function standbyDoneDir() {
  return path.join(standbyDir(), "done");
}

function sanitizeId(sessionId) {
  if (!sessionId || typeof sessionId !== "string") throw new Error("sessionId requerido");
  return sessionId.replaceAll(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
}

/**
 * Persiste el estado completo de un run hibernado.
 *
 * @param {object} state - shape:
 *   { sessionId, planId?, huId?, role, iteration?, prompt, agentConfig,
 *     retryCount?, cooldownUntil, reason, snapshot_sha?, outcome_so_far? }
 * @returns {string} path absoluto del JSON escrito
 */
export function persistStandby(state) {
  if (!state || !state.sessionId) throw new Error("state.sessionId requerido");
  if (!state.cooldownUntil) throw new Error("state.cooldownUntil requerido");
  const dir = standbyDir();
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${sanitizeId(state.sessionId)}.json`);
  const payload = {
    ...state,
    createdAt: state.createdAt || new Date().toISOString(),
    persistedAt: new Date().toISOString(),
  };
  writeJsonAtomicSync(file, payload);
  return file;
}

// Only these env vars are carried into the standby snapshot. NEVER
// persist the whole `process.env` — that would leak API keys and other
// secrets into ~/.kj/standby/*.json. `kj standby resume` re-spawns with
// the live env merged on top, so the snapshot only needs what is needed
// to relaunch from the right place.
const STANDBY_ENV_ALLOWLIST = ["KJ_HOME", "HOME", "PATH"];

/**
 * Builds the `sessionState` object that `withBrainRecovery` persists when
 * a run hibernates. Pulls the session id, the relaunch metadata and an
 * allowlisted env subset so `kj standby resume` can re-spawn the command.
 * @param {object} args
 * @param {object} args.session    - the pipeline session ({ id, plan_id? })
 * @param {object} [args.config]   - resolved config ({ projectDir?, plan? })
 * @param {string|null} [args.huId]
 * @returns {object|null} sessionState, or null when there is no session id
 */
export function buildStandbyState({ session, config = {}, huId = null } = {}) {
  if (!session?.id) return null;
  const env = {};
  for (const key of STANDBY_ENV_ALLOWLIST) {
    if (process.env[key] != null) env[key] = process.env[key];
  }
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith("KJ_") && value != null) env[key] = value;
  }
  return {
    sessionId: session.id,
    planId: session.plan_id || config.plan || null,
    huId: huId || null,
    argv: process.argv.slice(2),
    cwd: config.projectDir || process.cwd(),
    env,
  };
}

/**
 * @param {string} sessionId
 * @returns {object|null}
 */
export function loadStandby(sessionId) {
  const file = path.join(standbyDir(), `${sanitizeId(sessionId)}.json`);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return null;
  }
}

/**
 * Lista todas las sesiones pendientes (no las de done/).
 * @returns {object[]}
 */
export function listPendingStandby() {
  const dir = standbyDir();
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => FILENAME_RE.test(f))
    .map((f) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8"));
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

/**
 * Mueve una sesión a done/ — consumible por GC en TSK-0414 PR3.
 * @param {string} sessionId
 * @returns {boolean} true si se movió
 */
export function markStandbyDone(sessionId) {
  const id = sanitizeId(sessionId);
  const src = path.join(standbyDir(), `${id}.json`);
  if (!fs.existsSync(src)) return false;
  const doneDir = standbyDoneDir();
  fs.mkdirSync(doneDir, { recursive: true });
  const dst = path.join(doneDir, `${id}-${Date.now()}.json`);
  fs.renameSync(src, dst);
  return true;
}

/**
 * Lockfile para evitar dobles spawns de kj resume sobre la misma sesión.
 * Devuelve { acquired: true, release: () => void } o { acquired: false } si ya hay lock.
 *
 * @param {string} sessionId
 * @returns {{ acquired: boolean, release?: Function }}
 */
export function acquireStandbyLock(sessionId) {
  const id = sanitizeId(sessionId);
  const lockFile = path.join(standbyDir(), `${id}.lock`);
  try {
    fs.mkdirSync(standbyDir(), { recursive: true });
    fs.writeFileSync(lockFile, String(process.pid), { flag: "wx" });
    return { acquired: true, release: () => { try { fs.unlinkSync(lockFile); } catch { /* */ } } };
  } catch {
    return { acquired: false };
  }
}

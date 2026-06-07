/**
 * Run tracker — registro híbrido (memoria + disco) de procesos kj run.
 *
 * KJC-TSK-0396: el botón ⏹ Stop del board combina dos fuentes:
 *
 * 1. **Memoria** (`runs` Map) — runs lanzados desde el board vía
 *    `runPlan` en plan-mutations.js. Bajo coste, sin I/O.
 *
 * 2. **Disco** (`~/.karajan/runs/<runId>.json` vía run-registry.js) —
 *    runs lanzados desde la terminal externa (cualquier `kj run`). El
 *    CLI escribe el registro al arranque y lo borra al final. Esto da
 *    bidireccionalidad terminal ↔ board.
 *
 * `getActiveRuns(planId)` une las dos fuentes y dedupe por PID. Los
 * registros con PID muerto se filtran automáticamente y los del disco
 * se borran como cleanup (responsabilidad de run-registry).
 */

import { listActiveRuns as fsList } from "@karajan/core/run-registry";

const runs = new Map();
let reaperTimer = null;

/**
 * Registra un run lanzado desde el board (memoria).
 *
 * @param {string} planId
 * @param {{ pid: number, huIds?: string[]|null }} info
 */
export function trackRun(planId, info) {
  if (!planId || !info?.pid) return;
  const set = runs.get(planId) || new Set();
  set.add({ pid: info.pid, huIds: info.huIds || null, startedAt: Date.now() });
  runs.set(planId, set);
  ensureReaper();
}

/**
 * Devuelve los runs activos para un planId. Une memoria + FS y dedupe
 * por PID. Filtra PIDs muertos.
 */
export function getActiveRuns(planId) {
  const seen = new Set();
  const out = [];
  // Memoria
  const set = runs.get(planId);
  if (set) {
    for (const r of set) {
      if (isAlive(r.pid)) {
        seen.add(r.pid);
        out.push({ pid: r.pid, huIds: r.huIds, startedAt: r.startedAt, source: "board" });
      } else set.delete(r);
    }
    if (set.size === 0) runs.delete(planId);
  }
  // Disco
  for (const entry of fsList({ planId })) {
    if (seen.has(entry.pid)) continue;
    seen.add(entry.pid);
    out.push({
      pid: entry.pid,
      huIds: entry.huIds,
      startedAt: entry.startedAt,
      source: entry.source || "cli",
      projectDir: entry.projectDir,
    });
  }
  return out;
}

/**
 * Igual que getActiveRuns pero para todos los planes (memoria + FS).
 */
export function getAllActiveRuns() {
  const out = {};
  // Memoria
  for (const planId of runs.keys()) {
    const alive = getActiveRuns(planId);
    if (alive.length > 0) out[planId] = alive;
  }
  // FS — añadir planes que solo viven en disco (no se vieron arriba).
  for (const entry of fsList()) {
    if (!entry.planId) continue;
    if (out[entry.planId]) continue;
    out[entry.planId] = getActiveRuns(entry.planId);
  }
  return out;
}

/**
 * Quita el registro de un PID de memoria. Los registros FS los limpia
 * el propio CLI (vía registry.unregisterRun en su finally).
 */
export function untrack(planId, pid) {
  const set = runs.get(planId);
  if (!set) return;
  for (const r of set) {
    if (r.pid === pid) set.delete(r);
  }
  if (set.size === 0) runs.delete(planId);
}

function isAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; }
  catch (err) { return err.code === "EPERM"; }
}

/** Test-only reset. */
export function _resetForTests() {
  runs.clear();
  if (reaperTimer) { clearInterval(reaperTimer); reaperTimer = null; }
}

function ensureReaper() {
  if (reaperTimer || process.env.VITEST) return;
  reaperTimer = setInterval(() => {
    for (const planId of [...runs.keys()]) getActiveRuns(planId);
  }, 30_000);
  reaperTimer.unref?.();
}

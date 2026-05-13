/**
 * Run tracker — registro en memoria de procesos kj run activos por planId.
 *
 * KJC-TSK-0396: el botón ⏹ Stop del board necesita saber qué PIDs están
 * vivos para cada plan. `runPlan` en plan-mutations.js hace `spawn`
 * detached y devuelve el PID, pero ese PID se perdía: no había forma
 * desde el frontend de saber "este plan tiene runs vivos".
 *
 * Este módulo guarda un Map<planId, Set<{ pid, huIds, startedAt }>> en
 * memoria del proceso del board. Se limpia automáticamente cuando los
 * procesos mueren (chequeo periódico vía `process.kill(pid, 0)` que NO
 * envía señal — solo verifica existencia).
 */

const runs = new Map();
let reaperTimer = null;

/**
 * Registra un nuevo run.
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
 * Devuelve los runs activos para un planId. Aplica un filtro
 * `process.kill(pid, 0)` antes de devolver para evitar reportar PIDs
 * muertos como vivos.
 */
export function getActiveRuns(planId) {
  const set = runs.get(planId);
  if (!set || set.size === 0) return [];
  const alive = [];
  for (const r of set) {
    if (isAlive(r.pid)) alive.push(r);
    else set.delete(r);
  }
  if (set.size === 0) runs.delete(planId);
  return alive;
}

/**
 * Igual que getActiveRuns pero para todos los planes. Útil para una
 * vista global "qué está corriendo ahora mismo".
 */
export function getAllActiveRuns() {
  const out = {};
  for (const planId of runs.keys()) {
    const alive = getActiveRuns(planId);
    if (alive.length > 0) out[planId] = alive;
  }
  return out;
}

/**
 * Quita el registro de un PID concreto (cuando lo paramos manualmente
 * o lo detectamos muerto).
 */
export function untrack(planId, pid) {
  const set = runs.get(planId);
  if (!set) return;
  for (const r of set) {
    if (r.pid === pid) set.delete(r);
  }
  if (set.size === 0) runs.delete(planId);
}

/**
 * Verifica si un PID sigue vivo. `process.kill(pid, 0)` NO envía
 * señal — solo lanza ESRCH si el proceso no existe. Defensivo.
 */
function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM"; // EPERM = existe pero no tenemos permiso (sigue vivo)
  }
}

/**
 * Test-only reset.
 */
export function _resetForTests() {
  runs.clear();
  if (reaperTimer) { clearInterval(reaperTimer); reaperTimer = null; }
}

/**
 * Reaper en background — cada 30s recorre todos los registros y limpia
 * los PIDs muertos. Es defensa contra fugas de memoria si algún run
 * murió sin notificarse y el frontend no consulta el endpoint.
 */
function ensureReaper() {
  if (reaperTimer || process.env.VITEST) return;
  reaperTimer = setInterval(() => {
    for (const planId of [...runs.keys()]) getActiveRuns(planId);
  }, 30_000);
  reaperTimer.unref?.();
}

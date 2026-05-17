// KJC-TSK-0414 PR 1: scheduler event-driven para hibernación.
//
// Diseño: setTimeout único por sesión, dispara EXACTAMENTE en cooldownUntil.
// Cero polling. Si el proceso muere antes del fire, reconcileAll() al
// arrancar el board re-programa los timeouts pendientes (o reanuda
// inmediatamente los expirados).

import { listPendingStandby, acquireStandbyLock, markStandbyDone } from "./standby-store.js";

// Mapa sessionId → NodeJS.Timeout — accesible para test/cancel.
const _scheduled = new Map();

export function _resetScheduledForTests() {
  for (const t of _scheduled.values()) clearTimeout(t);
  _scheduled.clear();
}

/**
 * Programa un único setTimeout que dispara `onResume(sessionId)` en cooldownUntil.
 *
 * @param {object} args
 * @param {string} args.sessionId
 * @param {string} args.cooldownUntil - ISO timestamp
 * @param {Function} args.onResume - callback(sessionId) cuando llega el momento
 * @param {object} [args.logger]
 * @returns {{ scheduled: boolean, msUntil?: number, immediate?: boolean }}
 */
export function scheduleResume({ sessionId, cooldownUntil, onResume, logger }) {
  if (!sessionId || !cooldownUntil || typeof onResume !== "function") {
    return { scheduled: false };
  }
  cancelScheduled(sessionId);
  const targetMs = new Date(cooldownUntil).getTime();
  if (Number.isNaN(targetMs)) return { scheduled: false };
  const delay = targetMs - Date.now();
  if (delay <= 0) {
    // Ya expiró — reanudar inmediato (caso: board reiniciado tras llegar la hora).
    logger?.info?.(`[standby-scheduler] ${sessionId}: cooldown ya expirado, resume inmediato`);
    Promise.resolve().then(() => onResume(sessionId)).catch(() => { /* swallow */ });
    return { scheduled: true, immediate: true };
  }
  const timer = setTimeout(() => {
    _scheduled.delete(sessionId);
    logger?.info?.(`[standby-scheduler] ${sessionId}: cooldown alcanzado, disparando resume`);
    try { onResume(sessionId); } catch (err) { logger?.warn?.(`[standby-scheduler] onResume threw: ${err.message}`); }
  }, delay);
  if (typeof timer.unref === "function") timer.unref();
  _scheduled.set(sessionId, timer);
  logger?.info?.(`[standby-scheduler] ${sessionId}: scheduled in ${Math.round(delay / 1000)}s (until ${cooldownUntil})`);
  return { scheduled: true, msUntil: delay };
}

/** Cancela el setTimeout de una sesión (caso: usuario hizo kj resume manual). */
export function cancelScheduled(sessionId) {
  const t = _scheduled.get(sessionId);
  if (!t) return false;
  clearTimeout(t);
  _scheduled.delete(sessionId);
  return true;
}

/**
 * Reconciliación al arrancar el board / kj. Lee todas las sesiones pendientes
 * y para cada una:
 *   - cooldownUntil < now → onResume inmediato
 *   - cooldownUntil > now → re-programa setTimeout
 *
 * Idempotente: el lockfile en standby-store previene dobles spawns si
 * reconcileAll() corre dos veces concurrentes (board reload).
 *
 * @param {object} args
 * @param {Function} args.onResume - callback(sessionId)
 * @param {object} [args.logger]
 * @returns {{ scheduled: number, immediate: number, total: number }}
 */
export function reconcileAll({ onResume, logger }) {
  const sessions = listPendingStandby();
  let scheduled = 0;
  let immediate = 0;
  for (const s of sessions) {
    if (!s?.sessionId || !s?.cooldownUntil) continue;
    const r = scheduleResume({ sessionId: s.sessionId, cooldownUntil: s.cooldownUntil, onResume, logger });
    if (r.scheduled && r.immediate) immediate += 1;
    else if (r.scheduled) scheduled += 1;
  }
  logger?.info?.(`[standby-scheduler] reconcile: ${sessions.length} sesiones (${immediate} resume inmediato, ${scheduled} programadas)`);
  return { scheduled, immediate, total: sessions.length };
}

// Re-export para que callers no tengan que importar standby-store si solo
// necesitan el flow scheduler → lock → done.
export { acquireStandbyLock, markStandbyDone };

/**
 * HU-level zombie reaper (KJC-TSK-0394 step 3).
 *
 * Counterpart to zombie-reaper.js (que opera sobre sesiones). Detecta
 * HUs que el orquestador dejó stuck en `coding`/`reviewing` —síntoma
 * de crash mid-iteration— y las resetea a `pending`.
 *
 * Threshold separado de las sesiones: una sesión legítima puede
 * tardar horas (loop largo), una HU individual rara vez >30 min. Por
 * eso este reaper trabaja en minutos, no en horas.
 *
 * Semántica del reap: status → `pending` (NO `failed`: el orquestador
 * perdió contacto, no podemos afirmar el outcome). El campo `result`
 * NO se toca — se conserva como historial. La persistencia pasa por
 * plan-mutations::setHuStatus (escribe el plan JSON + resync DB). Si
 * el JSON write falla cae al fallback DB-only.
 */

const DEFAULT_RUNNING_MINUTES = 30;
// `coding` + `reviewing` son los nombres legacy; `running` es el
// canónico tras step 5. Aceptamos los tres durante la transición.
const RUNNING_STATUSES = new Set(["coding", "reviewing", "running"]);

/**
 * Pure. Decide si un HU row es zombi a `now`.
 */
export function classifyHuZombie(hu, ctx) {
  if (!hu || !hu.status) return { zombie: false };
  const status = String(hu.status).toLowerCase();
  if (!RUNNING_STATUSES.has(status)) return { zombie: false };
  const refIso = hu.updated_at;
  if (!refIso) return { zombie: false };
  const refTs = new Date(refIso).getTime();
  if (Number.isNaN(refTs)) return { zombie: false };
  const ageMinutes = (ctx.now - refTs) / 60_000;
  if (ageMinutes < ctx.runningMinutes) return { zombie: false };
  return {
    zombie: true,
    reason: `${status} ${ageMinutes.toFixed(0)}min inactive (>= ${ctx.runningMinutes}min)`,
  };
}

/** Pure. Filtra solo los zombis. */
export function findZombieHus(hus, opts = {}) {
  const ctx = {
    now: opts.now ?? Date.now(),
    runningMinutes: opts.runningMinutes ?? DEFAULT_RUNNING_MINUTES,
  };
  const out = [];
  for (const hu of hus || []) {
    const verdict = classifyHuZombie(hu, ctx);
    if (verdict.zombie) out.push({ hu, reason: verdict.reason });
  }
  return out;
}

/**
 * Resetea a `pending` cada HU zombi en la DB Y en el fichero del
 * plan. `setHuStatus` se inyecta para que los tests no necesiten un
 * plan-file real. Devuelve la lista de reapeados para el log.
 */
export function reapZombieHus({ db, setHuStatus, opts = {}, now = () => Date.now() }) {
  if (!db || typeof setHuStatus !== "function") return [];
  const rows = db.prepare(
    "SELECT id, project_id, plan_id, status, updated_at FROM stories WHERE status IN ('coding', 'reviewing', 'running')",
  ).all();
  const zombies = findZombieHus(rows, { ...opts, now: now() });
  if (zombies.length === 0) return [];
  const reaped = [];
  for (const { hu, reason } of zombies) {
    // El id compuesto del board es `${projectId}::${huId}`; setHuStatus
    // quiere el huId local.
    const localHuId = hu.id.includes("::") ? hu.id.split("::").slice(1).join("::") : hu.id;
    let planPersisted = false;
    if (hu.plan_id) {
      try {
        const result = setHuStatus({ planId: hu.plan_id, huId: localHuId, status: "pending", projectId: hu.project_id });
        planPersisted = !!(result && result.ok);
      } catch { /* swallow — never block startup */ }
    }
    // Fallback DB-only para legacy rows (plan_id null) o si el write al
    // plan falló. setHuStatus ya resincroniza en el caso happy.
    if (!planPersisted) {
      try {
        db.prepare("UPDATE stories SET status = 'pending', updated_at = ? WHERE id = ?").run(new Date(now()).toISOString(), hu.id);
      } catch { /* swallow */ }
    }
    reaped.push({ id: hu.id, status_before: hu.status, reason, plan_persisted: planPersisted });
  }
  return reaped;
}

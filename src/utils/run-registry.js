/**
 * Run registry — registro persistente de `kj run` activos.
 *
 * KJC-TSK-0396 (extensión): el HU Board necesita ver runs lanzados desde
 * la terminal externa (no solo los lanzados desde el propio board). Para
 * eso, cada `kj run` escribe su PID + planId + huIds + projectDir a un
 * archivo en `~/.karajan/runs/<runId>.json` al arrancar, y lo borra al
 * terminar (success o crash con cleanup vía finally).
 *
 * El board lee ese directorio en startup + cada vez que sirve el endpoint
 * `/api/runs/:planId/active`, descartando los registros con PID muerto
 * (filtrado con `process.kill(pid, 0)`). Resultado: bidireccionalidad
 * total terminal ↔ board.
 *
 * Compartido entre el CLI (src/commands/run.js) y el board
 * (packages/hu-board/src/run-tracker.js). Vive en src/utils/ porque
 * el board ya importa cosas de src/ sin problema.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

/**
 * Directorio raíz donde viven los registros de run.
 * Honra `KJ_HOME` para tests y setups custom.
 */
export function runsDir() {
  const home = process.env.KJ_HOME || path.join(os.homedir(), ".karajan");
  return path.join(home, "runs");
}

/**
 * Registra un nuevo run en disco. El runId es derivado del PID + timestamp
 * para ser único por proceso.
 *
 * @param {{ pid: number, planId?: string|null, huIds?: string[]|null, projectDir?: string|null, source?: string }} info
 * @returns {string|null} runId o null si la escritura falló (no bloquea al caller).
 */
export function registerRun(info = {}) {
  if (!info?.pid) return null;
  try {
    fs.mkdirSync(runsDir(), { recursive: true });
    // Sufijo random para evitar colisiones cuando 2 runs del mismo PID
    // se registran en el mismo ms (raro en CLI, posible en tests).
    const runId = `run-${Date.now()}-${info.pid}-${Math.random().toString(36).slice(2, 8)}`;
    const filePath = path.join(runsDir(), `${runId}.json`);
    const entry = {
      runId,
      pid: info.pid,
      planId: info.planId || null,
      huIds: Array.isArray(info.huIds) ? info.huIds : null,
      projectDir: info.projectDir || null,
      source: info.source || "cli",
      startedAt: new Date().toISOString(),
    };
    fs.writeFileSync(filePath, JSON.stringify(entry, null, 2), "utf8");
    return runId;
  } catch {
    return null;
  }
}

/**
 * Borra el registro de un run. Idempotente — silencia ENOENT.
 *
 * @param {string} runId
 */
export function unregisterRun(runId) {
  if (!runId) return;
  try {
    fs.unlinkSync(path.join(runsDir(), `${runId}.json`));
  } catch {
    // Idempotente
  }
}

/**
 * Lista todos los runs activos en disco, filtrando los con PID muerto.
 * Los muertos se borran del FS (auto-cleanup defensivo).
 *
 * @param {{ planId?: string }} [filter] - si se pasa planId, devuelve solo los runs de ese plan.
 * @returns {Array<{runId, pid, planId, huIds, projectDir, source, startedAt}>}
 */
export function listActiveRuns(filter = {}) {
  const dir = runsDir();
  if (!fs.existsSync(dir)) return [];
  const out = [];
  let files;
  try { files = fs.readdirSync(dir); } catch { return []; }
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    const filePath = path.join(dir, f);
    let entry;
    try { entry = JSON.parse(fs.readFileSync(filePath, "utf8")); }
    catch { try { fs.unlinkSync(filePath); } catch { /* swallow */ } continue; }
    if (!isAlive(entry.pid)) {
      try { fs.unlinkSync(filePath); } catch { /* swallow */ }
      continue;
    }
    if (filter.planId && entry.planId !== filter.planId) continue;
    out.push(entry);
  }
  return out;
}

/**
 * Verifica si un PID sigue vivo. `process.kill(pid, 0)` NO envía
 * señal — solo lanza ESRCH si el proceso no existe.
 */
function isAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; }
  catch (err) { return err.code === "EPERM"; }
}

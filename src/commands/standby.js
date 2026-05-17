// KJC-TSK-0414 PR2: comandos kj standby list / kj resume.
//
// `kj resume <sessionId>` valida cooldownUntil y, si llegó la hora, re-spawn
// el comando original capturado en argv. Si cooldown todavía está en el
// futuro, muestra countdown y aborta. `kj standby list` solo enumera.
//
// Estrategia de resume: cada sessionState persiste su argv original (los
// argumentos con los que se lanzó el `kj` que hibernó). El resume re-spawn
// EXACTAMENTE ese mismo comando con env preservado. El run reanuda como si
// fuera un retry — el state interno (HU pendiente, snapshot_sha, etc.) está
// en el JSON persistido en disco por TSK-0408 + TSK-0414 PR1.

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadStandby, listPendingStandby, markStandbyDone, acquireStandbyLock } from "../brain/standby-store.js";

const REPO_KJ_CLI = (() => {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    return path.join(here, "..", "cli.js");
  } catch {
    return null;
  }
})();

function formatCountdown(ms) {
  if (ms <= 0) return "ahora";
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

export async function standbyListCommand({ json } = {}) {
  const sessions = listPendingStandby();
  if (json) {
    console.log(JSON.stringify(sessions, null, 2));
    return;
  }
  if (sessions.length === 0) {
    console.log("No hay sesiones hibernadas.");
    return;
  }
  console.log(`Sesiones hibernadas (${sessions.length}):`);
  const now = Date.now();
  for (const s of sessions) {
    const ms = new Date(s.cooldownUntil).getTime() - now;
    const status = ms <= 0 ? "✓ lista para resume" : `⏳ resume en ${formatCountdown(ms)}`;
    console.log(`  ${s.sessionId}  · ${s.reason || "?"}  · ${status}`);
    if (s.planId) console.log(`    plan: ${s.planId}${s.huId ? `, HU: ${s.huId}` : ""}`);
  }
}

/**
 * Re-spawn el comando original capturado en sessionState.argv.
 * Si cooldownUntil > now y force=false → aborta con mensaje.
 */
export async function resumeCommand({ sessionId, force } = {}) {
  if (!sessionId) {
    console.error("kj resume requiere <sessionId>. Usa `kj standby list` para ver pendientes.");
    process.exitCode = 1;
    return;
  }
  const state = loadStandby(sessionId);
  if (!state) {
    console.error(`Sesión no encontrada: ${sessionId}`);
    process.exitCode = 1;
    return;
  }
  const cooldownMs = new Date(state.cooldownUntil).getTime() - Date.now();
  if (cooldownMs > 0 && !force) {
    console.log(`Sesión ${sessionId} todavía en cooldown ${formatCountdown(cooldownMs)} (hasta ${state.cooldownUntil}).`);
    console.log("Espera o usa `kj resume <sessionId> --force` (no recomendado — la API seguramente seguirá rechazando).");
    process.exitCode = 0;
    return;
  }

  const lock = acquireStandbyLock(sessionId);
  if (!lock.acquired) {
    console.log(`Sesión ${sessionId} ya está siendo reanudada por otro proceso.`);
    process.exitCode = 0;
    return;
  }

  try {
    if (!Array.isArray(state.argv) || state.argv.length === 0) {
      console.error(`Sesión ${sessionId} sin argv — no se puede re-spawn. Borra manual y relanza.`);
      process.exitCode = 1;
      return;
    }
    if (!REPO_KJ_CLI) {
      console.error("No se pudo localizar cli.js. ¿Karajan instalado correctamente?");
      process.exitCode = 1;
      return;
    }
    console.log(`Reanudando ${sessionId}: kj ${state.argv.join(" ")}`);
    const child = spawn(process.execPath, [REPO_KJ_CLI, ...state.argv], {
      cwd: state.cwd || process.cwd(),
      env: { ...process.env, ...(state.env || {}), KJ_RESUME_FROM: sessionId },
      stdio: "inherit",
    });
    await new Promise((resolve) => {
      child.on("exit", (code) => {
        if (code === 0) markStandbyDone(sessionId);
        process.exitCode = code ?? 0;
        resolve();
      });
    });
  } finally {
    lock.release?.();
  }
}

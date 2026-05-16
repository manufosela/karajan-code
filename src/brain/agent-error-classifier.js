// KJC-TSK-0411: clasificador universal de errores de agente IA.
//
// Devuelve clase rica + metadata accionable para que Brain (TSK-0412)
// decida retry/standby/hibernar/abortar sin tener que repetir lógica
// de parsing en cada stage.
//
// Reutiliza parseCooldown del rate-limit-detector legacy para no
// duplicar regex. Este módulo extiende la clasificación:
//   - RATE_LIMIT_SHORT vs QUOTA_EXHAUSTED_DAILY se distinguen por
//     cooldownMs (threshold 1h).
//   - SILENCED se detecta por exit 143/null + "killed after Nms".
//   - AUTH_FAILED por 401/403 + "Unauthorized"/"invalid api key".
//   - NETWORK_TIMEOUT por ECONN*/socket hang up sin cooldown.

import { parseCooldown } from "../utils/rate-limit-detector.js";

export const ERROR_CLASS = Object.freeze({
  RATE_LIMIT_SHORT: "RATE_LIMIT_SHORT",
  QUOTA_EXHAUSTED_DAILY: "QUOTA_EXHAUSTED_DAILY",
  API_DOWN: "API_DOWN",
  AUTH_FAILED: "AUTH_FAILED",
  NETWORK_TIMEOUT: "NETWORK_TIMEOUT",
  SILENCED: "SILENCED",
  UNKNOWN_FATAL: "UNKNOWN_FATAL",
});

const ONE_HOUR_MS = 60 * 60 * 1000;

const AUTH_PATTERNS = /\b401\b|\b403\b|unauthorized|invalid\s+api\s+key|authentication\s+failed|expired\s+token/i;
const SILENCED_PATTERNS = /killed\s+after\s+\d+\s*ms|silence\s*timeout|no\s+output\s+for\s+\d+/i;
const RATE_LIMIT_PATTERNS = /usage\s+limit|rate\s*limit|too\s+many\s+requests|\b429\b|throttl|exceeded\s+your\s+current\s+quota|resource\s+exhausted|quota\s+exceeded|token\s+limit\s+reached/i;
const API_DOWN_PATTERNS = /\b50[0-4]\b|bad\s+gateway|service\s+unavailable|gateway\s+timeout|overloaded|internal\s+server\s+error/i;
const NETWORK_PATTERNS = /ECONNREFUSED|ECONNRESET|ETIMEDOUT|socket\s+hang\s+up|fetch\s+failed|network\s+error/i;

function pickMessage(combined, pattern) {
  const line = combined.split("\n").find((l) => pattern.test(l));
  return (line || combined).trim().slice(0, 300);
}

/**
 * @param {object} args
 * @param {string} [args.provider] - claude|codex|gemini|opencode|aider
 * @param {string} [args.stdout]
 * @param {string} [args.stderr]
 * @param {number|null} [args.exitCode]
 * @returns {{ class: string, provider: string, message: string, retryAfter: number|null, retryUntil: string|null, recoverable: boolean, exitCode: number|null }}
 */
export function classifyAgentError({ provider = "unknown", stdout = "", stderr = "", exitCode = null }) {
  const combined = `${stderr}\n${stdout}`;
  const base = { provider, exitCode, retryAfter: null, retryUntil: null };

  // 1. AUTH_FAILED tiene prioridad absoluta — no es recuperable, escalar al usuario.
  if (AUTH_PATTERNS.test(combined)) {
    return { ...base, class: ERROR_CLASS.AUTH_FAILED, message: pickMessage(combined, AUTH_PATTERNS), recoverable: false };
  }

  // 2. SILENCED: subprocess killed por silenceTimeout. exit=143 (SIGTERM) o null.
  //    También detectamos por mensaje aunque exitCode no encaje (resiliente).
  if (SILENCED_PATTERNS.test(combined) || (exitCode === 143 && !combined.trim())) {
    return { ...base, class: ERROR_CLASS.SILENCED, message: pickMessage(combined, SILENCED_PATTERNS) || "Agent silenciado por timeout", recoverable: true };
  }

  // 3. RATE_LIMIT con cooldown. Threshold 1h → DAILY (hibernar candidato).
  if (RATE_LIMIT_PATTERNS.test(combined)) {
    const msg = pickMessage(combined, RATE_LIMIT_PATTERNS);
    const { cooldownUntil, cooldownMs } = parseCooldown(msg) ?? {};
    const isDailyQuota = cooldownMs != null && cooldownMs > ONE_HOUR_MS;
    return {
      ...base,
      class: isDailyQuota ? ERROR_CLASS.QUOTA_EXHAUSTED_DAILY : ERROR_CLASS.RATE_LIMIT_SHORT,
      message: msg,
      retryAfter: cooldownMs ?? null,
      retryUntil: cooldownUntil ?? null,
      recoverable: true,
    };
  }

  // 4. NETWORK errors antes que API_DOWN — ECONN* es a nivel socket, no respuesta HTTP.
  if (NETWORK_PATTERNS.test(combined)) {
    return { ...base, class: ERROR_CLASS.NETWORK_TIMEOUT, message: pickMessage(combined, NETWORK_PATTERNS), recoverable: true };
  }

  // 5. API_DOWN: 5xx, overloaded.
  if (API_DOWN_PATTERNS.test(combined)) {
    return { ...base, class: ERROR_CLASS.API_DOWN, message: pickMessage(combined, API_DOWN_PATTERNS), recoverable: true };
  }

  // 6. UNKNOWN_FATAL: salida no clasificada con exitCode != 0.
  return { ...base, class: ERROR_CLASS.UNKNOWN_FATAL, message: combined.trim().slice(0, 300) || `exit ${exitCode}`, recoverable: false };
}

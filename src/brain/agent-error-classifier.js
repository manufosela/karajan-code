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
  // KJC-TSK-0415: Anthropic Max 20x cambia a $200/mes Agent SDK desde
  // 15-jun-2026. Cuando llegues al cap mensual, el reset es 1-mes —
  // muy distinto del daily de Claude Pro. Esta clase distingue ambos.
  QUOTA_EXHAUSTED_MONTHLY: "QUOTA_EXHAUSTED_MONTHLY",
  API_DOWN: "API_DOWN",
  AUTH_FAILED: "AUTH_FAILED",
  NETWORK_TIMEOUT: "NETWORK_TIMEOUT",
  SILENCED: "SILENCED",
  UNKNOWN_FATAL: "UNKNOWN_FATAL",
});

const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const AUTH_PATTERNS = /\b401\b|\b403\b|unauthorized|invalid\s+api\s+key|authentication\s+failed|expired\s+token/i;
const SILENCED_PATTERNS = /killed\s+after\s+\d+\s*ms|silence\s*timeout|no\s+output\s+for\s+\d+/i;
// `session\s+limit` / `weekly\s+limit` cover Claude Code's usage caps
// ("You've hit your session limit · resets 10:10pm"). Without them the
// message fell through to UNKNOWN_FATAL and the run aborted instead of
// hibernating until the reset.
// Decomposed by family (S5843, complexity 36 → 3 named groups). The
// union of tokens is identical to the original single alternation.
const RATE_LIMIT_GROUPS = [
  /rate\s*limit|too\s+many\s+requests|\b429\b|throttl/i,
  /exceeded\s+your\s+current\s+quota|resource\s+exhausted|quota\s+exceeded|token\s+limit\s+reached/i,
  /usage\s+limit|monthly\s+limit|weekly\s+limit|daily\s+limit|session\s+limit/i,
];
const RATE_LIMIT_PATTERNS = { test: (text) => RATE_LIMIT_GROUPS.some((re) => re.test(text)) };
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

  // 3. RATE_LIMIT con cooldown. Thresholds:
  //    cooldown > 7d  → MONTHLY (Anthropic Agent SDK $200/mes desde jun-2026)
  //    cooldown > 1h  → DAILY (Claude Pro daily, OpenAI rate-limit-by-day)
  //    cooldown <= 1h → SHORT (rate limit transitorio)
  if (RATE_LIMIT_PATTERNS.test(combined)) {
    const msg = pickMessage(combined, RATE_LIMIT_PATTERNS);
    const { cooldownUntil, cooldownMs } = parseCooldown(msg) ?? {};
    let quotaClass;
    if (cooldownMs != null && cooldownMs > ONE_WEEK_MS) quotaClass = ERROR_CLASS.QUOTA_EXHAUSTED_MONTHLY;
    else if (cooldownMs != null && cooldownMs > ONE_HOUR_MS) quotaClass = ERROR_CLASS.QUOTA_EXHAUSTED_DAILY;
    else quotaClass = ERROR_CLASS.RATE_LIMIT_SHORT;
    return {
      ...base,
      class: quotaClass,
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

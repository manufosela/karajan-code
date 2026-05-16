// KJC-TSK-0412: wrapper central de recovery. Cualquier stage que invoque
// un agente IA pasa por aquí. Brain consume classifyAgentError (TSK-0411)
// y decide: standby corto, backoff exponencial, hibernar, o abortar.
//
// Hibernar al disco (acción persistente) es TSK-0414 — esta PR devuelve
// { ok: false, action: "hibernate", retryUntil } cuando aplica; el caller
// puede ignorarlo (fallback a long standby capped) hasta que llegue 0414.

import { classifyAgentError, ERROR_CLASS } from "./agent-error-classifier.js";

const ONE_MIN = 60 * 1000;

export const DEFAULT_RECOVERY_POLICY = Object.freeze({
  hibernateThresholdMs: 5 * ONE_MIN, // > 5 min de espera → hibernar
  longStandbyCapMs: 10 * ONE_MIN,    // si el caller no hiberna, espera máx 10 min
  classes: {
    [ERROR_CLASS.RATE_LIMIT_SHORT]: { mode: "standby", maxRetries: 3 },
    [ERROR_CLASS.QUOTA_EXHAUSTED_DAILY]: { mode: "hibernate", maxRetries: 1 },
    [ERROR_CLASS.API_DOWN]: { mode: "backoff", maxRetries: 3, baseMs: 5_000, factor: 3, jitterPct: 0.2 },
    [ERROR_CLASS.NETWORK_TIMEOUT]: { mode: "backoff", maxRetries: 3, baseMs: 5_000, factor: 3, jitterPct: 0.2 },
    [ERROR_CLASS.SILENCED]: { mode: "backoff", maxRetries: 2, baseMs: 30_000, factor: 2, jitterPct: 0.15 },
    [ERROR_CLASS.AUTH_FAILED]: { mode: "abort", maxRetries: 0 },
    [ERROR_CLASS.UNKNOWN_FATAL]: { mode: "abort", maxRetries: 0 },
  },
});

function backoffDelay(policyForClass, attempt) {
  const { baseMs = 5_000, factor = 2, jitterPct = 0.1 } = policyForClass;
  const ms = baseMs * factor ** attempt;
  const jitter = ms * jitterPct * (Math.random() * 2 - 1);
  return Math.max(0, Math.round(ms + jitter));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function emit(emitter, type, eventBase, detail) {
  if (!emitter || typeof emitter.emit !== "function") return;
  try {
    emitter.emit("progress", { ...(eventBase || {}), type, detail });
  } catch { /* nunca bloquees un retry por un emitter mal */ }
}

/**
 * @param {object} args
 * @param {object} args.agent - Agent con runTask({...})
 * @param {object} args.taskArgs - args pasados a agent.runTask
 * @param {string} args.role - "planner" | "coder" | "reviewer" | ...
 * @param {string} [args.provider] - claude|codex|gemini|opencode (default: agent.provider)
 * @param {object} [args.policy] - override DEFAULT_RECOVERY_POLICY
 * @param {object} [args.emitter] - bus de eventos
 * @param {object} [args.eventBase]
 * @param {object} [args.logger]
 * @param {Function} [args.sleepFn] - inyectable para tests
 * @returns {Promise<{ ok: boolean, output?: string, action?: string, recovery?: object, error?: string }>}
 */
export async function withBrainRecovery({
  agent, taskArgs, role, provider,
  policy = DEFAULT_RECOVERY_POLICY,
  emitter, eventBase, logger,
  sleepFn = sleep,
}) {
  const effectiveProvider = provider || agent?.provider || "unknown";
  const attemptsByClass = {};

  while (true) {
    const result = await agent.runTask(taskArgs);
    if (result?.ok) return result;

    const cls = classifyAgentError({
      provider: effectiveProvider,
      stdout: result?.output || "",
      stderr: result?.error || "",
      exitCode: result?.exitCode ?? null,
    });
    const classPolicy = policy.classes[cls.class] || { mode: "abort", maxRetries: 0 };
    attemptsByClass[cls.class] = (attemptsByClass[cls.class] || 0) + 1;
    const attempt = attemptsByClass[cls.class];

    emit(emitter, "brain:agent-error", eventBase, { role, class: cls.class, attempt, message: cls.message, provider: effectiveProvider });
    logger?.warn?.(`[brain] ${role} (${effectiveProvider}) → ${cls.class} attempt ${attempt}/${classPolicy.maxRetries}: ${cls.message}`);

    // ABORT: no recuperable.
    if (classPolicy.mode === "abort" || attempt > classPolicy.maxRetries) {
      emit(emitter, "brain:fatal", eventBase, { role, class: cls.class, message: cls.message });
      return { ok: false, action: "abort", recovery: cls, error: `Brain aborted: ${cls.class} — ${cls.message}` };
    }

    // HIBERNATE: persistir+morir es TSK-0414. Aquí emitimos la señal y, si
    // el caller no maneja, hacemos long-standby capped (degradación graceful).
    if (classPolicy.mode === "hibernate" && cls.retryAfter && cls.retryAfter > policy.hibernateThresholdMs) {
      emit(emitter, "brain:hibernate-request", eventBase, { role, class: cls.class, retryUntil: cls.retryUntil, retryAfter: cls.retryAfter });
      return { ok: false, action: "hibernate", recovery: cls };
    }

    // STANDBY: espera hasta cooldownUntil (capado por longStandbyCapMs).
    if (classPolicy.mode === "standby") {
      const waitMs = Math.min(cls.retryAfter || ONE_MIN, policy.longStandbyCapMs);
      emit(emitter, "brain:standby", eventBase, { role, class: cls.class, waitMs, retryUntil: cls.retryUntil });
      await sleepFn(waitMs);
      continue;
    }

    // BACKOFF exponencial con jitter.
    if (classPolicy.mode === "backoff") {
      const waitMs = backoffDelay(classPolicy, attempt - 1);
      emit(emitter, "brain:backoff", eventBase, { role, class: cls.class, attempt, waitMs });
      await sleepFn(waitMs);
      continue;
    }

    // Modo desconocido — defensive abort.
    return { ok: false, action: "abort", recovery: cls, error: `Brain: unknown mode '${classPolicy.mode}' for class ${cls.class}` };
  }
}

// KJC-TSK-0412: wrapper central de recovery. Cualquier stage que invoque
// un agente IA pasa por aquí. Brain consume classifyAgentError (TSK-0411)
// y decide: standby corto, backoff exponencial, hibernar, o abortar.
//
// Hibernar al disco (acción persistente) es TSK-0414 — esta PR devuelve
// { ok: false, action: "hibernate", retryUntil } cuando aplica; el caller
// puede ignorarlo (fallback a long standby capped) hasta que llegue 0414.

import { classifyAgentError, ERROR_CLASS } from "./agent-error-classifier.js";
import { persistStandby, markStandbyDone } from "./standby-store.js";

const ONE_MIN = 60 * 1000;

const ONE_HOUR = 60 * 60 * 1000;
const DEFAULT_FALLBACK_WAIT_HOURS = 12;

export const DEFAULT_RECOVERY_POLICY = Object.freeze({
  hibernateThresholdMs: 5 * ONE_MIN, // > 5 min de espera → hibernar
  longStandbyCapMs: 10 * ONE_MIN,    // si el caller no hiberna, espera máx 10 min
  // KJC-TSK-0415: threshold de fallback. Si retryAfter > esto Y el role
  // tiene fallback configurado → switch provider en vez de hibernar.
  fallbackWaitHoursDefault: DEFAULT_FALLBACK_WAIT_HOURS,
  // Standby-in-process: when the cooldown is short enough we keep the
  // process alive and `await sleepFn(retryAfter)`, then retry the
  // agent. The user sees nothing terminal — kj just pauses. A SIGINT /
  // SIGTERM during the wait prints `kj standby resume <id>` and exits
  // cleanly. For waits longer than this the process exits straight
  // away (a multi-day weekly cap is not worth keeping kj running).
  standbyWaitHoursMax: DEFAULT_FALLBACK_WAIT_HOURS,
  classes: {
    [ERROR_CLASS.RATE_LIMIT_SHORT]: { mode: "standby", maxRetries: 3 },
    [ERROR_CLASS.QUOTA_EXHAUSTED_DAILY]: { mode: "hibernate", maxRetries: 1, fallbackEligible: true },
    [ERROR_CLASS.QUOTA_EXHAUSTED_MONTHLY]: { mode: "hibernate", maxRetries: 1, fallbackEligible: true },
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
  // En tests (VITEST / NODE_ENV=test) saltamos sleeps reales — los tests que
  // necesitan timing controlado inyectan sleepFn explícito. Esto evita que
  // tests de stages downstream que llaman a withBrainRecovery se cuelguen
  // esperando standby cuando el agente fake devuelve un error recoverable.
  if (process.env.VITEST || process.env.NODE_ENV === "test") return Promise.resolve();
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
  // TSK-0414 PR2: si presente, en hibernate persiste { sessionId, planId?, huId?,
  // argv?, ... } a ~/.kj/standby/<sessionId>.json y devuelve standbyFile en
  // el resultado.
  sessionState,
  // KJC-TSK-0415: fallback chain. Si QUOTA_EXHAUSTED_* con retryAfter
  // > maxWaitHours (default 12h) y hay fallback, switch en vez de hibernar.
  fallback = null,
}) {
  let effectiveAgent = agent;
  let effectiveProvider = provider || agent?.provider || "unknown";
  let effectiveFallback = fallback;
  const attemptsByClass = {};

  while (true) {
    const result = await effectiveAgent.runTask(taskArgs);
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

    // KJC-TSK-0415: ¿switch a fallback antes de hibernar?
    // Aplica si:
    //   - classPolicy.fallbackEligible (QUOTA_EXHAUSTED_*)
    //   - hay fallback configurado
    //   - retryAfter excede maxWaitHours del fallback (default 12h)
    if (classPolicy.fallbackEligible && effectiveFallback?.agent && cls.retryAfter) {
      const maxWaitMs = (effectiveFallback.maxWaitHours ?? policy.fallbackWaitHoursDefault ?? DEFAULT_FALLBACK_WAIT_HOURS) * ONE_HOUR;
      if (cls.retryAfter > maxWaitMs) {
        const from = effectiveProvider;
        const to = effectiveFallback.provider || effectiveFallback.agent.provider || "unknown";
        emit(emitter, "brain:fallback-switched", eventBase, { role, from, to, class: cls.class, retryAfter: cls.retryAfter, maxWaitMs });
        logger?.info?.(`[brain] ${role}: fallback ${from} → ${to} (retryAfter ${Math.round(cls.retryAfter/3600000)}h > maxWait ${maxWaitMs/3600000}h)`);
        // Switch al fallback. Reset attempts para que el nuevo provider
        // pueda fallar/retry independientemente. Fallback puede tener su
        // propio fallback en cadena.
        effectiveAgent = effectiveFallback.agent;
        effectiveProvider = to;
        effectiveFallback = effectiveFallback.fallback || null;
        for (const k of Object.keys(attemptsByClass)) attemptsByClass[k] = 0;
        continue;
      }
    }

    // HIBERNATE: the cooldown is too long for a short standby. Persist
    // the snapshot first so a SIGINT / SIGTERM during the wait leaves a
    // recoverable session on disk. Then either:
    //   (a) wait in-process until cooldownUntil and retry (the common
    //       case — daily quotas reset in a few hours), or
    //   (b) when the wait would exceed `standbyWaitHoursMax`, return
    //       action="hibernate" so the caller exits and the user
    //       resumes later with `kj standby resume <id>` (weekly /
    //       monthly caps).
    if (classPolicy.mode === "hibernate" && cls.retryAfter && cls.retryAfter > policy.hibernateThresholdMs) {
      let standbyFile = null;
      if (sessionState && sessionState.sessionId) {
        try {
          standbyFile = persistStandby({
            ...sessionState,
            cooldownUntil: cls.retryUntil,
            reason: cls.class,
            role, provider: effectiveProvider,
            classifierMessage: cls.message,
          });
        } catch (err) {
          logger?.warn?.(`[brain] failed to persist standby: ${err.message}`);
        }
      }

      const maxWaitMs = (policy.standbyWaitHoursMax ?? DEFAULT_FALLBACK_WAIT_HOURS) * ONE_HOUR;
      const tooLongToWait = cls.retryAfter > maxWaitMs;

      if (tooLongToWait) {
        logger?.info?.(`[brain] hibernated session ${sessionState?.sessionId ?? "(no id)"} → ${standbyFile} (resume at ${cls.retryUntil}; wait > ${Math.round(maxWaitMs/ONE_HOUR)}h, exiting)`);
        emit(emitter, "brain:hibernate-request", eventBase, { role, class: cls.class, retryUntil: cls.retryUntil, retryAfter: cls.retryAfter, standbyFile });
        return { ok: false, action: "hibernate", recovery: cls, standbyFile };
      }

      // Standby-in-process: keep kj alive, sleep until the cooldown,
      // then retry. A SIGINT / SIGTERM during the wait prints the
      // resume command and exits — the standby JSON is already on
      // disk so the user can pick it up later.
      const sid = sessionState?.sessionId ?? null;
      const onSignal = (signal) => {
        // eslint-disable-next-line no-console
        console.log(`\n⏸  Standby interrupted (${signal}). Resume with:`);
        // eslint-disable-next-line no-console
        if (sid) console.log(`     kj standby resume ${sid}`);
        // eslint-disable-next-line no-console
        else console.log(`     kj standby list   (no session id was assigned)`);
        process.exit(signal === "SIGINT" ? 130 : 143);
      };
      const detach = () => {
        process.removeListener("SIGINT", onSignal);
        process.removeListener("SIGTERM", onSignal);
      };
      process.once("SIGINT", onSignal);
      process.once("SIGTERM", onSignal);

      const hours = Math.round((cls.retryAfter / ONE_HOUR) * 10) / 10;
      logger?.info?.(`[brain] ${role}: standby for ~${hours}h until ${cls.retryUntil} (Ctrl+C to detach; will resume with 'kj standby resume ${sid}').`);
      emit(emitter, "brain:standby-wait", eventBase, { role, class: cls.class, waitMs: cls.retryAfter, retryUntil: cls.retryUntil, standbyFile });

      try {
        await sleepFn(cls.retryAfter);
      } finally {
        detach();
      }

      // Wait finished without an interrupt — mark the standby JSON
      // done so it does not auto-resume from disk later.
      if (sid) {
        try { markStandbyDone(sid); } catch { /* ignore */ }
      }
      emit(emitter, "brain:standby-resumed", eventBase, { role, class: cls.class });
      continue;
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

// KJ_SIMULATE_QUOTA — testing hook for the standby flow. See
// docs/quota-simulation.md. KJC-TSK-0493.

let _warned = false;

export function parseQuotaSimulationConfig(env = process.env) {
  const trigger = env.KJ_SIMULATE_QUOTA;
  if (!trigger) return null;
  const m = /^after-iter-(\d+)$/i.exec(String(trigger).trim());
  if (!m) {
    if (!_warned) {
      // eslint-disable-next-line no-console
      console.warn(`[KJ_SIMULATE_QUOTA] Ignoring malformed value "${trigger}". Expected "after-iter-<N>".`);
      _warned = true;
    }
    return null;
  }
  return {
    afterIter: Number.parseInt(m[1], 10),
    resetIso: env.KJ_SIMULATE_QUOTA_RESET || new Date(Date.now() + 3600_000).toISOString(),
    agent: String(env.KJ_SIMULATE_QUOTA_AGENT || "claude").toLowerCase(),
  };
}

const SYNTHETIC_MSG = {
  claude: (iso) => `[KJ_SIMULATE_QUOTA] Claude Pro usage limit reached. weekly limit. resets at ${iso}`,
  codex: () => `[KJ_SIMULATE_QUOTA] You have exceeded your current quota. retry after 60 seconds`,
  gemini: () => `[KJ_SIMULATE_QUOTA] Resource exhausted: quota exceeded. retry after 60 seconds`,
};

export function buildSyntheticQuotaMessage(agent, resetIso) {
  return (SYNTHETIC_MSG[agent] || SYNTHETIC_MSG.claude)(resetIso);
}

export function shouldSimulateQuota({ iteration, agent }, env = process.env) {
  const cfg = parseQuotaSimulationConfig(env);
  if (!cfg) return null;
  if (Number(iteration) < cfg.afterIter) return null;
  const a = String(agent || "").toLowerCase();
  if (cfg.agent !== "any" && cfg.agent !== a) return null;
  return { resetIso: cfg.resetIso, agent: a || cfg.agent };
}

// Mutates execResult: forces ok=false and prepends the synthetic quota
// line to result.error so the existing detectRateLimit branch fires.
export function applyQuotaSimulation(execResult, { iteration, agent }, env = process.env) {
  const fire = shouldSimulateQuota({ iteration, agent }, env);
  if (!fire || !execResult || typeof execResult !== "object") return false;
  if (!execResult.result || typeof execResult.result !== "object") execResult.result = {};
  execResult.result.error = `${buildSyntheticQuotaMessage(fire.agent, fire.resetIso)}\n${execResult.result.error || ""}`;
  execResult.ok = false;
  return true;
}

// Test seam — reset the one-shot warning between unit tests.
export function _resetSimulatorWarning() { _warned = false; }

// Resilient provider/model fallback for the `kj audit` CLI (KJC-BUG-0094).
// The CLI audit calls AuditRole.executeWithDeterministic directly, bypassing
// the orchestrator's recovery paths, so a dead configured model (e.g. an
// inherited "claude-fable-5") killed the command. The LLM phase now tries:
// configured provider+model → same provider default model → remaining known
// providers. First success wins; the deterministic context is reused.
import { resolveRole } from "../config.js";
import { AuditRole } from "../roles/audit-role.js";

const KNOWN_PROVIDERS = ["claude", "codex", "gemini"];

/** Ordered, de-duplicated fallback candidates for the audit role. */
export function buildAuditFallbackCandidates(config) {
  const effective = resolveRole(config, "audit");
  const primary = effective.provider || "claude";
  const candidates = [{ provider: primary, model: effective.model ?? null }];
  if (effective.model) candidates.push({ provider: primary, model: null });
  for (const p of KNOWN_PROVIDERS) {
    if (p !== primary) candidates.push({ provider: p, model: null });
  }
  const seen = new Set();
  return candidates.filter((c) => {
    const key = `${c.provider}::${c.model ?? ""}`;
    return seen.has(key) ? false : (seen.add(key), true);
  });
}

// Pin the audit role to a provider/model. Sets BOTH the per-role override and
// `coder_options.model` (the audit role inherits its model from the coder
// bucket); a null model neutralizes both so the provider default is used.
export function withAuditProvider(config, provider, model) {
  return {
    ...config,
    roles: { ...(config?.roles || {}), audit: { ...(config?.roles?.audit || {}), provider, model: model ?? undefined } },
    coder_options: { ...(config?.coder_options || {}), model: model ?? undefined },
  };
}

/** Run the audit LLM phase with automatic provider/model fallback. */
export async function runAuditWithFallback({
  config, logger, roleInput, deterministicCtx, available, candidates, onFallback, createRole,
}) {
  const makeRole = createRole || ((cfg) => new AuditRole({ config: cfg, logger }));
  const all = candidates || buildAuditFallbackCandidates(config);
  const usable = available ? all.filter((c) => available.includes(c.provider)) : all;
  if (usable.length === 0) {
    throw new Error("No available audit provider — install claude, codex, or gemini, or set roles.audit.provider");
  }

  let last = null;
  let attempts = 0;
  for (const cand of usable) {
    attempts += 1;
    if (attempts > 1) onFallback?.(cand, attempts);
    const role = makeRole(withAuditProvider(config, cand.provider, cand.model));
    const meta = { provider: cand.provider, model: cand.model ?? null };
    try {
      const result = await role.executeWithDeterministic(roleInput, deterministicCtx);
      if (result?.ok) return { ...result, ...meta, attempts };
      last = { ...result, ...meta };
    } catch (err) {
      last = { ok: false, result: { error: err.message, provider: cand.provider }, summary: `Audit failed: ${err.message}`, ...meta };
    }
  }
  return { ...last, attempts, exhausted: true };
}

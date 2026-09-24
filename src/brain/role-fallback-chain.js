/**
 * The declared chain, finally connected (KJC-TSK-0859).
 *
 * `roles.<role>.fallback` has been in the config schema since KJC-TSK-0415,
 * recursive and carrying a `model`, and `withBrainRecovery` has always known
 * how to walk it. Nothing ever built it: of the call sites that recover an
 * agent run, not one passed `fallback`. A wire laid and never connected.
 *
 * This builds it from config, one instantiated agent per link, so the user's
 * declared order is what runs. Each link may change the model, the provider or
 * both: a chain within one provider is the case the card asks for, and
 * crossing providers falls out for free.
 */
import { createAgent as defaultCreateAgent } from "../agents/index.js";
import { resolveRole } from "../config/role-resolver.js";

/** A chain longer than this is a config smell, not a plan. */
export const MAX_CHAIN_LINKS = 5;

/** The config a link runs with: same project, this link's provider and model. */
export function withRoleModel(config, role, provider, model) {
  return {
    ...config,
    roles: { ...config?.roles, [role]: { ...config?.roles?.[role], provider, model: model ?? null } },
  };
}

const keyOf = (provider, model) => `${provider}::${model ?? ""}`;

/**
 * @param {{config: object, role: string, agentMethod?: string,
 *   createAgentFn?: Function, logger?: object}} args
 * @returns {null|{agent: object, provider: string, model: string|null,
 *   maxWaitHours: number|undefined, fallback: object|null}}
 */
export function buildRoleFallbackChain({ config, role, agentMethod = "runTask", createAgentFn = defaultCreateAgent, logger = null }) {
  const primary = resolveRole(config, role);
  // The primary is already in play: a link repeating it would retry the same
  // thing and look like progress.
  const seen = new Set([keyOf(primary.provider, primary.model)]);

  const build = (link, depth) => {
    if (!link?.provider) return null;
    if (depth > MAX_CHAIN_LINKS) {
      logger?.warn?.(`[brain] ${role}: fallback chain longer than ${MAX_CHAIN_LINKS} links — the rest is ignored`);
      return null;
    }
    const key = keyOf(link.provider, link.model);
    if (seen.has(key)) {
      logger?.warn?.(`[brain] ${role}: fallback link ${key} repeats one already in the chain — skipped`);
      return build(link.fallback, depth + 1);
    }
    seen.add(key);
    let agent;
    try {
      agent = createAgentFn(link.provider, withRoleModel(config, role, link.provider, link.model), logger);
    } catch (err) {
      // An unknown provider in the chain is the user's typo, not a reason to
      // lose the links behind it. Said out loud, then skipped.
      logger?.warn?.(`[brain] ${role}: fallback link ${key} unusable (${err.message}) — skipped`);
      return build(link.fallback, depth + 1);
    }
    return {
      agent: { runTask: (args) => agent[agentMethod](args), provider: link.provider, model: link.model ?? null },
      provider: link.provider,
      model: link.model ?? null,
      maxWaitHours: link.max_wait_hours,
      fallback: build(link.fallback, depth + 1),
    };
  };

  const declared = build(config?.roles?.[role]?.fallback, 1);

  // KJC-TSK-0859: the provider's own default model is the last resort, and it
  // always was — every agent kept a private retry that dropped the pinned
  // model and tried again. Making it the chain's tail puts that step where the
  // user can see it, after the candidates they declared and never before.
  if (!primary.model) return declared;
  const tailKey = keyOf(primary.provider, null);
  if (seen.has(tailKey)) return declared;
  seen.add(tailKey);
  let tailAgent;
  try {
    tailAgent = createAgentFn(primary.provider, withRoleModel(config, role, primary.provider, null), logger);
  } catch {
    return declared; // the primary provider is already in use; if it cannot be
  }                   // built again, the declared chain is what we have.
  const tail = {
    agent: { runTask: (args) => tailAgent[agentMethod](args), provider: primary.provider, model: null },
    provider: primary.provider,
    model: null,
    maxWaitHours: undefined,
    fallback: null,
  };
  if (!declared) return tail;
  let last = declared;
  while (last.fallback) last = last.fallback;
  last.fallback = tail;
  return declared;
}

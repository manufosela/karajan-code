/**
 * KJC-TSK-0701 (MR-D): the model and effort the coder of an HU runs on. Its
 * tier (MR-A) picks them on the first iteration; after a failed one the coder
 * climbs to the most capable model. A model the user chose always wins, the
 * reviewer and Solomon are never routed, and model_routing.enabled: false turns
 * it off; model_routing.by_provider picks other models per level.
 */
import { getDefaultModelTiers, resolveModelForRole } from "../utils/model-selector.js";

const TIER_ROUTE = { trivial: { level: "trivial", effort: "low" }, standard: { level: "medium", effort: "medium" } };
const ESCALATED = { level: "complex", effort: "max" };
// Only claude's CLI takes --effort.
const EFFORT_PROVIDERS = new Set(["claude"]);

const userChoice = (config) => {
  if (config.model_routing?.enabled === false) return "model_routing.enabled is false";
  if (config.model_routing?.fixed?.coder) return `model_routing.fixed.coder is ${config.model_routing.fixed.coder}`;
  if (config.roles?.coder?.model) return `the coder model was chosen (${config.roles.coder.model})`;
  if (config.coder_options?.model) return `the coder model was chosen (${config.coder_options.model})`;
  if (config.model_profile) return `the model profile ${config.model_profile} was chosen`;
  return null;
};

const routed = ({ model, effort, escalated, why }) => ({ skip: false, model, effort, escalated, reason: `${why} -> ${model}${effort ? ` (effort ${effort})` : ""}` });

/**
 * KJC-TSK-1070: huModel is the HU's coder_model (kj plan fills it from the
 * tier, the user may change it on the board); it drives the first iteration.
 * @param {{ tier?: string, huModel?: string|null, attempt: number, config: object }} args
 * @returns {{ skip: true, reason: string } | { skip: false, model: string, effort: string|null, escalated: boolean, reason: string }}
 */
export function routeCoder({ tier, huModel = null, attempt, config }) {
  const chosen = userChoice(config);
  if (chosen) return { skip: true, reason: chosen };
  const provider = config.roles?.coder?.provider || config.coder;
  const effortOf = (route) => (EFFORT_PROVIDERS.has(provider) ? route?.effort ?? null : null);
  const escalated = attempt > 1;
  if (!escalated && huModel) return routed({ model: huModel, effort: effortOf(TIER_ROUTE[tier]), escalated, why: "the HU's coder_model" });
  const route = escalated ? ESCALATED : TIER_ROUTE[tier];
  if (!route) return { skip: true, reason: tier === "deep" ? "deep HU: the usual model and effort" : `no tier to route by (${tier ?? "none"})` };
  const tierMap = getDefaultModelTiers();
  for (const [name, levels] of Object.entries(config.model_routing?.by_provider ?? {})) tierMap[name] = { ...tierMap[name], ...levels };
  const model = resolveModelForRole({ role: "coder", provider, level: route.level, tierMap });
  if (!model) return { skip: true, reason: `${provider} has no known model for the ${route.level} level` };
  const why = escalated ? `iteration ${attempt} after a failed one: the most capable model` : `${tier} HU`;
  return routed({ model, effort: effortOf(route), escalated, why });
}

/**
 * HU-3533 (KJC-TSK-1445): the config kj code runs the coder with: the card's tier routed as kj
 * run's coder stage did (a model set on the board first), or the config as it is, and why.
 */
export function routedCoderConfig({ config, card, attempt = 1 }) {
  const route = routeCoder({ tier: card?.tier ?? undefined, huModel: card?.coderModel ?? null, attempt, config });
  if (route.skip) return { config, route: null, reason: route.reason };
  const coder = { ...config.roles?.coder, model: route.model, ...(route.effort ? { effort: route.effort } : {}) };
  return { config: { ...config, roles: { ...config.roles, coder } }, route, reason: route.reason };
}

/**
 * KJC-TSK-1070: the route of an HU's coder for this attempt, on its lane
 * config (coder_route, read by the coder stage); a skipped route clears it.
 */
export function applyCoderRoute({ laneConfig, story, attempt, config, logger }) {
  const route = routeCoder({ tier: story.complexity?.tier, huModel: story.coder_model || null, attempt, config });
  laneConfig.coder_route = route.skip ? null : { model: route.model, effort: route.effort };
  // KJC-TSK-1071 (MR-D3): the HU keeps its last decision, and whether it ever climbed.
  story.coder_routing = {
    tier: story.complexity?.tier ?? null,
    model: route.skip ? null : route.model,
    effort: route.skip ? null : route.effort,
    escalated: Boolean(story.coder_routing?.escalated || route.escalated),
    reason: route.reason,
  };
  logger.info(`HU ${story.id}: coder ${route.skip ? "not routed" : "routed"}: ${route.reason}`);
  return route;
}

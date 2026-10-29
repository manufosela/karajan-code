/**
 * Cost aggregator (Cost B — KJC-TSK-0513).
 *
 * Turns a list of token-usage events emitted by the orchestrator into
 * a USD breakdown for a single run / HU. The pipeline calls this once
 * when a HU finishes; the result is what Cost C will persist in
 * board.db and Cost E will expose as `/api/projects/:id/cost`.
 *
 * Inputs are deliberately permissive: any extra field on an event is
 * ignored. We only require `role`, `model`, `tokensIn`, `tokensOut`.
 *
 * Unknown models do NOT throw. Their token counts accumulate into
 * `unknownModelTokens` and the function returns a flag so the caller
 * can surface it in the UI (orange badge instead of `$X.XXXX`).
 */

import { getModelPricing } from "../pricing/index.js";

const DEFAULT_ROUND_DECIMALS = 4;

function round(n, decimals = DEFAULT_ROUND_DECIMALS) {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

function priceTokens(pricing, tokensIn, tokensOut) {
  const inUsd = (tokensIn / 1_000_000) * pricing.inputPerMTok;
  const outUsd = (tokensOut / 1_000_000) * pricing.outputPerMTok;
  return inUsd + outUsd;
}

/**
 * Aggregate cost of a run.
 *
 * @param {object} args
 * @param {Array<{role:string, model:string, tokensIn:number, tokensOut:number}>} args.events
 * @param {(level:"warn"|"info", msg:string, ctx?:object)=>void} [args.logger]
 *        Optional structured logger. When a model is unknown we call
 *        logger("warn", ...) so the user sees it once per run.
 * @returns {{
 *   totalUsd:number,
 *   byRole:Record<string,number>,
 *   byModel:Record<string,number>,
 *   unknownModelTokens:{ tokensIn:number, tokensOut:number, models:string[] },
 *   hasUnknown:boolean,
 *   currency:string
 * }}
 */
/** KJC-TSK-1274: an event's fields with their safe defaults, or null when it carries no tokens. */
function usageOf(ev) {
  if (!ev || typeof ev !== "object") return null;
  const tokensIn = Number.isFinite(ev.tokensIn) ? ev.tokensIn : 0;
  const tokensOut = Number.isFinite(ev.tokensOut) ? ev.tokensOut : 0;
  if (tokensIn === 0 && tokensOut === 0) return null;
  return {
    role: typeof ev.role === "string" && ev.role.length > 0 ? ev.role : "unknown",
    model: typeof ev.model === "string" ? ev.model : "",
    tokensIn,
    tokensOut,
  };
}

const roundedValues = (totals) => Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, round(v)]));

export function aggregateRunCost({ events, logger } = {}) {
  const safeEvents = Array.isArray(events) ? events : [];
  const byRole = {};
  const byModel = {};
  const unknownModels = new Set();
  let totalUsd = 0;
  let unknownIn = 0;
  let unknownOut = 0;

  for (const ev of safeEvents) {
    const usage = usageOf(ev);
    if (!usage) continue;
    const { role, model, tokensIn, tokensOut } = usage;
    const pricing = getModelPricing(model);
    if (!pricing) {
      unknownIn += tokensIn;
      unknownOut += tokensOut;
      if (model.length > 0) unknownModels.add(model);
      if (typeof logger === "function") {
        logger("warn", "cost-aggregator: unknown model pricing", { model, role, tokensIn, tokensOut });
      }
      continue;
    }

    const cost = priceTokens(pricing, tokensIn, tokensOut);
    totalUsd += cost;
    byRole[role] = (byRole[role] || 0) + cost;
    byModel[model] = (byModel[model] || 0) + cost;
  }

  return {
    totalUsd: round(totalUsd),
    byRole: roundedValues(byRole),
    byModel: roundedValues(byModel),
    unknownModelTokens: {
      tokensIn: unknownIn,
      tokensOut: unknownOut,
      models: Array.from(unknownModels).sort(),
    },
    hasUnknown: unknownIn > 0 || unknownOut > 0,
    currency: "USD",
  };
}

/**
 * HU-3533 (KJC-TSK-1445): the tier an HU is created with. The agent that plans judges it
 * (`kj hu add --tier`), as kj plan's decomposition did. The judged tier wins; kj's signal
 * (complexity-tier.js deterministicTier) only raises it to deep for a sensitive zone. The
 * acceptance criteria count does not raise a judged tier. No judged tier, no tier stored:
 * kj says how to give one instead of guessing it.
 */
import { TIERS, deterministicTier } from "./complexity-tier.js";

export const NO_TIER_HINT = "⚠ no tier: judge it with --tier trivial|standard|deep --tier-reason \"<why>\", so kj code writes it with the model it needs";

/** A card's tier however its board keeps it: the local board's complexity, a manager's tier, or null. */
export const tierOfHu = (hu) => hu?.complexity?.tier ?? hu?.tier?.level ?? null;

/** The tier to store for a new HU, { level, reason }, or null when none was judged. */
export function tierOfNewHu({ title, acceptanceCriteria = [], tier, tierReason }) {
  if (tier === undefined || tier === null || tier === "") return null;
  if (!TIERS.includes(tier)) throw new Error(`--tier must be one of ${TIERS.join(", ")}: got "${tier}"`);
  const judgedText = `judged ${tier} (${tierReason || "no reason given"})`;
  const signal = deterministicTier({ title, goal: "", acceptanceCriteria });
  if (signal.tier !== "deep") return { level: tier, reason: judgedText };
  return { level: "deep", reason: `${signal.reason} over ${judgedText}` };
}

/**
 * createAutonomyAskQuestion — make the stages' question function non-blocking in
 * autonomous mode (KJC-TSK-0576, AUTO-E, design in docs/specs/autonomous-delivery.md §9).
 *
 * In `autonomous` no stage asks a human or routes to the HU Board: the wrapper
 * answers in-process with the least-bad "keep going" choice, so the run never
 * pauses or aborts mid-loop. interactive and assisted keep the human prompts
 * (baseAsk) unchanged.
 *
 * The answer is chosen per stage so the EXISTING branches proceed (verified
 * against the stage code — no stage logic is touched):
 *   - architect clarification: null → the stage continues best-effort (a truthy
 *     answer would force a wasteful architect re-run).
 *   - everything else (Solomon escalation, checkpoint, …): "continue" → parsed
 *     as free-text guidance → the stage continues instead of pausing/aborting.
 */
export function createAutonomyAskQuestion({ baseAsk = null, autonomy = "interactive", logger = console } = {}) {
  if (autonomy !== "autonomous") return baseAsk;
  const auto = async (_question, context = {}) => {
    const stage = context?.stage ?? null;
    logger?.info?.(`[autonomy] ${stage ? `${stage}: ` : ""}auto-continue (no human in the loop)`);
    return stage === "architect" ? null : "continue";
  };
  auto.interactive = false;
  // Marker so the orchestrator can tell an autonomous (unattended) run from an
  // interactive one even though both carry a truthy askQuestion — the wall-clock
  // backstop relies on it (KJC-TSK-0575, AUTO-D).
  auto.unattended = true;
  return auto;
}

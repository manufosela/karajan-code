import { ReviewerRole } from "../roles/reviewer-role.js";
import { createAgent } from "../agents/index.js";
import { addCheckpoint } from "../session-store.js";

export async function runReviewerWithFallback({ reviewerName, config, logger, emitter, reviewInput, session, iteration, onAttemptResult }) {
  const fallbackReviewer = config.reviewer_options?.fallback_reviewer;
  const retries = Math.max(0, Number(config.reviewer_options?.retries ?? 1));
  const candidates = [reviewerName];
  if (fallbackReviewer && fallbackReviewer !== reviewerName) {
    candidates.push(fallbackReviewer);
  }

  const attempts = [];
  for (const name of candidates) {
    const reviewerConfig = { ...config, roles: { ...config.roles, reviewer: { ...config.roles?.reviewer, provider: name } } };
    const role = new ReviewerRole({ config: reviewerConfig, logger, emitter, createAgentFn: createAgent });
    await role.init();
    for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
      let execResult;
      try {
        execResult = await role.execute(reviewInput);
      } catch (err) {
        logger.warn(`Reviewer ${name} attempt ${attempt} threw: ${err.message}`);
        execResult = { ok: false, result: { error: err.message }, summary: `Reviewer error: ${err.message}` };
      }
      if (onAttemptResult) {
        await onAttemptResult({ reviewer: name, result: execResult.result });
      }
      attempts.push({ reviewer: name, attempt, ok: execResult.ok, result: execResult.result, execResult });
      await addCheckpoint(session, {
        stage: "reviewer-attempt",
        iteration,
        reviewer: name,
        attempt,
        ok: execResult.ok
      });

      if (execResult.ok) {
        return { execResult, attempts };
      }
    }
  }

  return { execResult: null, attempts };
}

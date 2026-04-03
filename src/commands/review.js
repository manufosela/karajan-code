import { createAgent } from "../agents/index.js";
import { assertAgentsAvailable } from "../agents/availability.js";
import { computeBaseRef, generateDiff } from "../review/diff-generator.js";
import { buildReviewerPrompt } from "../prompts/reviewer.js";
import { resolveRole } from "../config.js";
import { resolveReviewProfile } from "../review/profiles.js";

export async function reviewCommand({ task, config, logger, baseRef }) {
  const reviewerRole = resolveRole(config, "reviewer");
  await assertAgentsAvailable([reviewerRole.provider]);
  logger.info(`Reviewer (${reviewerRole.provider}) starting...`);
  const reviewer = createAgent(reviewerRole.provider, config, logger);

  let diff;
  if (config.ci?.enabled) {
    // CI mode: read diff from open PR
    const { detectRepo, detectPrNumber } = await import("../ci/repo.js");
    const { getPrDiff } = await import("../ci/pr-diff.js");
    const repo = await detectRepo();
    const prNumber = await detectPrNumber();
    if (!prNumber) {
      throw new Error("CI enabled but no open PR found for current branch. Create a PR first or disable CI.");
    }
    logger.info(`CI: reading PR diff #${prNumber}`);
    diff = await getPrDiff(prNumber);
    // Store for dispatch later
    config._ci_pr = { repo, prNumber };
  } else {
    const resolvedBase = await computeBaseRef({ baseBranch: config.base_branch, baseRef });
    diff = await generateDiff({ baseRef: resolvedBase });
  }

  const { rules } = await resolveReviewProfile({ mode: config.review_mode, projectDir: process.cwd() });

  const prompt = await buildReviewerPrompt({ task, diff, reviewRules: rules, mode: config.review_mode });
  const onOutput = ({ line }) => process.stdout.write(`${line}\n`);
  const result = await reviewer.reviewTask({ prompt, onOutput, role: "reviewer" });
  if (!result.ok) {
    if (result.error) logger.error(result.error);
    throw new Error(result.error || result.output || `Reviewer failed (exit ${result.exitCode})`);
  }
  console.log(result.output);
  logger.info(`Reviewer completed (exit ${result.exitCode})`);

  // CI: dispatch review result
  if (config.ci?.enabled && config._ci_pr) {
    try {
      const { dispatchReview, dispatchComment } = await import("../ci/dispatch.js");
      const { repo, prNumber } = config._ci_pr;
      const bc = config.ci;

      // Try to parse structured review from output
      let review;
      try {
        review = JSON.parse(result.output);
      } catch { /* output is not JSON */
        review = { approved: true, summary: result.output };
      }

      const event = review.approved ? "APPROVE" : "REQUEST_CHANGES";
      await dispatchReview({
        repo, prNumber, event,
        body: review.summary || result.output.slice(0, 500),
        agent: "Reviewer", ciConfig: bc
      });

      await dispatchComment({
        repo, prNumber, agent: "Reviewer",
        body: `Standalone review: ${event}\n\n${review.summary || result.output.slice(0, 1000)}`,
        ciConfig: bc
      });

      logger.info(`CI: dispatched review for PR #${prNumber}`);
    } catch (err) {
      logger.warn(`CI dispatch failed (non-blocking): ${err.message}`);
    }
  }
}

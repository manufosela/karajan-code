import { createAgent } from "../agents/index.js";
import { assertAgentsAvailable } from "../agents/availability.js";
import { computeBaseRef, generateDiff } from "../review/diff-generator.js";
import { buildReviewerPrompt } from "../prompts/reviewer.js";
import { resolveRole } from "../config.js";
import { resolveReviewProfile } from "../review/profiles.js";

export async function reviewCommand({ task, config, logger, baseRef }) {
  const reviewerRole = resolveRole(config, "reviewer");
  await assertAgentsAvailable([reviewerRole.provider, config.reviewer_options?.fallback_reviewer]);
  logger.info(`Reviewer (${reviewerRole.provider}) starting...`);
  const reviewer = createAgent(reviewerRole.provider, config, logger);

  let diff;
  if (config.becaria?.enabled) {
    // BecarIA mode: read diff from open PR
    const { detectRepo, detectPrNumber } = await import("../becaria/repo.js");
    const { getPrDiff } = await import("../becaria/pr-diff.js");
    const repo = await detectRepo();
    const prNumber = await detectPrNumber();
    if (!prNumber) {
      throw new Error("BecarIA enabled but no open PR found for current branch. Create a PR first or disable BecarIA.");
    }
    logger.info(`BecarIA: reading PR diff #${prNumber}`);
    diff = await getPrDiff(prNumber);
    // Store for dispatch later
    config._becaria_pr = { repo, prNumber };
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

  // BecarIA: dispatch review result
  if (config.becaria?.enabled && config._becaria_pr) {
    try {
      const { dispatchReview, dispatchComment } = await import("../becaria/dispatch.js");
      const { repo, prNumber } = config._becaria_pr;
      const bc = config.becaria;

      // Try to parse structured review from output
      let review;
      try {
        review = JSON.parse(result.output);
      } catch {
        review = { approved: true, summary: result.output };
      }

      const event = review.approved ? "APPROVE" : "REQUEST_CHANGES";
      await dispatchReview({
        repo, prNumber, event,
        body: review.summary || result.output.slice(0, 500),
        agent: "Reviewer", becariaConfig: bc
      });

      await dispatchComment({
        repo, prNumber, agent: "Reviewer",
        body: `Standalone review: ${event}\n\n${review.summary || result.output.slice(0, 1000)}`,
        becariaConfig: bc
      });

      logger.info(`BecarIA: dispatched review for PR #${prNumber}`);
    } catch (err) {
      logger.warn(`BecarIA dispatch failed (non-blocking): ${err.message}`);
    }
  }
}

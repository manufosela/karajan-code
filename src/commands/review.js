import fs from "node:fs/promises";
import { createAgent } from "../agents/index.js";
import { assertAgentsAvailable } from "../agents/availability.js";
import { computeBaseRef, generateDiff } from "../review/diff-generator.js";
import { buildReviewerPrompt } from "../prompts/reviewer.js";
import { resolveRole } from "../config.js";

export async function reviewCommand({ task, config, logger, baseRef }) {
  const reviewerRole = resolveRole(config, "reviewer");
  await assertAgentsAvailable([reviewerRole.provider, config.reviewer_options?.fallback_reviewer]);
  logger.info(`Reviewer (${reviewerRole.provider}) starting...`);
  const reviewer = createAgent(reviewerRole.provider, config, logger);
  const resolvedBase = await computeBaseRef({ baseBranch: config.base_branch, baseRef });
  const diff = await generateDiff({ baseRef: resolvedBase });
  let rules = "Focus on critical issues only.";
  try {
    rules = await fs.readFile(config.review_rules, "utf8");
  } catch {
    // no-op
  }

  const prompt = buildReviewerPrompt({ task, diff, reviewRules: rules, mode: config.review_mode });
  const onOutput = ({ line }) => process.stdout.write(`${line}\n`);
  const result = await reviewer.reviewTask({ prompt, onOutput, role: "reviewer" });
  if (!result.ok) {
    if (result.error) logger.error(result.error);
    throw new Error(result.error || result.output || `Reviewer failed (exit ${result.exitCode})`);
  }
  console.log(result.output);
  logger.info(`Reviewer completed (exit ${result.exitCode})`);
}

import fs from "node:fs/promises";
import { createAgent } from "../agents/index.js";
import { assertAgentsAvailable } from "../agents/availability.js";
import { computeBaseRef, generateDiff } from "../review/diff-generator.js";
import { buildReviewerPrompt } from "../prompts/reviewer.js";

export async function reviewCommand({ task, config, logger, baseRef }) {
  await assertAgentsAvailable([config.reviewer, config.reviewer_options?.fallback_reviewer]);
  const reviewer = createAgent(config.reviewer, config, logger);
  const resolvedBase = await computeBaseRef({ baseBranch: config.base_branch, baseRef });
  const diff = await generateDiff({ baseRef: resolvedBase });
  let rules = "Focus on critical issues only.";
  try {
    rules = await fs.readFile(config.review_rules, "utf8");
  } catch {
    // no-op
  }

  const prompt = buildReviewerPrompt({ task, diff, reviewRules: rules, mode: config.review_mode });
  const result = await reviewer.reviewTask({ prompt });
  if (!result.ok) {
    throw new Error(result.error || result.output || "Reviewer failed");
  }
  console.log(result.output);
}

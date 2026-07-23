/**
 * One-shot cross-AI review (ENV-B1, KJC-TSK-0637) — the v4 primitive.
 *
 * The HOST agent (Claude Code, Codex) orchestrates the work; Karajan
 * routes the review to a DIFFERENT AI and records the verdict tied to
 * the exact diff (verdict-store). No cross-AI reviewer available is an
 * error, never a silent fallback to the host: without a second pair of
 * eyes there is no verdict, and without a verdict the pre-commit gate
 * (ENV-C) keeps the commit out.
 */
import { createAgent } from "../agents/index.js";
import { resolveRole } from "../config/role-resolver.js";
import { buildReviewerPrompt } from "../prompts/reviewer.js";
import { resolveReviewProfile } from "./profiles.js";
import { parseMaybeJsonString } from "./parser.js";
import { detectAvailableAgents, detectHostAgent } from "../utils/agent-detect.js";
import { saveVerdict } from "./verdict-store.js";
import { detectWorkspace } from "./workspace.js";

// Cross-AI preference when the configured reviewer IS the host.
const CROSS_ORDER = ["codex", "claude", "gemini", "opencode", "aider"];

/**
 * Pick a reviewer that is NOT the host agent.
 * @returns {Promise<string|null>} provider name, or null if none exists.
 */
export async function pickCrossReviewer({ config, hostAgent, detectAgents = detectAvailableAgents }) {
  const configured = resolveRole(config, "reviewer").provider;
  if (configured && configured !== hostAgent) return configured;

  const agents = await detectAgents();
  const candidates = agents
    .filter((a) => a.available && a.name !== hostAgent)
    .map((a) => a.name);
  return CROSS_ORDER.find((name) => candidates.includes(name)) || candidates[0] || null;
}

/**
 * Review a raw diff with a cross-AI reviewer and persist the verdict.
 * @returns {Promise<object>} the stored verdict record.
 */
export async function runOneShotReview({
  diff, task, config, logger, projectDir,
  hostAgent = detectHostAgent(),
  createAgentFn = createAgent,
  detectAgents = detectAvailableAgents,
}) {
  if (!diff || !diff.trim()) {
    throw new Error("nothing to review — the diff is empty (stage your changes or pass --range)");
  }

  const reviewer = await pickCrossReviewer({ config, hostAgent, detectAgents });
  if (!reviewer) {
    throw new Error(
      `cross-AI review requires an agent other than the host (${hostAgent || "unknown"}) — install codex, claude or another supported CLI`
    );
  }

  const { rules } = await resolveReviewProfile({ mode: "standard", projectDir });
  const prompt = await buildReviewerPrompt({
    task: task || "Review the following diff for correctness, security and maintainability.",
    diff, reviewRules: rules, mode: "standard", provider: reviewer, projectDir,
  });

  logger?.info?.(`kj review: host=${hostAgent || "none"} → reviewer=${reviewer} (cross-AI)`);
  const agent = createAgentFn(reviewer, config, logger);
  const result = await agent.reviewTask({ prompt, role: "reviewer" });
  if (!result?.ok) {
    throw new Error(`reviewer ${reviewer} failed: ${result?.error || "no output"}`);
  }

  const parsed = parseMaybeJsonString(result.output);
  if (!parsed || typeof parsed.approved !== "boolean") {
    throw new Error(`reviewer ${reviewer} returned no parseable verdict`);
  }

  return saveVerdict(projectDir, diff, {
    verdict: parsed.approved ? "approved" : "rejected",
    reviewer,
    host: hostAgent || null,
    // KJC-TSK-0680: where the review ran — makes any isolation claim auditable.
    workspace: await detectWorkspace(projectDir),
    issues: parsed.blocking_issues || [],
    suggestions: parsed.non_blocking_suggestions || [],
    summary: parsed.summary || parsed.raw_summary || "",
    confidence: parsed.confidence ?? null,
  });
}

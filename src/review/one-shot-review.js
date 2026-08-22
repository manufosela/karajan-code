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
import { saveVerdict, diffHash } from "./verdict-store.js";
import { reportUnparseableVerdict } from "./unparseable-verdict.js";
import { detectWorkspace } from "./workspace.js";
import { isQuotaExhausted, candidateStatus, pickQuotaFallback, formatCandidateMenu } from "./reviewer-fallback.js";

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
  candidateStatusFn = candidateStatus,
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
  const attempt = async (who, cfg = config) => {
    const prompt = await buildReviewerPrompt({
      task: task || "Review the following diff for correctness, security and maintainability.",
      diff, reviewRules: rules, mode: "standard", provider: who, projectDir,
    });
    logger?.info?.(`kj review: host=${hostAgent || "none"} → reviewer=${who} (cross-AI)`);
    return createAgentFn(who, cfg, logger).reviewTask({ prompt, role: "reviewer" });
  };

  let activeReviewer = reviewer;
  let result = await attempt(activeReviewer);

  // KJC-TSK-0730 — quota failover: exhausted quota is not a review failure,
  // it is a provider outage. One retry with an authenticated candidate
  // (loud notice, never silent), or an actionable menu. Never the host:
  // the brain does not review itself.
  if (!result?.ok && isQuotaExhausted(result?.error) && (config?.reviewer_options?.auto_fallback ?? true)) {
    const statuses = await candidateStatusFn();
    const fallback = pickQuotaFallback(statuses, { exclude: [activeReviewer, hostAgent].filter(Boolean) });
    if (fallback) {
      logger?.warn?.(
        `⚠ reviewer ${activeReviewer} sin cuota → usando ${fallback} SOLO en esta invocación. ` +
        `Para fijarlo: roles.reviewer.provider: ${fallback} (avisando, nunca en silencio — KJC-TSK-0730).`
      );
      activeReviewer = fallback;
      // The role's model pin belongs to the exhausted provider (a codex
      // model name means nothing to copilot) — the candidate runs on its
      // own default model.
      result = await attempt(activeReviewer, {
        ...config,
        roles: { ...config?.roles, reviewer: { ...config?.roles?.reviewer, model: null } },
      });
    } else {
      throw new Error(
        `reviewer ${activeReviewer} sin cuota y ningún candidato autenticado con adaptador.\n` +
        formatCandidateMenu(statuses, { exclude: [hostAgent].filter(Boolean) })
      );
    }
  }

  if (!result?.ok) {
    throw new Error(`reviewer ${activeReviewer} failed: ${result?.error || "no output"}`);
  }

  const parsed = parseMaybeJsonString(result.output);
  if (!parsed || typeof parsed.approved !== "boolean") {
    // KJC-BUG-0146: keep the answer. Throwing it away is what left eight occurrences undiagnosed.
    throw new Error(await reportUnparseableVerdict({ projectDir, reviewer: activeReviewer, output: result.output, hash: diffHash(diff) }));
  }

  return saveVerdict(projectDir, diff, {
    verdict: parsed.approved ? "approved" : "rejected",
    reviewer: activeReviewer,
    host: hostAgent || null,
    // KJC-TSK-0680: where the review ran — makes any isolation claim auditable.
    workspace: await detectWorkspace(projectDir),
    issues: parsed.blocking_issues || [],
    suggestions: parsed.non_blocking_suggestions || [],
    summary: parsed.summary || parsed.raw_summary || "",
    confidence: parsed.confidence ?? null,
  });
}

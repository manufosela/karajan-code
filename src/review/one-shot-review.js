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
import { traceActivity } from "../agents/activity.js";
import { resolveRole } from "../config/role-resolver.js";
import { buildReviewerPrompt } from "../prompts/reviewer.js";
import { resolveReviewProfile } from "./profiles.js";
import { parseReviewVerdict } from "./parser.js";
import { detectAvailableAgents, detectHostAgent } from "../utils/agent-detect.js";
import { accountLabel } from "../utils/agent-home.js";
import { saveVerdict, diffHash } from "./verdict-store.js";
import { summarizeGeneratedFiles } from "./prompt-diff.js";
import { diffFacts, formatDiffFacts } from "./diff-facts.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { reportUnparseableVerdict } from "./unparseable-verdict.js";
import { verdictSchemaProblems } from "./verdict-schema.js";
import { detectWorkspace } from "./workspace.js";
import { branchOf } from "./correction-rounds.js";
import { isQuotaExhausted, candidateStatus, pickQuotaFallback, formatCandidateMenu, reviewerFailureMessage } from "./reviewer-fallback.js";
import { recordRoleActing } from "./active-panel.js";
import { projectFileReader, splitFindings, unanchoredNote } from "./unanchored-findings.js";

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

const needsQuotaFailover = (result, config) =>
  !result?.ok && isQuotaExhausted(result?.error) && (config?.reviewer_options?.auto_fallback ?? true);

// The role's model pin belongs to the declared provider (a codex model name means nothing to
// copilot): any other reviewer runs on its own default model.
const withoutModelPin = (config) => ({ ...config, roles: { ...config?.roles, reviewer: { ...config?.roles?.reviewer, model: null } } });

// HU-4837: a rejection that holds only findings that do not anchor.
const onlyUnanchored = (split) => split.blocking.length === 0 && split.unanchored.length > 0;

// KJC-TSK-0730 — quota failover: exhausted quota is not a review failure,
// it is a provider outage. One retry with an authenticated candidate
// (loud notice, never silent), or an actionable menu. Never the host:
// the brain does not review itself. HU-4837: asked again from a fallback,
// the declared reviewer is already known out of quota, so it is skipped too.
async function quotaFailover({ reviewer, declared = reviewer, hostAgent, config, logger, candidateStatusFn, attempt }) {
  const statuses = await candidateStatusFn();
  const fallback = pickQuotaFallback(statuses, { exclude: [reviewer, declared, hostAgent].filter(Boolean) });
  if (!fallback) {
    throw new Error(
      `reviewer ${reviewer} sin cuota y ningún candidato autenticado con adaptador.\n` +
      formatCandidateMenu(statuses, { exclude: [hostAgent].filter(Boolean) })
    );
  }
  logger?.warn?.(
    // HU-4525: the substitution never sticks, so nothing has to be undone once the quota is back.
    `⚠ reviewer ${reviewer} sin cuota → usando ${fallback} SOLO en esta invocación; ` +
    `the next review tries ${declared} again. Do not pin ${fallback} in the config for this (KJC-TSK-0730).`
  );
  const result = await attempt(fallback, withoutModelPin(config));
  return { result, activeReviewer: fallback };
}

/**
 * Review a raw diff with a cross-AI reviewer and persist the verdict.
 * @returns {Promise<object>} the stored verdict record.
 */
export async function runOneShotReview({
  diff, task, config, logger, projectDir,
  // KJC-TSK-0838: what the sonar pre-gate saw, persisted with the verdict.
  sonar = null,
  // KJC-TSK-0849 (ADR 0010): what the session's RAG ledger proved, same place.
  rag = null,
  // BOOT-D (KJC-TSK-0863): the walkthrough of what a person sees, same place.
  ui = null,
  hostAgent = detectHostAgent(),
  createAgentFn = createAgent,
  detectAgents = detectAvailableAgents,
  candidateStatusFn = candidateStatus,
  // KJC-TSK-1075: a third-party PR is not the host's own work, so the reviewer
  // it names runs even if it is the host; and nothing is stored, so the
  // review can never unlock a commit of one's own.
  reviewerOverride = null,
  persist = true,
  env = process.env,
  // KJC-TSK-1272: skills resolved by the caller (a third-party repo's stack) instead of the project's.
  skills = null,
  // HU-4032: what the reviewer reads when it is less than the diff; the verdict still binds to the whole diff.
  shown = null,
  // HU-4524: which agent acted as reviewer, for kj stage.
  recordActive = recordRoleActing,
}) {
  if (!diff || !diff.trim()) {
    throw new Error("nothing to review — the diff is empty (stage your changes or pass --range)");
  }

  const reviewer = reviewerOverride || await pickCrossReviewer({ config, hostAgent, detectAgents });
  if (!reviewer) {
    throw new Error(
      `cross-AI review requires an agent other than the host (${hostAgent || "unknown"}) — install codex, claude or another supported CLI`
    );
  }

  const { rules } = await resolveReviewProfile({ mode: "standard", projectDir });
  // KJC-TSK-1380 (#3207): facts computed without a model; the reviewer starts from them.
  const facts = diffFacts(diff, { readFile: (p) => readFileSync(join(projectDir || process.cwd(), p), "utf8") });
  const attempt = async (who, cfg = config, note = "") => {
    const prompt = await buildReviewerPrompt({
      task: task || "Review the following diff for correctness, security and maintainability.",
      // KJC-BUG-0347: generated files summarized; the verdict still binds to the full diff.
      diff: summarizeGeneratedFiles(shown ?? diff), reviewRules: rules, mode: "standard", provider: who, projectDir, roleSkillBlock: skills,
      factsBlock: formatDiffFacts(facts),
    }) + note;
    // KJC-TSK-1344: with two subscriptions per CLI, say which account reviews.
    const account = accountLabel(who, { env });
    logger?.info?.(`kj review: host=${hostAgent || "none"} → reviewer=${who} (cross-AI)${account ? ` [${account}]` : ""}`);
    return traceActivity(createAgentFn(who, cfg, logger), { name: who, role: "reviewer", projectDir, logger, config: cfg }).reviewTask({ prompt, role: "reviewer" });
  };

  // HU-4837: every question to the reviewer, the one asked again included, fails over the same
  // way on exhausted quota, and its verdict names the reviewer that actually answered it.
  const ask = async (who, note = "") => {
    const answer = await attempt(who, who === reviewer ? config : withoutModelPin(config), note);
    const { result, activeReviewer } = needsQuotaFailover(answer, config)
      ? await quotaFailover({ reviewer: who, declared: reviewer, hostAgent, config, logger, candidateStatusFn, attempt: (fallback, cfg) => attempt(fallback, cfg, note) })
      : { result: answer, activeReviewer: who };
    if (!result?.ok) {
      throw new Error(reviewerFailureMessage(activeReviewer, result?.error, { account: accountLabel(activeReviewer, { env }) }));
    }
    // A third-party review stores nothing, the panel included.
    if (persist) recordActive({ role: "reviewer", declared: reviewer, acting: activeReviewer });
    // KJC-BUG-0146, second half: parseMaybeJsonString only PARSES — it returns whatever JSON came
    // back, wrapper and all. Yesterday's fix taught normalizeReviewPayload to unwrap {ok, result},
    // but this path never called it, so the bug survived with a green test on the wrong function.
    // A test can only prove the code it actually exercises.
    return { activeReviewer, parsed: await parseVerdictAnswer(result, { config, projectDir, diff, reviewer: activeReviewer }) };
  };

  let { activeReviewer, parsed } = await ask(reviewer);
  // HU-4837: what does not anchor is kept apart; a rejection made only of it is asked again once.
  const readFile = projectFileReader(projectDir);
  const splitOf = (verdict) => (verdict.approved ? { blocking: [], unanchored: [] } : splitFindings(verdict.blocking_issues, { diff, readFile }));
  let split = splitOf(parsed);
  if (onlyUnanchored(split)) {
    ({ activeReviewer, parsed } = await ask(activeReviewer, unanchoredNote(split.unanchored)));
    split = splitOf(parsed);
  }

  const record = await verdictRecord(parsed, { reviewer: activeReviewer, hostAgent, projectDir, sonar, rag, ui });
  if (!parsed.approved) {
    record.issues = split.blocking;
    record.unanchored = split.unanchored;
    if (onlyUnanchored(split)) record.reason = "unanchored-only";
  }
  if (facts.length > 0) record.facts = facts;
  return persist ? saveVerdict(projectDir, diff, record) : record;
}

async function parseVerdictAnswer(result, { config, projectDir, diff, reviewer }) {
  const parsed = parseReviewVerdict(result.output);
  if (!parsed || typeof parsed.approved !== "boolean") {
    // KJC-BUG-0146: keep the answer. Throwing it away is what left eight occurrences undiagnosed.
    throw new Error(await reportUnparseableVerdict({ projectDir, reviewer, output: result.output, hash: diffHash(diff) }));
  }
  // HU-4833: parseable is not valid. A verdict that breaks its schema is a refusal, never a pass.
  const problems = config?.reviewer_options?.require_schema === false ? [] : verdictSchemaProblems(parsed);
  if (problems.length > 0) {
    const saved = await reportUnparseableVerdict({ projectDir, reviewer, output: result.output, hash: diffHash(diff) });
    throw new Error(`reviewer ${reviewer} answered a verdict that breaks its schema:\n- ${problems.join("\n- ")}\n${saved}`);
  }
  return parsed;
}

async function verdictRecord(parsed, { reviewer, hostAgent, projectDir, sonar, rag, ui }) {
  return {
    verdict: parsed.approved ? "approved" : "rejected",
    reviewer,
    host: hostAgent || null,
    // KJC-TSK-0680: where the review ran — makes any isolation claim auditable.
    workspace: await detectWorkspace(projectDir),
    // KJC-TSK-1017: the branch lets an approval count the corrections before it.
    branch: await branchOf(projectDir),
    issues: parsed.blocking_issues || [],
    suggestions: parsed.non_blocking_suggestions || [],
    summary: parsed.summary || parsed.raw_summary || "",
    ...(sonar ? { sonar } : {}),
    ...(rag ? { rag } : {}),
    // BOOT-D (KJC-TSK-0863): the walkthrough of what a person sees travels with
    // the verdict, bound to this diff, like the other two proofs.
    ...(ui ? { ui } : {}),
    confidence: parsed.confidence ?? null,
  };
}

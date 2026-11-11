/**
 * Solomon arbitration (AB-E, KJC-TSK-0651) — when the brain (host agent)
 * disagrees with the reviewer's verdict, a THIRD AI arbitrates and its
 * ruling is recorded in the verdict store, tied to the exact diff.
 *
 * Hard rules:
 *  - brain ≠ reviewer ≠ solomon. Two-agent machines get an actionable
 *    error — self-arbitration would void the whole point.
 *  - Security issues from the reviewer are NEVER overridable (inherited
 *    from the pipeline's Solomon): the arbiter is not even consulted.
 *  - An approve ruling writes an approved verdict (`solomon:<agent>`) for
 *    the same diff hash, so the pre-commit gate opens structurally; a
 *    reject keeps it closed. Both record the full conflict for audit.
 */
import { createAgent } from "../agents/index.js";
import { traceActivity } from "../agents/activity.js";
import { parseMaybeJsonString, agentAnswerText } from "./parser.js";
import { detectAvailableAgents, detectHostAgent } from "../utils/agent-detect.js";
import { diffHash, loadVerdict, saveVerdict } from "./verdict-store.js";
import { summarizeGeneratedFiles } from "./prompt-diff.js";

// KJC-BUG-0526 (#3632): rce only as a whole word (not source/force), plus the phrase spelled out.
const SECURITY_PATTERN = /injection|xss|csrf|secret|credential|password|token leak|auth(entication|orization)?|crypt|session|sanitiz|traversal|\brce\b|remote code execution/i;

// Structured signal first (`category: "security"` — part of the reviewer's
// JSON schema since AB-E); the free-text pattern stays as a fail-closed net
// for verdicts recorded before the schema carried categories.
// KJC-BUG-0476 (#3137): returns why the issue counts as security, or null.
function securityReason(issue) {
  if (issue.category === "security") return "category security";
  const match = SECURITY_PATTERN.exec(`${issue.id || ""} ${issue.description || ""}`);
  return match ? `matches "${match[0]}"` : null;
}

const describeSecurityIssue = (issue) =>
  `${issue.id || "?"} (${securityReason(issue)}): ${String(issue.description || "").slice(0, 160)}`;

export async function pickThirdParty({ config, hostAgent, reviewerAgent, detectAgents = detectAvailableAgents }) {
  const excluded = new Set([hostAgent, reviewerAgent]);
  const configured = config?.roles?.solomon?.provider;
  const agents = await detectAgents();
  const candidates = agents.filter((a) => a.available && !excluded.has(a.name)).map((a) => a.name);
  if (configured && candidates.includes(configured)) return configured;
  return candidates[0] || null;
}

export async function runSolomonArbitration({
  diff, position, config, logger, projectDir, findingId = null,
  hostAgent = detectHostAgent(),
  createAgentFn = createAgent,
  detectAgents = detectAvailableAgents,
}) {
  if (!position || !position.trim()) {
    throw new Error("kj solomon requires --position \"<why you disagree with the reviewer>\"");
  }
  const verdict = await loadVerdict(projectDir, diffHash(diff));
  if (!verdict || verdict.verdict !== "rejected") {
    throw new Error("nothing to arbitrate — there is no rejected verdict for the current diff (run `kj review --staged` first)");
  }

  // KJC-TSK-1379 (#3207): with findingId only that finding is disputed; the rest keep blocking.
  const allIssues = verdict.issues || [];
  const disputed = findingId ? allIssues.filter((issue) => issue.id === findingId) : allIssues;
  if (findingId && disputed.length === 0) {
    throw new Error(`no finding "${findingId}" in the rejected verdict; its findings are: ${allIssues.map((i) => i.id).join(", ") || "none"}`);
  }

  // ABSOLUTE RULE: security findings are never overridable.
  const securityIssues = disputed.filter((issue) => securityReason(issue));
  if (securityIssues.length > 0) {
    const named = securityIssues.map(describeSecurityIssue).join("; ");
    const record = await saveVerdict(projectDir, diff, {
      ...verdict,
      arbitration: { position, ruling: "reject", reasoning: `security issues from the reviewer are never overridable: ${named}`, solomon: null },
    });
    return { ruling: "reject", reasoning: `security issues are never overridable, fix them: ${named}`, solomon: null, record };
  }

  const solomon = await pickThirdParty({ config, hostAgent, reviewerAgent: verdict.reviewer, detectAgents });
  if (!solomon) {
    throw new Error(
      `arbitration requires a third AI distinct from the brain (${hostAgent || "unknown"}) and the reviewer (${verdict.reviewer}) — install a third agent CLI`
    );
  }

  const prompt = [
    "You are Solomon, the neutral arbiter between two AIs in a coding workflow.",
    "The reviewer REJECTED a diff; the orchestrating brain DISAGREES. Decide who is right.",
    "Never approve to save time or effort — only if the reviewer's objections are genuinely wrong or immaterial for this diff.",
    'Return only one JSON object: {"ruling":"approve"|"reject","reasoning":string}. "approve" = the brain is right, the diff may ship as-is. "reject" = the reviewer is right, the brain must fix the issues.',
    ...(findingId ? ["Rule on this one finding only: the reviewer's other findings are not in dispute."] : []),
    "", "## Reviewer's blocking issues",
    JSON.stringify(disputed, null, 2),
    "", "## Brain's position", position,
    // KJC-BUG-0347: generated files summarized; the ruling still binds to the full diff.
    "", "## The diff under dispute", summarizeGeneratedFiles(diff),
  ].join("\n");

  logger?.info?.(`kj solomon: brain=${hostAgent || "?"} vs reviewer=${verdict.reviewer} → arbiter=${solomon}`);
  const agent = traceActivity(createAgentFn(solomon, config, logger), { name: solomon, role: "solomon", projectDir, logger, config });
  const result = await agent.reviewTask({ prompt, role: "solomon" });
  if (!result?.ok) {
    // KJC-BUG-0121 layer 3: a binary on PATH is not an OPERATIONAL arbiter
    // (dead account tier, auth, trust). Fail with the way out, not just the
    // wreckage: name the other agents that could arbitrate instead.
    const others = (await detectAgents())
      .filter((a) => a.available && a.name !== solomon && a.name !== hostAgent && a.name !== verdict.reviewer)
      .map((a) => a.name);
    const hint = others.length > 0
      ? `If ${solomon} is not operational on this machine (account tier, auth, workspace trust), set roles.solomon.provider in your kj config to another agent: ${others.join(", ")}.`
      : `No other agent CLI on this machine can arbitrate (needs one distinct from brain "${hostAgent}" and reviewer "${verdict.reviewer}") — install a third agent CLI or fix ${solomon}.`;
    throw new Error(`solomon ${solomon} failed: ${String(result?.error || "no output").slice(0, 400)}\n${hint}`);
  }
  const parsed = parseMaybeJsonString(agentAnswerText(result.output));
  if (!parsed || !["approve", "reject"].includes(parsed.ruling)) {
    throw new Error(`solomon ${solomon} returned no parseable ruling`);
  }

  const arbitration = {
    position, ruling: parsed.ruling, reasoning: parsed.reasoning || "", solomon,
    originalVerdict: { reviewer: verdict.reviewer, issues: verdict.issues },
  };
  // KJC-BUG-0183: the arbiter judges the reviewer's objections, not the
  // evidence bound to the diff (sonar, rag blocks). That evidence was computed
  // for this exact hash and travels with the overriding verdict — without it
  // `kj review --check` refuses every arbitrated diff.
  const evidence = { ...(verdict.sonar ? { sonar: verdict.sonar } : {}), ...(verdict.rag ? { rag: verdict.rag } : {}) };
  if (findingId) arbitration.findingId = findingId;
  const remaining = parsed.ruling === "approve" ? allIssues.filter((issue) => !disputed.includes(issue)) : allIssues;
  let record;
  if (parsed.ruling !== "approve") record = await saveVerdict(projectDir, diff, { ...verdict, arbitration });
  else if (remaining.length > 0) record = await saveVerdict(projectDir, diff, { ...verdict, issues: remaining, arbitration });
  else {
    record = await saveVerdict(projectDir, diff, {
      verdict: "approved", reviewer: `solomon:${solomon}`, host: hostAgent || null,
      issues: [], summary: `Arbitration overrode ${verdict.reviewer}'s rejection: ${parsed.reasoning || ""}`.trim(), arbitration, ...evidence,
    });
  }

  return { ruling: parsed.ruling, reasoning: parsed.reasoning || "", solomon, record, remaining: remaining.map((issue) => issue.id) };
}

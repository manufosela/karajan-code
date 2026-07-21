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
import { parseMaybeJsonString } from "./parser.js";
import { detectAvailableAgents, detectHostAgent } from "../utils/agent-detect.js";
import { diffHash, loadVerdict, saveVerdict } from "./verdict-store.js";

const SECURITY_PATTERN = /injection|xss|csrf|secret|credential|password|token leak|auth(entication|orization)?|crypt|session|sanitiz|traversal|rce\b/i;

// Structured signal first (`category: "security"` — part of the reviewer's
// JSON schema since AB-E); the free-text pattern stays as a fail-closed net
// for verdicts recorded before the schema carried categories.
function isSecurityIssue(issue) {
  return issue.category === "security"
    || SECURITY_PATTERN.test(`${issue.id || ""} ${issue.description || ""}`);
}

export async function pickThirdParty({ config, hostAgent, reviewerAgent, detectAgents = detectAvailableAgents }) {
  const excluded = new Set([hostAgent, reviewerAgent]);
  const configured = config?.roles?.solomon?.provider;
  const agents = await detectAgents();
  const candidates = agents.filter((a) => a.available && !excluded.has(a.name)).map((a) => a.name);
  if (configured && candidates.includes(configured)) return configured;
  return candidates[0] || null;
}

export async function runSolomonArbitration({
  diff, position, config, logger, projectDir,
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

  // ABSOLUTE RULE: security findings are never overridable.
  const securityIssues = (verdict.issues || []).filter(isSecurityIssue);
  if (securityIssues.length > 0) {
    const record = await saveVerdict(projectDir, diff, {
      ...verdict,
      arbitration: { position, ruling: "reject", reasoning: "security issues from the reviewer are never overridable", solomon: null },
    });
    return { ruling: "reject", reasoning: "security issues are never overridable — fix them", solomon: null, record };
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
    "", "## Reviewer's blocking issues",
    JSON.stringify(verdict.issues || [], null, 2),
    "", "## Brain's position", position,
    "", "## The diff under dispute", diff,
  ].join("\n");

  logger?.info?.(`kj solomon: brain=${hostAgent || "?"} vs reviewer=${verdict.reviewer} → arbiter=${solomon}`);
  const agent = createAgentFn(solomon, config, logger);
  const result = await agent.reviewTask({ prompt, role: "solomon" });
  if (!result?.ok) throw new Error(`solomon ${solomon} failed: ${result?.error || "no output"}`);
  const parsed = parseMaybeJsonString(result.output);
  if (!parsed || !["approve", "reject"].includes(parsed.ruling)) {
    throw new Error(`solomon ${solomon} returned no parseable ruling`);
  }

  const arbitration = {
    position, ruling: parsed.ruling, reasoning: parsed.reasoning || "", solomon,
    originalVerdict: { reviewer: verdict.reviewer, issues: verdict.issues },
  };
  const record = parsed.ruling === "approve"
    ? await saveVerdict(projectDir, diff, {
      verdict: "approved", reviewer: `solomon:${solomon}`, host: hostAgent || null,
      issues: [], summary: `Arbitration overrode ${verdict.reviewer}'s rejection: ${parsed.reasoning || ""}`.trim(), arbitration,
    })
    : await saveVerdict(projectDir, diff, { ...verdict, arbitration });

  return { ruling: parsed.ruling, reasoning: parsed.reasoning || "", solomon, record };
}

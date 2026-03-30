/**
 * HU Splitting Generator.
 * Uses an AI agent to split a HU based on a selected heuristic,
 * then formats proposals for FDE confirmation.
 */

import { createAgent } from "../agents/index.js";
import { extractFirstJson } from "../utils/json-extract.js";
import { HEURISTIC_DESCRIPTIONS } from "./splitting-detector.js";

const SUBAGENT_PREAMBLE = [
  "IMPORTANT: You are running as a Karajan sub-agent.",
  "Do NOT ask about using Karajan, do NOT mention Karajan, do NOT suggest orchestration.",
  "Do NOT use any MCP tools. Focus only on splitting this HU."
].join(" ");

/**
 * Build the prompt for the AI agent that will split the HU.
 * @param {{id: string, text: string}} hu - The HU to split.
 * @param {string} heuristic - The heuristic key to apply.
 * @returns {string} The assembled prompt.
 */
export function buildSplitPrompt(hu, heuristic) {
  const heuristicDesc = HEURISTIC_DESCRIPTIONS[heuristic] || heuristic;
  const baseId = hu.id || "HU-XXX";

  const sections = [SUBAGENT_PREAMBLE];

  sections.push("## Task: Split User Story");
  sections.push(
    "You are a senior product owner. Split the following user story into smaller, independent sub-HUs.",
    `Apply this splitting heuristic: **${heuristicDesc}**`
  );

  sections.push(`## Original User Story (${baseId})\n${hu.text}`);

  sections.push(
    "## Output Requirements",
    "Return a single valid JSON object and nothing else.",
    `JSON schema: {"subHUs":[{"id":string,"title":string,"text":string,"acceptanceCriteria":[string],"blocked_by":[string]}],"heuristic":string,"reason":string}`,
    "Rules:",
    `- Each sub-HU id must follow the pattern: ${baseId}-A, ${baseId}-B, ${baseId}-C, etc.`,
    "- text must follow role/goal/benefit format: 'As a [role], I want to [goal], so that [benefit]'",
    "- acceptanceCriteria must be concrete, testable statements",
    "- blocked_by: first sub-HU has empty array, each subsequent one is blocked by the previous (sequential chain)",
    "- Generate between 2 and 5 sub-HUs",
    `- heuristic must be "${heuristic}"`,
    "- reason must explain why this heuristic was applied"
  );

  return sections.join("\n\n");
}

/**
 * Parse the AI agent's split output into a structured proposal.
 * @param {string} raw - Raw agent output text.
 * @returns {{subHUs: Array, heuristic: string, reason: string}|null}
 */
export function parseSplitOutput(raw) {
  const parsed = extractFirstJson(raw);
  if (!parsed || !Array.isArray(parsed.subHUs) || parsed.subHUs.length < 2) return null;

  const subHUs = parsed.subHUs
    .filter(s => s && s.id && s.title && s.text)
    .map(s => ({
      id: s.id,
      title: s.title,
      text: s.text,
      acceptanceCriteria: Array.isArray(s.acceptanceCriteria) ? s.acceptanceCriteria : [],
      blocked_by: Array.isArray(s.blocked_by) ? s.blocked_by : []
    }));

  if (subHUs.length < 2) return null;

  return {
    subHUs,
    heuristic: parsed.heuristic || "unknown",
    reason: parsed.reason || ""
  };
}

/**
 * Use an AI agent to generate a split proposal for a HU based on a heuristic.
 * @param {{id: string, text: string}} hu - The HU to split.
 * @param {string} heuristic - The heuristic key to apply.
 * @param {object} config - Karajan config object.
 * @param {object} logger - Logger instance.
 * @returns {Promise<{subHUs: Array, heuristic: string, reason: string}|null>}
 */
export async function generateSplitProposal(hu, heuristic, config, logger) {
  const provider = config?.roles?.hu_reviewer?.provider
    || config?.roles?.coder?.provider
    || "claude";

  const agent = createAgent(provider, config, logger);
  const prompt = buildSplitPrompt(hu, heuristic);

  let result;
  try {
    result = await agent.runTask({ prompt, role: "hu-splitter" });
  } catch (err) {
    logger.warn(`HU split generation threw: ${err.message}`);
    return null;
  }

  if (!result.ok) {
    logger.warn(`HU split generation failed: ${result.error || "unknown"}`);
    return null;
  }

  const proposal = parseSplitOutput(result.output);
  if (!proposal) {
    logger.warn("HU split generation returned unparseable output");
    return null;
  }

  return proposal;
}

/**
 * Format a split proposal as human-readable text for the FDE to review.
 * @param {{subHUs: Array<{id: string, title: string, text: string, acceptanceCriteria?: string[], blocked_by?: string[]}>, heuristic: string, reason: string}} proposal
 * @returns {string}
 */
export function formatSplitProposalForFDE(proposal) {
  const lines = [];
  const heuristicDesc = HEURISTIC_DESCRIPTIONS[proposal.heuristic] || proposal.heuristic;

  lines.push(`Heuristic: ${heuristicDesc}`);
  lines.push(`Reason: ${proposal.reason}`);
  lines.push("");

  for (const sub of proposal.subHUs) {
    lines.push(`--- ${sub.id}: ${sub.title} ---`);
    lines.push(sub.text);
    if (sub.acceptanceCriteria && sub.acceptanceCriteria.length > 0) {
      lines.push("Acceptance Criteria:");
      for (const ac of sub.acceptanceCriteria) {
        lines.push(`  - ${ac}`);
      }
    }
    if (sub.blocked_by && sub.blocked_by.length > 0) {
      lines.push(`Depends on: ${sub.blocked_by.join(", ")}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Set blocked_by for each sub-HU: first inherits original's dependencies,
 * each subsequent is blocked by its predecessor (sequential chain).
 * @param {Array<{id: string, blocked_by?: string[]}>} subHUs - The sub-HUs to update.
 * @param {{blocked_by?: string[]}} originalHu - The original HU with its dependencies.
 * @returns {Array<{id: string, blocked_by: string[]}>} Updated sub-HUs with correct dependencies.
 */
export function buildSplitDependencies(subHUs, originalHu) {
  if (!subHUs || subHUs.length === 0) return [];

  const originalDeps = originalHu?.blocked_by || [];

  return subHUs.map((sub, idx) => {
    const blockedBy = idx === 0
      ? [...originalDeps]
      : [subHUs[idx - 1].id];

    return { ...sub, blocked_by: blockedBy };
  });
}

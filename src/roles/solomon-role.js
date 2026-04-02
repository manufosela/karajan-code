import { BaseRole } from "./base-role.js";
import { createAgent as defaultCreateAgent } from "../agents/index.js";
import { extractFirstJson } from "../utils/json-extract.js";

const SUBAGENT_PREAMBLE = [
  "IMPORTANT: You are running as a Karajan sub-agent.",
  "Do NOT ask about using Karajan, do NOT mention Karajan, do NOT suggest orchestration.",
  "Do NOT use any MCP tools. Focus only on resolving the conflict between agents."
].join(" ");

function resolveProvider(config) {
  return (
    config?.roles?.solomon?.provider ||
    config?.roles?.coder?.provider ||
    "claude"
  );
}

function formatHistory(history) {
  if (!history || history.length === 0) return "No previous interactions recorded.";

  return history
    .map((entry, i) => {
      const agent = entry.agent || "unknown";
      const feedback = entry.feedback || entry.message || "(no feedback)";
      return `### Interaction ${i + 1} [${agent}]\n${feedback}`;
    })
    .join("\n\n");
}

function buildPrompt({ conflict, task, instructions }) {
  const sections = [SUBAGENT_PREAMBLE];

  if (instructions) {
    sections.push(instructions);
  }

  sections.push(
    "You are Solomon, the autonomous pipeline boss in a multi-agent AI coding orchestrator.",
    "You are activated whenever ANYTHING deviates from normal flow: rate limits, agent failures, conflicts, max iterations, quality gate issues.",
    "",
    "## Core principle",
    "The pipeline NEVER skips a quality stage (review, tests, sonar, security) without exhausting alternatives first.",
    "NEVER approve skipping a stage as your first option. Follow the recovery hierarchy below.",
    "",
    "## Recovery hierarchy (STRICT ORDER — follow top to bottom)",
    "When a stage fails or an agent is unavailable:",
    "1. **wait** — If there is a known cooldown (cooldownUntil), and it is less than 10 minutes, WAIT. Set ruling to 'approve_with_conditions' with condition 'wait for cooldown' and set waitUntil.",
    "2. **retry_with_alternative** — Try the same stage with a DIFFERENT agent. The pipeline has multiple agents (claude, codex, gemini). Set ruling to 'approve_with_conditions' with condition specifying the alternative agent.",
    "3. **evaluate_risk** — Only if no alternatives are available, evaluate the risk of skipping. Consider: task complexity, what the stage would catch, security implications.",
    "   - If risk is LOW (trivial task, no security impact, style-only review): approve with a clear justification.",
    "   - If risk is HIGH (complex task, security changes, new dependencies): escalate_human.",
    "4. **escalate_human** — When you cannot resolve it safely. Always prefer this over blindly approving.",
    "",
    "## Quality hierarchy",
    "Security > Correctness > Tests > Architecture > Maintainability > Style",
    "- Green tests are sacred. Never dismiss a failing test.",
    "- Style preferences NEVER block approval.",
    "- Sonar INFO/MINOR issues are always dismissable.",
    "- Sonar BLOCKER/CRITICAL must be fixed unless they are proven false positives.",
    "",
    "## Classification rules",
    "For each issue, classify as:",
    "1. **critical** (security, correctness, tests broken) — action: must_fix",
    "2. **important** (architecture, maintainability) — action: should_fix",
    "3. **style** (naming, formatting, preferences, false positives) — action: dismiss",
    "",
    "## Ruling options",
    '1. **approve** — ONLY when all pending issues are style/false positives AND no stages were skipped, OR when risk evaluation is LOW after exhausting alternatives.',
    '2. **approve_with_conditions** — Fixable issues or recovery actions needed. Include exact conditions (wait, retry with alternative agent, specific fix instructions). Set extraIterations and/or alternativeAgent.',
    '3. **escalate_human** — Cannot resolve safely. Critical issues, ambiguous requirements, architecture decisions, high-risk skip.',
    '4. **create_subtask** — A prerequisite task must be completed first.',
    "",
    "Return a single valid JSON object with your ruling and nothing else.",
    'JSON schema: {"ruling":"approve"|"approve_with_conditions"|"escalate_human"|"create_subtask","classification":[{"issue":string,"category":"critical"|"important"|"style","action":"must_fix"|"should_fix"|"dismiss"}],"conditions":[string],"dismissed":[string],"escalate":boolean,"escalate_reason":string|null,"extraIterations":number|null,"alternativeAgent":string|null,"waitUntil":string|null,"subtask":{"title":string,"description":string,"reason":string}|null}',
    "When ruling is approve_with_conditions, set extraIterations (1-5) and/or alternativeAgent (claude|codex|gemini) as appropriate."
  );

  const stage = conflict?.stage || "unknown";
  const iterationCount = conflict?.iterationCount ?? "?";
  const maxIterations = conflict?.maxIterations ?? "?";

  const isFirstRejection = conflict?.isFirstRejection ?? false;
  const isRepeat = conflict?.isRepeat ?? false;

  const budgetUsd = conflict?.budget_usd;
  const budgetLine = typeof budgetUsd === "number" ? `Budget spent so far: $${budgetUsd.toFixed(2)}` : "";

  sections.push(
    `## Conflict context`,
    `Stage: ${stage}`,
    `Iterations exhausted: ${iterationCount}/${maxIterations}`,
    `isFirstRejection: ${isFirstRejection}`,
    `isRepeat: ${isRepeat}`,
    budgetLine,
    "",
    "## Budget awareness",
    "Consider the cost-benefit ratio when deciding. If significant budget has been spent with little progress,",
    "prefer approving the current work or escalating to human. If progress is good and budget is low,",
    "prefer continuing with conditions. Never waste budget on style-only iterations."
  );

  if (conflict?.issueCategories) {
    sections.push(`## Issue categories\n${JSON.stringify(conflict.issueCategories, null, 2)}`);
  }

  if (conflict?.blockingIssues?.length) {
    const issueList = conflict.blockingIssues
      .map((issue, i) => `${i + 1}. [${issue.severity || "unknown"}] ${issue.description || issue}`)
      .join("\n");
    sections.push(`## Blocking issues\n${issueList}`);
  }

  if (task) {
    sections.push(`## Original task\n${task}`);
  }

  if (conflict?.diff) {
    sections.push(`## Current diff\n${conflict.diff}`);
  }

  sections.push(`## Agent interaction history\n${formatHistory(conflict?.history)}`);

  return sections.join("\n\n");
}

function parseSolomonOutput(raw) {
  return extractFirstJson(raw);
}

function buildSummary(parsed) {
  const ruling = parsed.ruling || "unknown";
  const conditions = parsed.conditions || [];
  const dismissed = parsed.dismissed || [];
  const subtask = parsed.subtask || null;

  if (ruling === "approve") {
    const parts = ["Approved"];
    if (dismissed.length > 0) parts.push(`${dismissed.length} dismissed`);
    return parts.join("; ");
  }

  if (ruling === "approve_with_conditions") {
    const parts = [`Approved with ${conditions.length} condition${conditions.length === 1 ? "" : "s"}`];
    if (dismissed.length > 0) parts.push(`${dismissed.length} dismissed`);
    return parts.join("; ");
  }

  if (ruling === "escalate_human") {
    return `Escalated to human: ${parsed.escalate_reason || "ambiguous conflict"}`;
  }

  if (ruling === "create_subtask") {
    return `Subtask created: ${subtask?.title || "unnamed subtask"}`;
  }

  return `Solomon ruling: ${ruling}`;
}

export class SolomonRole extends BaseRole {
  constructor({ config, logger, emitter = null, createAgentFn = null }) {
    super({ name: "solomon", config, logger, emitter });
    this._createAgent = createAgentFn || defaultCreateAgent;
  }

  async execute(input) {
    const conflict = input?.conflict || {};

    const provider = resolveProvider(this.config);
    const agent = this._createAgent(provider, this.config, this.logger);

    const prompt = buildPrompt({
      conflict,
      task: this.context?.task || "",
      instructions: this.instructions
    });

    const result = await agent.runTask({ prompt, role: "solomon" });

    if (!result.ok) {
      return {
        ok: false,
        result: {
          error: result.error || result.output || "Solomon arbitration failed",
          provider
        },
        summary: `Solomon failed: ${result.error || "unknown error"}`
      };
    }

    try {
      const parsed = parseSolomonOutput(result.output);
      if (!parsed) {
        return {
          ok: false,
          result: { error: "Failed to parse Solomon output: no JSON found", provider },
          summary: "Solomon output parse error: no JSON found"
        };
      }

      const ruling = parsed.ruling || "approve";
      const escalate = Boolean(parsed.escalate);
      const ok = ruling !== "escalate_human";

      return {
        ok,
        result: {
          ruling,
          classification: parsed.classification || [],
          conditions: parsed.conditions || [],
          dismissed: parsed.dismissed || [],
          escalate,
          escalate_reason: parsed.escalate_reason || null,
          subtask: parsed.subtask || null,
          provider
        },
        summary: buildSummary(parsed)
      };
    } catch (err) {
      return {
        ok: false,
        result: { error: `Failed to parse Solomon output: ${err.message}`, provider },
        summary: `Solomon output parse error: ${err.message}`
      };
    }
  }
}

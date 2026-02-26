import { BaseRole } from "./base-role.js";
import { createAgent as defaultCreateAgent } from "../agents/index.js";

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
    "You are Solomon, the conflict resolver in a multi-role AI pipeline.",
    "You are activated when agents cannot reach agreement after their iteration limit."
  );

  sections.push(
    "## Decision hierarchy",
    "Security > Correctness > Tests > Architecture > Maintainability > Style",
    "- Green tests are sacred. Never dismiss a failing test.",
    "- Style preferences NEVER block approval.",
    "- Hardcoded values that will come from DB later are acceptable (contextual false positive).",
    "- Sonar INFO/MINOR issues are always dismissable.",
    "- Sonar BLOCKER/CRITICAL must be fixed unless they are proven false positives."
  );

  sections.push(
    "## Classification rules",
    "For each issue, classify as:",
    "1. **critical** (security, correctness, tests broken) — action: must_fix",
    "2. **important** (architecture, maintainability) — action: should_fix",
    "3. **style** (naming, formatting, preferences, false positives) — action: dismiss"
  );

  sections.push(
    "## Your decision options",
    '1. **approve** — All pending issues are style/false positives. Pipeline continues.',
    '2. **approve_with_conditions** — Important issues exist but are fixable. Give exact instructions to Coder for one more attempt.',
    '3. **escalate_human** — Critical issues that cannot be resolved, ambiguous requirements, architecture decisions, or business logic decisions.',
    '4. **create_subtask** — A prerequisite task must be completed first to resolve the conflict. The current task will pause, the subtask runs, then the current task resumes.'
  );

  sections.push(
    "Return a single valid JSON object with your ruling and nothing else.",
    'JSON schema: {"ruling":"approve"|"approve_with_conditions"|"escalate_human"|"create_subtask","classification":[{"issue":string,"category":"critical"|"important"|"style","action":"must_fix"|"should_fix"|"dismiss"}],"conditions":[string],"dismissed":[string],"escalate":boolean,"escalate_reason":string|null,"subtask":{"title":string,"description":string,"reason":string}|null}'
  );

  const stage = conflict?.stage || "unknown";
  const iterationCount = conflict?.iterationCount ?? "?";
  const maxIterations = conflict?.maxIterations ?? "?";

  sections.push(
    `## Conflict context`,
    `Stage: ${stage}`,
    `Iterations exhausted: ${iterationCount}/${maxIterations}`
  );

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
  const text = raw?.trim() || "";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  return JSON.parse(jsonMatch[0]);
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
    const parts = [`Approved with ${conditions.length} condition${conditions.length !== 1 ? "s" : ""}`];
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

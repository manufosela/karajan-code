// KJC-TSK-0375 — ToolCorrectnessJudgeRole.
// Post-iteration LLM judge scoring how well a coder picked its tool calls.
// PR1 ships role + tests; wiring lives in PR3.

import { AgentRole } from "./agent-role.js";
import { buildToolCorrectnessJudgePrompt } from "../prompts/tool-correctness-judge.js";
import { extractFirstJson } from "../utils/json-extract.js";

const DEFAULT_THRESHOLD = 70;

const clampScore = (n) => Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : null;

const normalizeBreakdown = (b) => Array.isArray(b) ? b.map((x) => ({
  tool: typeof x?.tool === "string" ? x.tool : "unknown",
  args: x?.args && typeof x.args === "object" ? x.args : {},
  correct: Boolean(x?.correct),
  reason: typeof x?.reason === "string" ? x.reason.trim() : "",
})) : [];

export class ToolCorrectnessJudgeRole extends AgentRole {
  constructor(opts) {
    super({ ...opts, name: "tool-correctness-judge" });
    this.threshold = opts?.threshold ?? this.config?.pipeline?.tool_judge?.threshold ?? DEFAULT_THRESHOLD;
  }

  resolveProvider() {
    return this.config?.roles?.["tool-correctness-judge"]?.provider
      || this.config?.roles?.reviewer?.provider
      || this.config?.roles?.coder?.provider
      || "claude";
  }

  extractInput(input) {
    return { ...super.extractInput(input), toolCalls: Array.isArray(input?.toolCalls) ? input.toolCalls : [] };
  }

  async buildPrompt({ task, toolCalls }) {
    return { prompt: buildToolCorrectnessJudgePrompt({ task, toolCalls, instructions: this.instructions }) };
  }

  parseOutput(raw) { return extractFirstJson(raw); }

  buildSuccessResult(parsed, provider) {
    const score = clampScore(parsed?.score);
    return {
      score,
      summary: typeof parsed?.summary === "string" ? parsed.summary.trim() : "",
      breakdown: normalizeBreakdown(parsed?.breakdown),
      threshold: this.threshold,
      lowQuality: score !== null && score < this.threshold,
      provider,
    };
  }

  buildSummary(parsed) {
    const score = clampScore(parsed?.score);
    if (score === null) return "Tool-judge: unparseable score";
    return `Tool-judge: ${score}/100 (${score < this.threshold ? "LOW" : "OK"})`;
  }

  // Empty tool-call list = nothing to judge. Skip the LLM and report a
  // neutral score so an absent transcript is never read as a failure.
  async execute(input) {
    const extracted = this.extractInput(input);
    if (extracted.toolCalls.length === 0) {
      return {
        ok: true,
        result: {
          score: null, summary: "no tool calls captured (skipped)", breakdown: [],
          threshold: this.threshold, lowQuality: false, provider: this.resolveProvider(), skipped: true,
        },
        summary: "Tool-judge: skipped (no calls)",
        usage: null,
      };
    }
    return super.execute(extracted);
  }
}

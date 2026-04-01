import { BaseRole } from "./base-role.js";
import { createAgent as defaultCreateAgent } from "../agents/index.js";
import { buildRtkInstructions } from "../prompts/rtk-snippet.js";

const MAX_DIFF_LENGTH = 12000;

const SUBAGENT_PREAMBLE = [
  "IMPORTANT: You are running as a Karajan sub-agent.",
  "Do NOT ask about using Karajan, do NOT mention Karajan, do NOT suggest orchestration.",
  "Do NOT use any MCP tools. Focus only on reviewing the code."
].join(" ");

function resolveProvider(config) {
  return (
    config?.roles?.reviewer?.provider ||
    config?.roles?.coder?.provider ||
    "claude"
  );
}

function truncateDiff(diff) {
  if (!diff) return "";
  return diff.length > MAX_DIFF_LENGTH
    ? `${diff.slice(0, MAX_DIFF_LENGTH)}\n\n[TRUNCATED]`
    : diff;
}

function buildPrompt({ task, diff, reviewRules, reviewMode, instructions, rtkAvailable = false, proxyEnabled = false, productContext = null, domainContext = null }) {
  const sections = [];

  sections.push(SUBAGENT_PREAMBLE);

  if (instructions) {
    sections.push(instructions);
  }

  sections.push(
    `You are a code reviewer in ${reviewMode || "standard"} mode.`,
    "Return only one valid JSON object and nothing else.",
    'JSON schema:',
    '{"approved":boolean,"blocking_issues":[{"id":string,"severity":"critical|high|medium|low","file":string,"line":number,"description":string,"suggested_fix":string}],"non_blocking_suggestions":[string],"summary":string,"confidence":number}',
    `Task context:\n${task}`
  );

  if (productContext) {
    sections.push(`## Product Context\n${productContext}`);
  }

  if (domainContext) {
    sections.push(`## Domain Context\n${domainContext}`);
  }

  const rtkSnippet = buildRtkInstructions({ rtkAvailable, proxyEnabled });
  if (rtkSnippet) {
    sections.push(rtkSnippet);
  }

  if (reviewRules) {
    sections.push(`Review rules:\n${reviewRules}`);
  }

  sections.push(`Git diff:\n${truncateDiff(diff)}`);

  return sections.join("\n\n");
}

function parseReviewOutput(raw) {
  const text = raw?.trim() || "";
  const jsonMatch = /\{[\s\S]*\}/.exec(text);
  if (!jsonMatch) {
    throw new Error(`Failed to parse reviewer output: no JSON found`);
  }
  return JSON.parse(jsonMatch[0]);
}

export class ReviewerRole extends BaseRole {
  constructor({ config, logger, emitter = null, createAgentFn = null }) {
    super({ name: "reviewer", config, logger, emitter });
    this._createAgent = createAgentFn || defaultCreateAgent;
  }

  async execute(input) {
    const { task, diff, reviewRules, onOutput } = typeof input === "string"
      ? { task: input, diff: "", reviewRules: null, onOutput: null }
      : input;

    const provider = resolveProvider(this.config);
    const agent = this._createAgent(provider, this.config, this.logger);

    const prompt = buildPrompt({
      task: task || this.context?.task || "",
      diff: diff || "",
      reviewRules: reviewRules || null,
      reviewMode: this.config?.review_mode || "standard",
      instructions: this.instructions,
      rtkAvailable: Boolean(this.config?.rtk?.available),
      proxyEnabled: Boolean(this.config?.proxy?.enabled),
      productContext: this.config?.productContext || null,
      domainContext: this.config?.domainContext || null
    });

    const reviewArgs = { prompt, role: "reviewer" };
    if (onOutput) reviewArgs.onOutput = onOutput;

    const result = await agent.reviewTask(reviewArgs);

    if (!result.ok) {
      return {
        ok: false,
        result: {
          error: result.error || result.output || "Reviewer agent failed",
          approved: false,
          blocking_issues: []
        },
        summary: `Reviewer failed: ${result.error || "unknown error"}`
      };
    }

    try {
      const parsed = parseReviewOutput(result.output);
      const blockingIssues = parsed.blocking_issues || [];

      return {
        ok: true,
        result: {
          ...result,
          approved: parsed.approved,
          blocking_issues: blockingIssues,
          non_blocking_suggestions: parsed.non_blocking_suggestions || [],
          confidence: parsed.confidence ?? null,
          raw_summary: parsed.summary || ""
        },
        summary: parsed.approved
          ? `Approved: ${parsed.summary || "no issues found"}`
          : `Rejected: ${blockingIssues.length} blocking issue(s) — ${parsed.summary || ""}`
      };
    } catch (err) {
      return {
        ok: true,
        result: {
          ...result,
          approved: false,
          blocking_issues: [{
            id: "PARSE_ERROR",
            severity: "high",
            description: `Reviewer output could not be parsed: ${err.message}`
          }],
          non_blocking_suggestions: [],
          confidence: 0,
          raw_summary: `Parse error: ${err.message}`
        },
        summary: `Reviewer output parse error: ${err.message}`
      };
    }
  }
}

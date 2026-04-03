import { AgentRole } from "./agent-role.js";
import { buildRtkInstructions } from "../prompts/rtk-snippet.js";
import { extractFirstJson } from "../utils/json-extract.js";

const MAX_DIFF_LENGTH = 12000;

const SUBAGENT_PREAMBLE = [
  "IMPORTANT: You are running as a Karajan sub-agent.",
  "Do NOT ask about using Karajan, do NOT mention Karajan, do NOT suggest orchestration.",
  "Do NOT use any MCP tools. Focus only on reviewing the code."
].join(" ");

function truncateDiff(diff) {
  if (!diff) return "";
  return diff.length > MAX_DIFF_LENGTH ? `${diff.slice(0, MAX_DIFF_LENGTH)}\n\n[TRUNCATED]` : diff;
}

export class ReviewerRole extends AgentRole {
  constructor(opts) {
    super({ ...opts, name: "reviewer" });
  }

  get agentMethod() { return "reviewTask"; }

  extractInput(input) {
    if (typeof input === "string") return { task: input, diff: "", reviewRules: null, onOutput: null };
    return {
      task: input?.task || this.context?.task || "",
      diff: input?.diff || "",
      reviewRules: input?.reviewRules || null,
      onOutput: input?.onOutput || null
    };
  }

  async buildPrompt({ task, diff, reviewRules }) {
    const sections = [SUBAGENT_PREAMBLE];
    if (this.instructions) sections.push(this.instructions);
    sections.push(
      `You are a code reviewer in ${this.config?.review_mode || "standard"} mode.`,
      "Return only one valid JSON object and nothing else.",
      "JSON schema:",
      '{"approved":boolean,"blocking_issues":[{"id":string,"severity":"critical|high|medium|low","file":string,"line":number,"description":string,"suggested_fix":string}],"non_blocking_suggestions":[string],"summary":string,"confidence":number}',
      `Task context:\n${task}`
    );

    const pc = this.config?.productContext;
    if (pc) sections.push(`## Product Context\n${pc}`);
    const dc = this.config?.domainContext;
    if (dc) sections.push(`## Domain Context\n${dc}`);

    const rtkSnippet = buildRtkInstructions({
      rtkAvailable: Boolean(this.config?.rtk?.available)
    });
    if (rtkSnippet) sections.push(rtkSnippet);
    if (reviewRules) sections.push(`Review rules:\n${reviewRules}`);
    sections.push(`Git diff:\n${truncateDiff(diff)}`);

    return { prompt: sections.join("\n\n") };
  }

  parseOutput(raw) {
    const parsed = extractFirstJson(raw);
    if (!parsed) throw new Error("Failed to parse reviewer output: no JSON found");
    return parsed;
  }

  buildSuccessResult(parsed, provider, agentResult) {
    return {
      ...agentResult,
      approved: parsed.approved,
      blocking_issues: parsed.blocking_issues || [],
      non_blocking_suggestions: parsed.non_blocking_suggestions || [],
      confidence: parsed.confidence ?? null,
      raw_summary: parsed.summary || ""
    };
  }

  buildSummary(parsed) {
    const blockingIssues = parsed.blocking_issues || [];
    return parsed.approved
      ? `Approved: ${parsed.summary || "no issues found"}`
      : `Rejected: ${blockingIssues.length} blocking issue(s) — ${parsed.summary || ""}`;
  }

  handleParseError(err, agentResult, _provider) {
    return {
      ok: true,
      result: {
        ...agentResult,
        approved: false,
        blocking_issues: [{ id: "PARSE_ERROR", severity: "high", description: `Reviewer output could not be parsed: ${err.message}` }],
        non_blocking_suggestions: [],
        confidence: 0,
        raw_summary: `Parse error: ${err.message}`
      },
      summary: `Reviewer output parse error: ${err.message}`
    };
  }
}
